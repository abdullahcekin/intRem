import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.js';
import { executeReview, ReviewWorker, reviewEnvironment, type ReviewExecution } from '../src/runtime/reviewer.js';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
function fixture(execute: (input: ReviewExecution) => Promise<{ code: number | null; output: string }>, fingerprint = vi.fn(async () => 'revision')) {
  const dir = mkdtempSync(path.join(tmpdir(), 'intrem-review-')), store = new Store(path.join(dir, 'db.sqlite'));
  const project = store.createProject({ name: 'Pilot', cwd: dir, host: 'test' }), session = store.createSession({ projectId: project.id });
  const worker = new ReviewWorker(store, { allowedRoots: [dir], codexExecutable: 'test-codex', execute, fingerprint });
  cleanups.push(async () => { await worker.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, project, session, worker };
}
async function until(fn: () => boolean, timeout = 3000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Beklenen inceleme durumu oluşmadı'); await new Promise(r => setTimeout(r, 10)); } }
describe('independent Codex review', () => {
  it('does not inherit Claude or gateway credentials', () => {
    expect(reviewEnvironment({ HOME: '/home/test', PATH: '/bin', ANTHROPIC_AUTH_TOKEN: 'private', ANTHROPIC_BASE_URL: 'http://gateway', OPENAI_API_KEY: 'private', OMNIROUTE_KEY: 'private' })).toEqual({ HOME: '/home/test', PATH: '/bin' });
  });
  it('deduplicates review requests, serializes Claude delivery, and releases on completion', async () => {
    const { store, session, worker } = fixture(async () => ({ code: 0, output: 'İnceleme bulgusu' }));
    const review = store.requestReview(session.id, session.generation, 'one');
    expect(store.requestReview(session.id, session.generation, 'one').id).toBe(review.id);
    store.enqueueMessage(session.id, { clientId: 'message', generation: session.generation, text: 'Sonraki iş' });
    expect(store.claimNextMessage(session.id)).toBeUndefined();
    await worker.tick(); await until(() => store.getReview(review.id)?.status === 'completed');
    expect(store.getReview(review.id)?.output).toBe('İnceleme bulgusu');
    expect(store.claimNextMessage(session.id)?.state).toBe('delivering');
  });
  it('reports provider failure without converting it to success', async () => {
    const { store, session, worker } = fixture(async () => ({ code: 1, output: 'Kota doldu' }));
    const review = store.requestReview(session.id, session.generation, 'one');
    await worker.tick(); await until(() => store.getReview(review.id)?.status === 'failed');
    expect(store.getReview(review.id)?.exitCode).toBe(1);
  });
  it('marks results stale when source files change during review', async () => {
    const fp = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after');
    const { store, session, worker } = fixture(async () => ({ code: 0, output: 'Bulgu' }), fp);
    const review = store.requestReview(session.id, session.generation, 'one');
    await worker.tick(); await until(() => store.getReview(review.id)?.status === 'stale');
  });
  it('cancels running work and recovers interrupted work without retry', async () => {
    const execute = vi.fn(({ signal }: ReviewExecution) => new Promise<{ code: number | null; output: string }>(resolve => signal.addEventListener('abort', () => resolve({ code: null, output: 'Durduruldu' }), { once: true })));
    const { store, session, worker } = fixture(execute);
    const review = store.requestReview(session.id, session.generation, 'one');
    await worker.tick(); await until(() => store.getReview(review.id)?.status === 'running');
    store.cancelReview(review.id); await worker.tick(); await until(() => store.getReview(review.id)?.status === 'cancelled');
    const old = store.requestReview(session.id, session.generation, 'two'); store.updateReview(old.id, 'running');
    worker.recover(); expect(store.getReview(old.id)?.status).toBe('interrupted');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('escalates only its Linux process group after the parent exits and releases the queue', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const child = Object.assign(new EventEmitter(), { pid: 43210, exitCode: null as number | null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const { store, session, worker } = fixture(executeReview);
    try {
      const review = store.requestReview(session.id, session.generation, 'process-group');
      store.enqueueMessage(session.id, { clientId: 'after-review', generation: session.generation, text: 'Sonraki iş' });
      await worker.tick(); await until(() => store.getReview(review.id)?.status === 'running');
      vi.useFakeTimers();
      store.cancelReview(review.id); await worker.tick();
      expect(kill.mock.calls).toEqual([[-child.pid, 'SIGTERM']]);
      child.exitCode = 0; child.emit('exit', 0, null);
      child.emit('close', 0, null);
      expect(store.claimNextMessage(session.id)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(5000);
      expect(kill.mock.calls).toEqual([[-child.pid, 'SIGTERM'], [-child.pid, 'SIGKILL']]);
      expect(child.kill).not.toHaveBeenCalled();
      await Promise.resolve(); await Promise.resolve();
      expect(store.getReview(review.id)?.status).toBe('cancelled');
      expect(store.claimNextMessage(session.id)?.state).toBe('delivering');
    } finally {
      child.emit('close', 0, null);
      vi.useRealTimers(); kill.mockRestore();
      Object.defineProperty(process, 'platform', platform);
    }
  });
  it.runIf(process.platform === 'linux')('kills a real orphaned review child without signalling an unrelated group', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const unrelated = actual.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    const { dir, store, session, worker } = fixture(input => executeReview({ ...input, executable: path.join(dir, 'codex-fixture') }));
    const childCode = "require('node:fs').writeFileSync('child-ready', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    writeFileSync(path.join(dir, 'codex-fixture'), `#!${process.execPath}\nconst { spawn } = require('node:child_process');\nrequire('node:fs').writeFileSync('parent-pid', String(process.pid));\nprocess.on('SIGTERM', () => process.exit(0));\nspawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    let parentPid: number | undefined, childPid: number | undefined;
    try {
      const review = store.requestReview(session.id, session.generation, 'real-process-group');
      store.enqueueMessage(session.id, { clientId: 'after-real-review', generation: session.generation, text: 'Sonraki iş' });
      await worker.tick(); await until(() => existsSync(path.join(dir, 'child-ready')));
      parentPid = Number(readFileSync(path.join(dir, 'parent-pid'), 'utf8'));
      childPid = Number(readFileSync(path.join(dir, 'child-ready'), 'utf8'));
      store.cancelReview(review.id); await worker.tick();
      await until(() => { try { process.kill(parentPid!, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } });
      expect(store.getReview(review.id)?.status).toBe('cancelling');
      expect(store.claimNextMessage(session.id)).toBeUndefined();
      await until(() => store.getReview(review.id)?.status === 'cancelled', 8000);
      await until(() => { try { process.kill(childPid!, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } });
      expect(process.kill(unrelated.pid!, 0)).toBe(true);
      expect(store.claimNextMessage(session.id)?.state).toBe('delivering');
    } finally {
      for (const pid of [parentPid, unrelated.pid]) if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Yalnız bu testin oluşturduğu gruplar temizlenir. */ } }
    }
  }, 15000);
  it.runIf(process.platform === 'linux')('keeps a standalone reviewer alive until orphan escalation completes', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const dir = mkdtempSync(path.join(tmpdir(), 'intrem-review-liveness-'));
    const childCode = "require('node:fs').writeFileSync('child-ready', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    writeFileSync(path.join(dir, 'codex-fixture'), `#!${process.execPath}\nconst { spawn } = require('node:child_process');\nrequire('node:fs').writeFileSync('parent-pid', String(process.pid));\nprocess.on('SIGTERM', () => process.exit(0));\nspawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    writeFileSync(path.join(dir, 'runner.mjs'), `import { existsSync, writeFileSync } from 'node:fs';\nimport { executeReview } from ${JSON.stringify(new URL('../src/runtime/reviewer.ts', import.meta.url).href)};\nconst abort = new AbortController();\nconst execution = executeReview({ cwd: ${JSON.stringify(dir)}, executable: ${JSON.stringify(path.join(dir, 'codex-fixture'))}, env: process.env, signal: abort.signal });\nwhile (!existsSync(${JSON.stringify(path.join(dir, 'child-ready'))})) await new Promise(resolve => setTimeout(resolve, 10));\nabort.abort();\nawait execution;\nwriteFileSync(${JSON.stringify(path.join(dir, 'review-finished'))}, 'done');\n`);
    const runner = actual.spawn(process.execPath, ['--import', 'tsx', path.join(dir, 'runner.mjs')], { cwd: process.cwd(), stdio: 'ignore' });
    let parentPid: number | undefined, childPid: number | undefined;
    try {
      await until(() => existsSync(path.join(dir, 'child-ready')));
      parentPid = Number(readFileSync(path.join(dir, 'parent-pid'), 'utf8'));
      childPid = Number(readFileSync(path.join(dir, 'child-ready'), 'utf8'));
      await until(() => runner.exitCode !== null, 8000);
      expect(existsSync(path.join(dir, 'review-finished'))).toBe(true);
      await until(() => { try { process.kill(childPid!, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } });
    } finally {
      if (runner.pid) try { process.kill(runner.pid, 'SIGKILL'); } catch { /* Test süreci zaten çıkmış olabilir. */ }
      if (parentPid) try { process.kill(-parentPid, 'SIGKILL'); } catch { /* Yalnız bu testin owned grubu temizlenir. */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
