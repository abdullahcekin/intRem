import { randomUUID } from 'node:crypto';
import { loadConfig } from '../dist/server/config.js';
import { Store } from '../dist/server/store.js';
import { allowedProjectPath } from '../dist/runtime/discovery.js';

// Mevcut servis üzerinden gerçek soru callback'i; pilot kayıtları uygulamada kalır.
if (!process.env.INTREM_PILOT_PROJECT) throw new Error('Ayrı pilot dizini gereklidir.');
const config = loadConfig(), cwd = await allowedProjectPath(process.env.INTREM_PILOT_PROJECT, config.allowedRoots), store = new Store(config.dbPath);
try {
  const readyDeadline = Date.now() + 15000;
  let heartbeat = '';
  do {
    heartbeat = store.getSetting('runnerHeartbeat', '');
    if (heartbeat && Date.now() - Date.parse(heartbeat) <= 15000) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < readyDeadline);
  if (!heartbeat || Date.now() - Date.parse(heartbeat) > 15000) throw new Error('Runner hazır değil.');
  const project = store.listProjects().find(p => p.cwd === cwd) ?? store.createProject({ name: 'intRem pilotu', cwd, host: 'pilot' });
  const session = store.createSession({ projectId: project.id, title: 'Gerçek soru ve yanıt doğrulaması' });
  if (process.env.INTREM_PILOT_MODEL) store.updateSession(session.id, { requestedModel: process.env.INTREM_PILOT_MODEL });
  const message = store.enqueueMessage(session.id, { generation: session.generation, clientId: randomUUID(), text: 'Bu bir entegrasyon testidir. AskUserQuestion aracını tam bir kez kullanarak "Pilot onayı?" sorusunu sor; seçenekler "Devam" ve "Dur" olsun. Yanıt geldikten sonra yalnız INTREM_INTERACTION_OK yaz. Başka araç kullanma, dosya okuma veya değiştirme.' });
  const deadline = Date.now() + 180000;
  let answered = 0, applied = false, state = 'queued';
  while (Date.now() < deadline) {
    for (const request of store.listInteractions(session.id)) {
      if (request.status === 'answered' && request.appliedAt) applied = true;
      if (request.status !== 'pending') continue;
      const questions = request.input.questions;
      const recognized = request.kind === 'question' && Array.isArray(questions) && questions.length === 1 && questions[0].question === 'Pilot onayı?' && questions[0].options?.some(o => o.label === 'Devam');
      store.decideInteraction(request.id, { generation: session.generation, contentHash: request.contentHash, deviceId: 'local-service-pilot', decision: recognized ? { behavior: 'allow', answers: { 'Pilot onayı?': 'Devam' } } : { behavior: 'deny', reason: 'Pilot yalnız beklenen soru yanıtını uygular.' } });
      if (recognized) answered++;
    }
    state = store.listMessages(session.id).find(m => m.id === message.id).state;
    if (['completed', 'failed', 'delivery_unknown'].includes(state)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const matched = store.listMessages(session.id).some(m => m.role === 'assistant' && m.text.includes('INTREM_INTERACTION_OK'));
  const ok = state === 'completed' && answered === 1 && applied && matched;
  console.log(JSON.stringify({ ok, state, answered, applied, responseMatched: matched }));
  if (!ok) process.exitCode = 1;
} finally { store.close(); }
