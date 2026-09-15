import { createServer, connect, type Socket, type Server } from 'node:net';
import { chmod, lstat, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { allowedProjectPath, discoverSessions } from '../runtime/discovery.js';
import type { Session } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { Store } from './store.js';

const questionInput = z.object({ questions: z.array(z.object({ question: z.string().min(1).max(32000), header: z.string().max(200).optional(), options: z.array(z.object({ label: z.string().min(1).max(10000), description: z.string().max(16000).optional() })).min(1).max(20), multiSelect: z.boolean().optional() })).min(1).max(4) });
const requestSchema = z.object({ hookPid: z.number().int().positive(), hook: z.object({ hook_event_name: z.literal('PreToolUse'), tool_name: z.literal('AskUserQuestion'), tool_use_id: z.string().min(1).max(200), session_id: z.string().uuid(), cwd: z.string().min(1), agent_id: z.never().optional(), tool_input: questionInput }) });
type Request = z.infer<typeof requestSchema>;
type Verifier = (request: Request, session: Session) => Promise<void>;
type Connection = { socket: Socket; request: Request; session: Session; hookStart: string };

async function processIdentity(pid: number) {
  const directory = `/proc/${pid}`;
  if ((await lstat(directory)).uid !== process.getuid!()) throw new Error('uid');
  const stat = await readFile(`${directory}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
  if (!/^\d+$/.test(fields[19] ?? '') || ['Z', 'X'].includes(fields[0])) throw new Error('process');
  return { parent: Number(fields[1]), start: fields[19] };
}

export class SourceHooks {
  readonly socketPath: string;
  private server?: Server;
  private sockets = new Set<Socket>();
  private active = new Map<string, Connection>();
  private workers = new Set<Promise<void>>();
  private stopping = false;

  constructor(private config: AppConfig, private store: Store, private options: { verify?: Verifier; identity?: typeof processIdentity; socketPath?: string; pollMs?: number; timeoutMs?: number } = {}) {
    this.socketPath = options.socketPath ?? path.join(config.dataDir, 'source-hooks.sock');
  }

  async start() {
    if (!this.options.socketPath && process.platform !== 'linux') return;
    try {
      const entry = await lstat(this.socketPath);
      if (!entry.isSocket() || entry.uid !== process.getuid!()) throw new Error('socket owner');
      const alive = await new Promise<boolean>(resolve => {
        const socket = connect(this.socketPath);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
      });
      if (alive) throw new Error('source hook server already active');
      await unlink(this.socketPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.server = createServer(socket => {
      this.sockets.add(socket);
      socket.setEncoding('utf8');
      let raw = '', accepted = false;
      const timeout = setTimeout(() => socket.destroy(), 5000);
      socket.on('error', () => undefined);
      socket.on('close', () => { clearTimeout(timeout); this.sockets.delete(socket); });
      socket.on('data', chunk => {
        if (accepted) return;
        raw += chunk;
        if (Buffer.byteLength(raw) > 128 * 1024) return socket.destroy();
        if (!raw.includes('\n')) return;
        accepted = true; clearTimeout(timeout);
        const worker = this.handle(socket, raw.slice(0, raw.indexOf('\n')));
        this.workers.add(worker);
        void worker.finally(() => this.workers.delete(worker));
      });
    });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.socketPath, resolve); });
    if (process.platform === 'linux') await chmod(this.socketPath, 0o600);
    this.store.resetSourceHooks();
  }

  private async verifyRequest(request: Request, session: Session) {
    if (this.options.verify) return this.options.verify(request, session);
    const project = this.store.getProject(session.projectId)!;
    const cwd = await allowedProjectPath(project.cwd, this.config.allowedRoots);
    if (await realpath(request.hook.cwd) !== cwd || await realpath(`/proc/${session.sourcePid}/cwd`) !== cwd) throw new Error('cwd');
    const discovered = await discoverSessions({ claudeHome: this.config.claudeHome, allowedRoots: this.config.allowedRoots });
    if (!discovered.some(source => source.pid === session.sourcePid && source.processStart === session.sourceStart && source.claudeSessionId === request.hook.session_id && source.cwd === cwd)) throw new Error('source');
    let pid = request.hookPid;
    for (let depth = 0; depth < 32 && pid > 1; depth++) {
      const identity = await processIdentity(pid);
      if (pid === session.sourcePid && identity.start === session.sourceStart) return;
      if (identity.parent === pid) break;
      pid = identity.parent;
    }
    throw new Error('ancestry');
  }

  async verify(id: string) {
    try {
      const current = this.active.get(id);
      if (!current || current.socket.destroyed || this.stopping) throw new Error('disconnected');
      const session = this.store.getSession(current.session.id);
      if (!session || session.generation !== current.session.generation || session.source !== 'imported' || session.controlEnabled || !this.store.getSetting('remoteControlEnabled', true) || !this.store.getSetting(`sourceQuestions:${session.id}`, false)) throw new Error('session');
      if ((await (this.options.identity ?? processIdentity)(current.request.hookPid)).start !== current.hookStart) throw new Error('hook pid reuse');
      await this.verifyRequest(current.request, session);
      if (!this.store.getSetting(`sourceQuestions:${session.id}`, false)) throw new Error('source questions disabled');
    } catch {
      this.active.get(id)?.socket.destroy();
      this.store.disconnectSourceHook(id);
      throw new AppError(409, 'SOURCE_HOOK_DISCONNECTED', 'Kaynak soru bağlantısı kesildi. Eski yanıt gönderilmedi.');
    }
  }

  private async handle(socket: Socket, raw: string) {
    let id: string | undefined;
    try {
      const request = requestSchema.parse(JSON.parse(raw));
      const session = this.store.listSessions().find(session => session.source === 'imported' && session.claudeSessionId === request.hook.session_id);
      if (!session || !this.store.getSetting(`sourceQuestions:${session.id}`, false)) { socket.end(JSON.stringify({ passthrough: true }) + '\n'); return; }
      await this.verifyRequest(request, session);
      const hookStart = (await (this.options.identity ?? processIdentity)(request.hookPid)).start;
      if (socket.destroyed) return;
      const interaction = this.store.createInteraction({ origin: 'source_hook', sessionId: session.id, generation: session.generation, requestId: `source-hook:${request.hook.tool_use_id}`, kind: 'question', toolName: 'AskUserQuestion', input: request.hook.tool_input, expiresAt: new Date(Date.now() + (this.options.timeoutMs ?? 13 * 60 * 1000)).toISOString() });
      id = interaction.id;
      this.active.set(id, { socket, request, session, hookStart });
      while (!socket.destroyed && !this.stopping) {
        await this.verify(id);
        this.store.expireInteractions();
        const item = this.store.getInteraction(id)!;
        if (item.status === 'cancelled' || item.status === 'expired') break;
        if (item.status === 'answered' && item.decision) {
          // Claim once before writing: a lost reply must never replay an approval.
          // appliedAt records this dispatch attempt, not acknowledgement by Claude.
          this.store.markInteractionApplied(id, session.generation);
          socket.end(JSON.stringify(item.decision) + '\n');
          return;
        }
        await delay(this.options.pollMs ?? 500);
      }
    } catch { /* No decision is safer than echoing private tool input or replaying an old approval. */ }
    finally {
      if (id) { this.active.delete(id); this.store.disconnectSourceHook(id); }
      if (!socket.destroyed && !socket.writableEnded) socket.end('{}\n');
    }
  }

  async close() {
    this.stopping = true;
    for (const socket of this.sockets) socket.destroy();
    await Promise.allSettled([...this.workers]);
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }

  disconnectSession(sessionId: string) {
    for (const [id, connection] of this.active) if (connection.session.id === sessionId) {
      connection.socket.destroy();
      this.store.disconnectSourceHook(id);
    }
  }
}
