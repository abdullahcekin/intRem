import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.js';
import { ReviewWorker, reviewEnvironment, type ReviewExecution } from '../src/runtime/reviewer.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
function fixture(execute: (input: ReviewExecution) => Promise<{ code: number | null; output: string }>, fingerprint = vi.fn(async () => 'revision')) {
  const dir = mkdtempSync(path.join(tmpdir(), 'intrem-review-')), store = new Store(path.join(dir, 'db.sqlite'));
  const project = store.createProject({ name: 'Pilot', cwd: dir, host: 'test' }), session = store.createSession({ projectId: project.id });
  const worker = new ReviewWorker(store, { allowedRoots: [dir], codexExecutable: 'test-codex', execute, fingerprint });
  cleanups.push(async () => { await worker.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, project, session, worker };
}
async function until(fn: () => boolean) { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('Beklenen inceleme durumu oluşmadı'); await new Promise(r => setTimeout(r, 10)); } }
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
});
