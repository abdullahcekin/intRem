import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/server/store.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function fixture() {
  const store = new Store(':memory:'); stores.push(store);
  const project = store.createProject({ name: 'Kaynak bağlantı testi', cwd: '/synthetic/project', host: 'synthetic' });
  const session = store.createSession({ projectId: project.id, source: 'imported', sourcePid: 42, sourceStart: '100', claudeSessionId: '00000000-0000-4000-8000-000000000123' });
  store.setSetting(`sourceQuestions:${session.id}`, true);
  const input = { sessionId: session.id, generation: session.generation, requestId: 'source-hook:tool-1', origin: 'source_hook' as const, kind: 'question' as const, toolName: 'AskUserQuestion', input: { questions: [{ question: 'Hangi seçim?', options: [{ label: 'A' }, { label: 'B' }] }] }, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const decision = (contentHash: string) => ({ generation: session.generation, contentHash, deviceId: 'synthetic-device', decision: { behavior: 'allow' as const, answers: { 'Hangi seçim?': 'A' } } });
  return { store, session, input, decision };
}

describe('kaynak hook karar yetkisi', () => {
  it.each(['create', 'decide', 'apply'] as const)('oturumun kaynak soru yetkisi kapanınca %s işlemini engeller', phase => {
    const { store, session, input, decision } = fixture();
    const interaction = phase === 'create' ? undefined : store.createInteraction(input);
    if (phase === 'apply') store.decideInteraction(interaction!.id, decision(interaction!.contentHash));
    store.setSetting(`sourceQuestions:${session.id}`, false);
    const action = phase === 'create' ? () => store.createInteraction(input)
      : phase === 'decide' ? () => store.decideInteraction(interaction!.id, decision(interaction!.contentHash))
        : () => store.markInteractionApplied(interaction!.id, session.generation);
    expect(action).toThrow();
    expect(store.getSession(session.id)!.controlEnabled).toBe(false);
  });
  it('yalnız bağlı soruya yanıt verir, kaynak için mesaj kontrolünü açmaz', () => {
    const { store, session, input, decision } = fixture();
    const interaction = store.createInteraction(input);
    expect(interaction.origin).toBe('source_hook');
    expect(store.decideInteraction(interaction.id, decision(interaction.contentHash)).status).toBe('answered');
    expect(store.markInteractionApplied(interaction.id, session.generation).appliedAt).toBeTruthy();
    expect(store.getSession(session.id)!.controlEnabled).toBe(false);
    expect(() => store.enqueueMessage(session.id, { generation: session.generation, clientId: 'source-message', text: 'Gönderilmemeli' })).toThrow();
  });
  it('kaynak koptuktan sonra seçimi kabul etmez ve yanıtlanmış teslim edilmemiş kararı iptal eder', () => {
    const { store, session, input, decision } = fixture();
    const interaction = store.createInteraction(input);
    store.decideInteraction(interaction.id, decision(interaction.contentHash));
    store.disconnectSourceHook(interaction.id);
    expect(store.getInteraction(interaction.id)?.status).toBe('cancelled');
    expect(() => store.markInteractionApplied(interaction.id, session.generation)).toThrow();
    expect(store.getSession(session.id)!.state).toBe('offline');
  });
  it('uygulanan bir yanıtı ve aynı kaynak sorusunu yeniden uygulamaz', () => {
    const { store, session, input, decision } = fixture();
    const interaction = store.createInteraction(input);
    store.decideInteraction(interaction.id, decision(interaction.contentHash));
    store.markInteractionApplied(interaction.id, session.generation);
    store.disconnectSourceHook(interaction.id);
    expect(store.getInteraction(interaction.id)?.status).toBe('answered');
    expect(() => store.createInteraction(input)).toThrow();
    expect(() => store.markInteractionApplied(interaction.id, session.generation)).toThrow();
    expect(store.getSession(session.id)!.state).toBe('offline');
  });
  it('gösterim geçmişi ve normal kaynak etkileşimi kendiliğinden onay yetkisi kazanmaz', () => {
    const { store, input, decision } = fixture();
    const interaction = store.createInteraction({ ...input, origin: 'managed' });
    expect(() => store.decideInteraction(interaction.id, decision(interaction.contentHash))).toThrow();
  });
  it('servis yeniden bağlanırken önceki hook kararını geçersiz kılar', () => {
    const { store, input, decision } = fixture();
    const interaction = store.createInteraction(input);
    store.resetSourceHooks();
    expect(() => store.decideInteraction(interaction.id, decision(interaction.contentHash))).toThrow();
    expect(store.getInteraction(interaction.id)?.status).toBe('cancelled');
  });
  it('global kontrol, nesil, içerik ve iki cihaz sınırlarını korur', () => {
    const { store, session, input, decision } = fixture();
    const interaction = store.createInteraction(input);
    expect(() => store.decideInteraction(interaction.id, { ...decision(interaction.contentHash), generation: 'wrong' })).toThrow();
    expect(() => store.decideInteraction(interaction.id, decision('wrong'))).toThrow();
    store.setSetting('remoteControlEnabled', false);
    expect(() => store.decideInteraction(interaction.id, decision(interaction.contentHash))).toThrow();
    store.setSetting('remoteControlEnabled', true);
    store.decideInteraction(interaction.id, decision(interaction.contentHash));
    expect(() => store.decideInteraction(interaction.id, { ...decision(interaction.contentHash), deviceId: 'second-device' })).toThrow();
    store.updateSession(session.id, { generation: 'next-generation' });
    expect(() => store.markInteractionApplied(interaction.id, session.generation)).toThrow();
  });
});
