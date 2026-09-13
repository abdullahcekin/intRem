import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../dist/server/store.js';
import { Runner } from '../dist/runtime/runner.js';
import { loadConfig } from '../dist/server/config.js';

if (!process.env.INTREM_PILOT_PROJECT) throw new Error('INTREM_PILOT_PROJECT gereklidir; ayrı bir pilot dizini seçin.');
const cwd = realpathSync(process.env.INTREM_PILOT_PROJECT);
const config = loadConfig();
const dir = mkdtempSync(path.join(tmpdir(), 'intrem-live-'));
const store = new Store(path.join(dir, 'pilot.sqlite'));
const runner = new Runner(store, { ...config, allowedRoots: [cwd], pollIntervalMs: 100 });
try {
  const project = store.createProject({ name: 'intRem yalıtılmış pilot', cwd, host: 'pilot' });
  const session = store.createSession({ projectId: project.id });
  await runner.start();
  const message = store.enqueueMessage(session.id, { generation: session.generation, clientId: randomUUID(), text: 'Bu bir bağlantı testidir. Araç kullanmadan yalnızca INTREM_PILOT_OK yaz.' });
  const deadline = Date.now() + 90000;
  let result;
  while (Date.now() < deadline) {
    result = store.listMessages(session.id).find(item => item.id === message.id);
    if (['completed', 'failed', 'delivery_unknown'].includes(result.state)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const current = store.getSession(session.id);
  const response = store.listMessages(session.id).filter(item => item.role === 'assistant').map(item => item.text).join('\n');
  const ok = result?.state === 'completed' && response.includes('INTREM_PILOT_OK');
  console.log(JSON.stringify({ ok, state: result?.state, conversationCreated: !!current.claudeSessionId, reportedModel: current.actualModel, responseMatched: response.includes('INTREM_PILOT_OK'), pendingPermissions: store.listInteractions(session.id).filter(i => i.status === 'pending').length }));
  if (!ok) process.exitCode = 1;
} finally {
  await runner.stop(); store.close(); rmSync(dir, { recursive: true, force: true });
}
