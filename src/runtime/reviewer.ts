import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '../server/store.js';
import type { Review } from '../shared/types.js';
import { allowedProjectPath } from './discovery.js';

const exec = promisify(execFile);
export function reviewEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value && /^(HOME|USER|LOGNAME|PATH|TMPDIR|TMP|TEMP|SYSTEMROOT|COMSPEC|PATHEXT|LANG|LC_.+|TZ|CODEX_HOME|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(key)));
}
export async function reviewFingerprint(cwd: string): Promise<string> {
  const git = async (args: string[]) => (await exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env: reviewEnvironment(), maxBuffer: 16 * 1024 * 1024, timeout: 10000, windowsHide: true })).stdout;
  const hash = createHash('sha256');
  hash.update(await git(['rev-parse', 'HEAD']));
  hash.update(await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD']));
  const files = (await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  let total = 0;
  for (const file of files) {
    const resolved = await realpath(path.join(cwd, file)), relative = path.relative(cwd, resolved);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Proje dışı inceleme hedefi');
    const info = await stat(resolved);
    if (!info.isFile() || (total += info.size) > 16 * 1024 * 1024) throw new Error('İnceleme için değişiklik kapsamı çok büyük');
    hash.update(file); hash.update(await readFile(resolved));
  }
  return hash.digest('hex');
}
export interface ReviewExecution { cwd: string; executable: string; env: NodeJS.ProcessEnv; signal: AbortSignal }
export function executeReview({ cwd, executable, env, signal }: ReviewExecution): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '-c', 'model_provider="openai"', '-c', 'mcp_servers={}', 'review', '--uncommitted'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform === 'linux' });
    let output = '', stderr = '';
    child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-64000); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-64000); });
    let force: ReturnType<typeof setTimeout> | undefined;
    const kill = (mode: NodeJS.Signals) => {
      if (!child.pid || child.exitCode !== null) return;
      try { if (process.platform === 'linux') process.kill(-child.pid, mode); else child.kill(mode); } catch { /* Kendi süreç grubu zaten çıkmış olabilir. */ }
    };
    const cancel = () => { kill('SIGTERM'); force = setTimeout(() => kill('SIGKILL'), 5000); force.unref(); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timeout = setTimeout(cancel, 15 * 60_000); timeout.unref();
    const clear = () => { clearTimeout(timeout); clearTimeout(force); signal.removeEventListener('abort', cancel); };
    child.once('error', error => { clear(); reject(error); });
    child.once('close', code => { clear(); resolve({ code, output: output || stderr }); });
  });
}
export class ReviewWorker {
  private active: { review: Review; abort: AbortController; done: Promise<void> } | null = null;
  private stopping = false;
  constructor(private store: Store, private options: { allowedRoots: string[]; codexExecutable: string; execute?: typeof executeReview; fingerprint?: typeof reviewFingerprint }) {}
  recover() {
    for (const review of this.store.listReviews()) if (['running', 'cancelling'].includes(review.status)) this.store.updateReview(review.id, 'interrupted', 'Çalıştırıcı yeniden başladı; inceleme otomatik tekrarlanmadı.');
  }
  async tick() {
    if (this.stopping) return;
    if (this.active) {
      const current = this.store.getReview(this.active.review.id), session = this.store.getSession(this.active.review.sessionId);
      if (current?.status === 'cancelling' || session?.generation !== this.active.review.generation) this.active.abort.abort();
      return;
    }
    if (!this.store.getSetting('remoteControlEnabled', true)) return;
    const review = this.store.listReviews().find(r => r.status === 'queued');
    if (!review) return;
    const session = this.store.getSession(review.sessionId);
    if (!session || session.generation !== review.generation || !session.controlEnabled) { this.store.updateReview(review.id, 'interrupted', 'Hedef oturum değişti.'); return; }
    if (this.store.listSessions().some(s => s.projectId === session.projectId && !['idle', 'offline'].includes(s.state))) return;
    const project = this.store.getProject(session.projectId)!;
    const abort = new AbortController();
    const active = { review, abort, done: Promise.resolve() };
    this.active = active;
    active.done = (async () => {
      let revision: string | null = null;
      try {
        const cwd = await allowedProjectPath(project.cwd, this.options.allowedRoots);
        revision = await (this.options.fingerprint ?? reviewFingerprint)(cwd);
        if (abort.signal.aborted || this.store.getReview(review.id)?.status !== 'queued') return;
        this.store.updateReview(review.id, 'running', '', revision);
        const result = await (this.options.execute ?? executeReview)({ cwd, executable: this.options.codexExecutable, env: reviewEnvironment(), signal: abort.signal });
        const currentFingerprint = result.code === 0 && !abort.signal.aborted ? await (this.options.fingerprint ?? reviewFingerprint)(cwd) : null;
        const interrupted = this.stopping || this.store.getSession(review.sessionId)?.generation !== review.generation;
        const cancelled = this.store.getReview(review.id)?.status === 'cancelling';
        const status = interrupted ? 'interrupted' : cancelled ? 'cancelled' : result.code !== 0 ? 'failed' : currentFingerprint !== revision ? 'stale' : 'completed';
        this.store.updateReview(review.id, status, result.output, revision, result.code);
      } catch {
        this.store.updateReview(review.id, this.stopping ? 'interrupted' : 'failed', 'Codex incelemesi tamamlanamadı. Git çalışma alanını, Codex girişini ve çalıştırıcı erişimini kontrol edin.', revision);
      } finally { if (this.active === active) this.active = null; }
    })();
  }
  async stop() { this.stopping = true; this.active?.abort.abort(); await this.active?.done; }
}
