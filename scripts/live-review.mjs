import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../dist/server/store.js';
import { ReviewWorker } from '../dist/runtime/reviewer.js';
import { loadConfig } from '../dist/server/config.js';

if (!process.env.INTREM_PILOT_PROJECT) throw new Error('Ayrı Git pilot dizinini INTREM_PILOT_PROJECT ile belirtin.');
const cwd = realpathSync(process.env.INTREM_PILOT_PROJECT), config = loadConfig();
const dir = mkdtempSync(path.join(tmpdir(), 'intrem-review-live-')), store = new Store(path.join(dir, 'db.sqlite'));
const worker = new ReviewWorker(store, { allowedRoots: [cwd], codexExecutable: config.codexExecutable });
try {
  const project = store.createProject({ name: 'Codex pilot', cwd, host: 'pilot' }), session = store.createSession({ projectId: project.id });
  const review = store.requestReview(session.id, session.generation, randomUUID());
  await worker.tick();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && ['queued', 'running', 'cancelling'].includes(store.getReview(review.id).status)) {
    await new Promise(r => setTimeout(r, 250)); await worker.tick();
  }
  const result = store.getReview(review.id);
  console.log(JSON.stringify({ ok: result.status === 'completed', status: result.status, exitCode: result.exitCode, outputPresent: result.output.length > 0, outputCharacters: result.output.length, revisionVerified: !!result.revision }));
  if (result.status !== 'completed') process.exitCode = 1;
} finally { await worker.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); }
