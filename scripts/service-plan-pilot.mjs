import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../dist/server/config.js';
import { Store } from '../dist/server/store.js';
import { allowedProjectPath } from '../dist/runtime/discovery.js';

// Kurulu runner kullanılır; yalnız bu pilotun somut plan kararı otomatik yanıtlanır.
if (process.platform !== 'linux' || !process.env.INTREM_PILOT_PROJECT) throw new Error('Linux üzerinde ayrı INTREM_PILOT_PROJECT gereklidir.');
const config = loadConfig();
const pilotRoot = await allowedProjectPath(process.env.INTREM_PILOT_PROJECT, config.allowedRoots);
const store = new Store(config.dbPath);
const delay = () => new Promise(resolve => setTimeout(resolve, 200));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
let session, report = { ok: false }, stopped = false;
try {
  const heartbeat = store.getSetting('runnerHeartbeat', '');
  if (!heartbeat || !Number.isFinite(Date.parse(heartbeat)) || Date.now() - Date.parse(heartbeat) > 15000) throw new Error('Runner hazır değil.');
  if (!store.getSetting('remoteControlEnabled', true)) throw new Error('Uzaktan kontrol kapalı.');
  const cwd = await mkdtemp(path.join(pilotRoot, 'service-plan-'));
  const plans = path.join(cwd, 'plans'), settings = path.join(cwd, '.claude');
  await mkdir(plans, { mode: 0o700 }); await mkdir(settings, { mode: 0o700 });
  const expected = `# INTREM_PLAN_${randomUUID()}\n\n1. Yalnız INTREM_PLAN_OK yaz. Dosya okuma veya değiştirme.\n`;
  const guardPath = path.join(settings, 'pilot-guard.cjs');
  const evidencePath = path.join(settings, 'plan-result.json');
  const guard = `const fs = require('node:fs'), path = require('node:path');
const event = JSON.parse(fs.readFileSync(0, 'utf8'));
const expected = ${JSON.stringify(expected)}, plans = ${JSON.stringify(plans)};
const input = event.tool_input || {};
const scoped = file => typeof file === 'string' && path.isAbsolute(file) && path.dirname(path.resolve(file)) === plans;
if (process.argv[2] === 'post') {
  fs.writeFileSync(${JSON.stringify(evidencePath)}, JSON.stringify({ sessionId: event.session_id, planMatched: event.tool_name === 'ExitPlanMode' && event.tool_response?.plan === expected }), { mode: 0o600 });
  console.log('{}');
} else {
  const write = event.tool_name === 'Write' && scoped(input.file_path) && input.content === expected;
  const plan = event.tool_name === 'ExitPlanMode' && scoped(input.planFilePath) && input.plan === expected;
  console.log(JSON.stringify(plan ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: write ? 'allow' : 'deny', permissionDecisionReason: 'Pilot yalnız beklenen sentetik planı kullanır.' } }));
}
`;
  await writeFile(guardPath, guard, { mode: 0o600 });
  const command = `${quote(process.execPath)} ${quote(guardPath)}`;
  await writeFile(path.join(settings, 'settings.local.json'), JSON.stringify({ plansDirectory: 'plans', hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command, timeout: 5 }] }],
    PostToolUse: [{ matcher: 'ExitPlanMode', hooks: [{ type: 'command', command: `${command} post`, timeout: 5 }] }],
  } }), { mode: 0o600 });
  const project = store.createProject({ name: 'intRem plan kabul pilotu', cwd, host: 'pilot', mode: 'plan' });
  session = store.createSession({ projectId: project.id, title: 'Gerçek plan onayı doğrulaması' });
  if (process.env.INTREM_PILOT_MODEL) store.updateSession(session.id, { requestedModel: process.env.INTREM_PILOT_MODEL });
  const message = store.enqueueMessage(session.id, { generation: session.generation, clientId: randomUUID(),
    text: `Bu sentetik plan kabul testidir. Kaynak dosya okuma. Sana ayrılan plan dosyasına Write ile aşağıdaki metni harfiyen yaz, ardından ExitPlanMode çağır. Onaydan sonra yalnız INTREM_PLAN_OK yaz. Başka araç kullanma. Ret halinde tekrar deneme. Plan metni:\n${expected}` });
  const deadline = Date.now() + 180000;
  let approved = 0, state = 'queued';
  while (Date.now() < deadline) {
    for (const request of store.listInteractions(session.id).filter(item => item.status === 'pending')) {
      const planPath = request.input.planFilePath;
      const recognized = approved === 0 && request.generation === session.generation && request.kind === 'plan' && request.toolName === 'ExitPlanMode' && request.input.plan === expected && typeof planPath === 'string' && path.dirname(path.resolve(planPath)) === plans;
      store.decideInteraction(request.id, { generation: session.generation, contentHash: request.contentHash, deviceId: 'local-service-plan-pilot', decision: recognized ? { behavior: 'allow' } : { behavior: 'deny', reason: 'Pilot yalnız beklenen planı bir kez onaylar.' } });
      if (recognized) approved++;
    }
    state = store.listMessages(session.id).find(item => item.id === message.id).state;
    if (['completed', 'failed', 'cancelled', 'delivery_unknown'].includes(state)) break;
    await delay();
  }
  const decisions = store.listInteractions(session.id).filter(item => item.kind === 'plan');
  const appliedOnce = decisions.length === 1 && decisions[0].status === 'answered' && !!decisions[0].appliedAt;
  const responseMatched = store.listMessages(session.id).some(item => item.role === 'assistant' && item.text.includes('INTREM_PLAN_OK'));
  let postMatched = false;
  try {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    postMatched = evidence.planMatched === true && evidence.sessionId === store.getSession(session.id).claudeSessionId;
  } catch { /* Hook kanıtı yoksa pilot başarılı sayılmaz. */ }
  report = { ok: state === 'completed' && approved === 1 && appliedOnce && responseMatched && postMatched, state, approved, appliedOnce, responseMatched, postMatched };
} catch {
  report = { ok: false, code: 'SERVICE_PLAN_PILOT_FAILED' };
} finally {
  if (session) {
    for (const message of store.listMessages(session.id).filter(item => item.state === 'queued')) store.cancelMessage(message.id);
    store.setSetting(`stop:${session.id}`, session.generation);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (store.getSession(session.id)?.generation !== session.generation) { stopped = true; break; }
      await delay();
    }
  }
  store.close();
  console.log(JSON.stringify({ ...report, sessionStopped: stopped }));
  if (!report.ok || !stopped) process.exitCode = 1;
}
