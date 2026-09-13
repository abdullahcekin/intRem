import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { query as sdkQuery, type CanUseTool, type Options, type PermissionResult, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Store } from '../server/store.js';
import type { Message, Session } from '../shared/types.js';
import { allowedProjectPath, isSourceAlive } from './discovery.js';
import { RunnerLock } from './lock.js';

export interface RuntimeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
}

export interface RunnerOptions {
  allowedRoots: string[];
  claudeHome: string;
  claudeExecutable?: string | null;
  pollIntervalMs?: number;
  interactionPollMs?: number;
  interactionTimeoutMs?: number;
  query?: (parameters: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => RuntimeQuery;
  isSourceAlive?: typeof isSourceAlive;
}

class InputStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private reader: ((item: IteratorResult<SDKUserMessage>) => void) | undefined;
  private ended = false;
  constructor(private readonly onDelivery: (message: SDKUserMessage) => void) {}
  push(message: SDKUserMessage) {
    if (this.ended) throw new Error('Input stream closed');
    if (this.reader) {
      this.onDelivery(message);
      const reader = this.reader; this.reader = undefined;
      reader({ value: message, done: false });
    } else this.queue.push(message);
  }
  close() { this.ended = true; this.queue = []; this.reader?.({ value: undefined, done: true }); this.reader = undefined; }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return { next: async () => {
      const message = this.queue.shift();
      if (message) { this.onDelivery(message); return { value: message, done: false }; }
      if (this.ended) return { value: undefined, done: true };
      return new Promise(resolve => { this.reader = resolve; });
    } };
  }
}

interface ActiveSession {
  id: string;
  generation: string;
  query: RuntimeQuery;
  input: InputStream;
  abort: AbortController;
  currentMessage: Message | null;
  answerReceived: boolean;
  closed: boolean;
  finished: Promise<void>;
  seenMessages: Set<string>;
}

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const denied = (message: string): PermissionResult => ({ behavior: 'deny', message });

export class Runner {
  private readonly active = new Map<string, ActiveSession>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<void> | null = null;
  private running = false;
  private readonly lock: RunnerLock;
  private readonly callbacks = new Set<Promise<PermissionResult | null>>();

  constructor(private readonly store: Store, private readonly options: RunnerOptions) { this.lock = new RunnerLock(store.db); }

  async start(): Promise<void> {
    if (this.running) return;
    await this.lock.acquire();
    this.running = true;
    try {
      this.store.recoverDeliveries();
      await this.tick();
      this.timer = setInterval(() => { void this.tick().catch(() => {
        if (this.running) this.store.event('runner.error', null, { code: 'RUNNER_POLL_FAILED' });
      }); }, this.options.pollIntervalMs ?? 500);
    } catch (error) { await this.stop(); throw error; }
  }

  async tick(): Promise<void> {
    if (!this.running) return;
    if (this.ticking) return this.ticking;
    this.ticking = this.poll().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async poll(): Promise<void> {
    this.store.setSetting('runnerHeartbeat', new Date().toISOString());
    this.store.expireInteractions();
    for (const session of this.store.listSessions()) {
      if (!this.running) break;
      const active = this.active.get(session.id);
      const stopGeneration = this.store.getSetting(`stop:${session.id}`, '');
      if (stopGeneration) {
        this.store.setSetting(`stop:${session.id}`, '');
        if (stopGeneration === session.generation) { await this.stopSession(session, active); continue; }
      }
      if (active && (session.generation !== active.generation || !session.controlEnabled)) {
        await this.closeActive(active, false);
        continue;
      }
      if (!session.controlEnabled || session.state === 'delivery_unknown' || active?.currentMessage) continue;
      if (!this.store.listMessages(session.id).some(message => message.role === 'user' && message.state === 'queued')) continue;
      if (session.sourcePid !== null || session.sourceStart !== null) {
        try { if (await (this.options.isSourceAlive ?? isSourceAlive)(session)) continue; }
        catch {
          this.store.updateSession(session.id, { state: 'offline', controlEnabled: false });
          this.store.event('runner.source_unverified', session.id, { code: 'SOURCE_PROCESS_UNVERIFIED' });
          continue;
        }
      }
      const project = this.store.getProject(session.projectId);
      if (!project) continue;
      let cwd: string;
      try { cwd = await allowedProjectPath(project.cwd, this.options.allowedRoots); }
      catch { this.store.updateSession(session.id, { state: 'offline', controlEnabled: false }); continue; }
      const current = this.store.getSession(session.id);
      if (!current || current.generation !== session.generation || !current.controlEnabled) continue;
      const message = this.store.claimNextMessage(session.id);
      if (!message) continue;
      let runtime = active;
      try {
        runtime ??= this.launch(current, cwd, project.mode);
        runtime.currentMessage = message;
        runtime.answerReceived = false;
        this.store.updateSession(session.id, { state: 'working', lastActivityAt: new Date().toISOString() });
        runtime.input.push({ type: 'user', uuid: message.id as ReturnType<typeof randomUUID>, session_id: current.claudeSessionId ?? undefined, parent_tool_use_id: null, message: { role: 'user', content: message.text } });
      } catch {
        if (runtime) await this.closeActive(runtime, false);
        this.unknown(session.id, message.id, session.generation);
      }
    }
  }

  private launch(session: Session, cwd: string, mode: 'default' | 'plan'): ActiveSession {
    const abort = new AbortController();
    const input = new InputStream(message => {
      const current = this.store.getSession(session.id);
      if (current?.generation !== session.generation || abort.signal.aborted) throw new Error('Stale runtime generation');
      if (message.uuid) this.store.updateMessage(message.uuid, { state: 'processing' });
    });
    const options: Options = {
      cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: path.resolve(this.options.claudeHome) },
      settingSources: ['user', 'project', 'local'],
      permissionMode: mode,
      persistSession: true,
      abortController: abort,
      canUseTool: this.permissionHandler(session, abort.signal),
      ...(this.options.claudeExecutable ? { pathToClaudeCodeExecutable: this.options.claudeExecutable } : {}),
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      ...(session.requestedModel ? { model: session.requestedModel } : {}),
    };
    const query = (this.options.query ?? sdkQuery)({ prompt: input, options });
    const runtime: ActiveSession = { id: session.id, generation: session.generation, query, input, abort, currentMessage: null, answerReceived: false, closed: false, finished: Promise.resolve(), seenMessages: new Set() };
    this.active.set(session.id, runtime);
    runtime.finished = this.consume(runtime);
    return runtime;
  }

  private async consume(runtime: ActiveSession): Promise<void> {
    try {
      for await (const event of runtime.query) {
        if (runtime.closed || this.store.getSession(runtime.id)?.generation !== runtime.generation) break;
        if (event.type === 'system' && event.subtype === 'init') {
          this.store.updateSession(runtime.id, { claudeSessionId: event.session_id });
        } else if (event.type === 'assistant' && !event.parent_tool_use_id) {
          if (runtime.seenMessages.has(event.uuid)) continue;
          runtime.seenMessages.add(event.uuid);
          if (!event.error && typeof event.message.model === 'string' && event.message.model.trim() && !event.message.model.startsWith('<')) this.store.updateSession(runtime.id, { actualModel: event.message.model });
          const text = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
          if (text) { this.store.appendMessage(runtime.id, 'assistant', text); runtime.answerReceived = true; }
        } else if (event.type === 'result' && runtime.currentMessage) {
          if (!runtime.answerReceived && event.subtype === 'success' && event.result) this.store.appendMessage(runtime.id, 'assistant', event.result);
          this.store.updateMessage(runtime.currentMessage.id, { state: event.is_error ? 'failed' : 'completed', error: event.is_error ? 'Claude işlemi hata ile tamamladı.' : null });
          this.store.updateSession(runtime.id, { state: 'idle', claudeSessionId: event.session_id, lastActivityAt: new Date().toISOString() });
          runtime.currentMessage = null;
          this.store.event('runner.turn_complete', runtime.id, { generation: runtime.generation, success: !event.is_error });
        }
      }
    } catch {
      // SDK errors can contain command output or credentials; keep a stable safe diagnostic.
      this.store.event('runner.disconnected', runtime.id, { code: 'SDK_CONNECTION_LOST', generation: runtime.generation });
    } finally {
      if (!runtime.closed) {
        runtime.closed = true;
        runtime.abort.abort(); runtime.input.close(); runtime.query.close();
        if (runtime.currentMessage) this.unknown(runtime.id, runtime.currentMessage.id, runtime.generation);
        this.store.expireSessionInteractions(runtime.id, runtime.generation);
      }
      if (this.active.get(runtime.id) === runtime) this.active.delete(runtime.id);
    }
  }

  private permissionHandler(session: Session, runtimeSignal: AbortSignal): CanUseTool {
    const handle: CanUseTool = async (toolName, input, callback) => {
      if (runtimeSignal.aborted || callback.signal.aborted || this.store.getSession(session.id)?.generation !== session.generation || !this.store.getSetting('remoteControlEnabled', true)) return denied('Oturum artık etkin değil veya uzaktan kontrol kapalı.');
      if (toolName === 'ExitPlanMode' && (typeof input.plan !== 'string' || !input.plan.trim())) return denied('Somut plan içeriği olmadan uygulama onayı verilemez.');
      const original = JSON.stringify(input);
      const snapshot = JSON.parse(original) as Record<string, unknown>;
      const interaction = this.store.createInteraction({
        sessionId: session.id, generation: session.generation, requestId: callback.requestId || callback.toolUseID || randomUUID(),
        kind: toolName === 'AskUserQuestion' ? 'question' : toolName === 'ExitPlanMode' ? 'plan' : 'permission',
        toolName, input: snapshot, expiresAt: new Date(Date.now() + (this.options.interactionTimeoutMs ?? 15 * 60_000)).toISOString(),
      });
      this.store.updateSession(session.id, { state: interaction.kind === 'question' ? 'waiting_answer' : 'permission_required' });
      try {
        while (!runtimeSignal.aborted && !callback.signal.aborted) {
          const current = this.store.getSession(session.id);
          if (!current || current.generation !== session.generation || !current.controlEnabled || !this.store.getSetting('remoteControlEnabled', true)) return denied('Oturum yetkisi değişti veya uzaktan kontrol kapalı.');
          this.store.expireInteractions();
          const pending = this.store.getInteraction(interaction.id);
          if (!pending || pending.status === 'expired' || pending.status === 'cancelled') return denied('İsteğin süresi doldu veya iptal edildi.');
          if (pending.status === 'answered' && pending.decision) {
            if (pending.appliedAt || JSON.stringify(input) !== original) return denied('İstek değişti veya yanıt zaten uygulandı.');
            try { this.store.markInteractionApplied(pending.id, session.generation); }
            catch { return denied('Yanıt artık bu isteğe uygulanamaz.'); }
            if (pending.decision.behavior === 'deny') return denied(pending.decision.reason || 'Kullanıcı bu işlemi reddetti.');
            return { behavior: 'allow', updatedInput: pending.kind === 'question' ? { ...snapshot, answers: pending.decision.answers ?? {} } : snapshot };
          }
          await delay(this.options.interactionPollMs ?? 150);
        }
        return denied('İşlem durduruldu.');
      } finally {
        const current = this.store.getSession(session.id);
        if (current?.generation === session.generation && current.controlEnabled && current.state !== 'delivery_unknown') {
          const remaining = this.store.listInteractions(session.id).filter(value => value.generation === session.generation && value.status === 'pending');
          this.store.updateSession(session.id, { state: remaining.some(value => value.kind === 'question') ? 'waiting_answer' : remaining.length ? 'permission_required' : 'working' });
        }
      }
    };
    return (toolName, input, callback) => {
      const promise = handle(toolName, input, callback);
      this.callbacks.add(promise);
      void promise.finally(() => { this.callbacks.delete(promise); }).catch(() => undefined);
      return promise;
    };
  }

  private unknown(sessionId: string, messageId: string, generation: string) {
    if (this.store.getSession(sessionId)?.generation !== generation) return;
    this.store.updateMessage(messageId, { state: 'delivery_unknown', error: 'Claude bağlantısı kesildi; komutun etkisi belirsiz. Otomatik tekrar yapılmadı.' });
    this.store.updateSession(sessionId, { state: 'delivery_unknown', controlEnabled: false });
  }

  private async closeActive(runtime: ActiveSession, explicit: boolean): Promise<void> {
    if (runtime.closed) return;
    runtime.closed = true;
    runtime.input.close(); runtime.abort.abort();
    if (explicit) {
      await Promise.race([runtime.query.interrupt().catch(() => undefined), delay(2000)]);
    }
    runtime.query.close();
    this.store.expireSessionInteractions(runtime.id, runtime.generation);
    if (!explicit && runtime.currentMessage) this.unknown(runtime.id, runtime.currentMessage.id, runtime.generation);
    if (this.active.get(runtime.id) === runtime) this.active.delete(runtime.id);
  }

  private async stopSession(session: Session, runtime?: ActiveSession): Promise<void> {
    if (runtime) {
      await this.closeActive(runtime, true);
      if (runtime.currentMessage) this.store.updateMessage(runtime.currentMessage.id, { state: 'failed', error: 'Kullanıcı isteğiyle durduruldu; kısmi etkiler olabilir.' });
    }
    for (const message of this.store.listMessages(session.id)) if (message.state === 'queued') this.store.cancelMessage(message.id);
    this.store.expireSessionInteractions(session.id, session.generation);
    this.store.updateSession(session.id, { generation: randomUUID(), state: 'idle', controlEnabled: true });
    this.store.event('runner.stopped', session.id, { generation: session.generation });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.ticking) await this.ticking;
    await Promise.all([...this.active.values()].map(runtime => this.closeActive(runtime, false)));
    await Promise.allSettled([...this.callbacks]);
    this.store.setSetting('runnerHeartbeat', '');
    this.lock.release();
  }
}
