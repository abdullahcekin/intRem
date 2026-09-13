import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CanUseTool, Options, SDKMessage, SDKUserMessage, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { Store } from '../src/server/store.js';
import { Runner, type RuntimeQuery } from '../src/runtime/runner.js';

class FakeQuery implements RuntimeQuery {
  events: SDKMessage[] = [];
  readers: ((result: IteratorResult<SDKMessage>) => void)[] = [];
  inputs: SDKUserMessage[] = [];
  closed = false;
  interrupted = false;
  constructor(prompt: AsyncIterable<SDKUserMessage>, readonly options: Options) {
    void (async () => { for await (const input of prompt) this.inputs.push(input); })();
  }
  emit(event: Record<string, unknown>) {
    const reader = this.readers.shift();
    if (reader) reader({ value: event as SDKMessage, done: false }); else this.events.push(event as SDKMessage);
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return { next: async () => this.events.length ? { value: this.events.shift()!, done: false } : this.closed ? { value: undefined, done: true } : new Promise(resolve => this.readers.push(resolve)) };
  }
  async interrupt() { this.interrupted = true; return undefined; }
  close() { this.closed = true; for (const resolve of this.readers.splice(0)) resolve({ value: undefined, done: true }); }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  expect(check()).toBe(true);
}

describe('SDK runner kalıcı kuyruk ve callback yaşam döngüsü', () => {
  let directory: string;
  let store: Store;
  let runner: Runner;
  let query: FakeQuery;
  let launches: number;
  let sessionId: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'intrem-runner-'));
    store = new Store(path.join(directory, 'intrem.db'));
    const project = store.createProject({ name: 'Example', cwd: directory, host: 'localhost' });
    sessionId = store.createSession({ projectId: project.id }).id;
    launches = 0;
    runner = new Runner(store, {
      allowedRoots: [directory], claudeHome: directory, pollIntervalMs: 10000, interactionPollMs: 5,
      interactionTimeoutMs: 1000,
      query: ({ prompt, options }) => { launches++; query = new FakeQuery(prompt, options); return query; },
    });
    await runner.start();
  });
  afterEach(async () => { await runner.stop(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const enqueue = (text = 'Merhaba') => store.enqueueMessage(sessionId, { clientId: crypto.randomUUID(), text, generation: store.getSession(sessionId)!.generation });
  const tool = (name: string, input: Record<string, unknown>, signal = new AbortController().signal) => query.options.canUseTool!(name, input, { signal, requestId: crypto.randomUUID(), toolUseID: crypto.randomUUID() });

  it('boş oturum başlatmaz, mesajı kalıcı claim sonrası bir kez teslim eder, cevabı saklar', async () => {
    expect(launches).toBe(0);
    const message = enqueue();
    await runner.tick();
    await until(() => query.inputs.length === 1);
    expect(store.getSession(sessionId)?.actualModel).toBeNull();
    expect(query.options).toMatchObject({ settingSources: ['user', 'project', 'local'], permissionMode: 'default', env: { CLAUDE_CONFIG_DIR: directory } });
    expect(query.options.allowDangerouslySkipPermissions).not.toBe(true);
    expect(store.listMessages(sessionId)[0].state).toBe('processing');
    query.emit({ type: 'system', subtype: 'init', session_id: 'sdk-session', model: 'configured-only' });
    query.emit({ type: 'assistant', parent_tool_use_id: null, uuid: 'answer-one', session_id: 'sdk-session', message: { model: 'confirmed-model', content: [{ type: 'text', text: 'Merhaba yanıtı' }] } });
    query.emit({ type: 'result', subtype: 'success', session_id: 'sdk-session', result: 'Merhaba yanıtı', is_error: false });
    await until(() => store.listMessages(sessionId).find(x => x.id === message.id)?.state === 'completed');
    expect(store.listMessages(sessionId).filter(x => x.role === 'assistant').map(x => x.text)).toEqual(['Merhaba yanıtı']);
    expect(store.getSession(sessionId)).toMatchObject({ claudeSessionId: 'sdk-session', actualModel: 'confirmed-model', account: null, state: 'idle' });
    await runner.tick();
    expect(query.inputs).toHaveLength(1);
  });

  it('tam soru girdisini koruyup yalnız onaylanmış cevabı SDK callbackine uygular', async () => {
    enqueue(); await runner.tick();
    const input = { questions: [{ question: 'Renk?', header: 'Renk', options: [{ label: 'Mavi' }, { label: 'Yeşil' }] }], metadata: { hidden: 'preserved' } };
    const pending = tool('AskUserQuestion', input);
    const interaction = store.listInteractions(sessionId)[0];
    expect(interaction.input).toEqual(input);
    expect(store.getSession(sessionId)?.state).toBe('waiting_answer');
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow', answers: { 'Renk?': 'Mavi' } } });
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Renk?': 'Mavi' } } });
    expect(store.getInteraction(interaction.id)?.appliedAt).not.toBeNull();
  });

  it('değişen araç girdisini veya callback abortunu allow yapmaz', async () => {
    enqueue(); await runner.tick();
    const input = { command: 'git status' };
    const pending = tool('Bash', input);
    const interaction = store.listInteractions(sessionId)[0];
    input.command = 'git push';
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    expect(await pending).toMatchObject({ behavior: 'deny' });
    const controller = new AbortController();
    const aborted = tool('ExitPlanMode', { plan: 'Onay bekleyen plan' }, controller.signal);
    controller.abort();
    expect(await aborted).toMatchObject({ behavior: 'deny' });
  });

  it('SDK bağlantısı kaybolunca belirsiz mesajı yeniden yollamaz', async () => {
    enqueue(); await runner.tick();
    query.close();
    await until(() => store.getSession(sessionId)?.state === 'delivery_unknown');
    await runner.tick();
    expect(launches).toBe(1);
    expect(store.listMessages(sessionId)[0].state).toBe('delivery_unknown');
  });

  it('eski stop generationını yok sayar, açık stop kuyruğu iptal eder ve kendi SDK sürecini kapatır', async () => {
    enqueue(); await runner.tick(); enqueue('İkinci mesaj');
    store.setSetting(`stop:${sessionId}`, 'older-generation');
    await runner.tick(); expect(query.closed).toBe(false);
    const generation = store.getSession(sessionId)!.generation;
    store.setSetting(`stop:${sessionId}`, generation);
    await runner.tick();
    expect(query.interrupted).toBe(true); expect(query.closed).toBe(true);
    expect(store.listMessages(sessionId).filter(x => x.role === 'user').map(x => x.state)).toEqual(['failed', 'cancelled']);
    expect(store.getSession(sessionId)?.generation).not.toBe(generation);
    expect(store.getSession(sessionId)).toMatchObject({ state: 'idle', controlEnabled: true });
  });

  it('runner restart bekleyen callbackleri ve teslimi belirsiz yapar, tekrar başlatmaz', async () => {
    const message = enqueue(); store.claimNextMessage(sessionId); store.updateMessage(message.id, { state: 'processing' });
    await runner.stop();
    runner = new Runner(store, { allowedRoots: [directory], claudeHome: directory, query: () => { throw new Error('must not resume'); } });
    await runner.start();
    expect(store.getSession(sessionId)).toMatchObject({ state: 'delivery_unknown', controlEnabled: false });
    expect(store.listMessages(sessionId)[0].state).toBe('delivery_unknown');
  });

  it('ikinci runner aynı kuyrukta recovery çalıştıramaz; ilk runner sahipliğini korur', async () => {
    enqueue(); await runner.tick();
    const recover = vi.spyOn(store, 'recoverDeliveries');
    const second = new Runner(store, { allowedRoots: [directory], claudeHome: directory });
    await expect(second.start()).rejects.toMatchObject({ code: 'RUNNER_ALREADY_RUNNING' });
    await second.stop();
    expect(recover).not.toHaveBeenCalled();
    expect(store.listMessages(sessionId)[0].state).toBe('processing');
    expect(store.getSetting('runnerHeartbeat', '')).not.toBe('');
  });

  it('kontrollü devir source=managed olsa da canlı kaynak kimliğini yeniden doğrular', async () => {
    await runner.stop();
    const checkSource = vi.fn().mockResolvedValue(true);
    runner = new Runner(store, { allowedRoots: [directory], claudeHome: directory, isSourceAlive: checkSource, query: () => { throw new Error('must not launch'); } });
    store.updateSession(sessionId, { source: 'managed', sourcePid: 42, sourceStart: '12345' });
    enqueue(); await runner.start();
    expect(checkSource).toHaveBeenCalled();
    expect(store.listMessages(sessionId)[0].state).toBe('queued');
  });

  it('kaynak süreç doğrulaması belirsizse teslimi başlatmaz', async () => {
    await runner.stop();
    runner = new Runner(store, { allowedRoots: [directory], claudeHome: directory, isSourceAlive: async () => { throw new Error('proc inaccessible'); }, query: () => { throw new Error('must not launch'); } });
    store.updateSession(sessionId, { source: 'managed', sourcePid: 42, sourceStart: '12345' });
    enqueue(); await runner.start();
    expect(store.listMessages(sessionId)[0].state).toBe('queued');
    expect(store.getSession(sessionId)?.controlEnabled).toBe(false);
  });

  it('karar kaydedildikten sonra global kontrol kapanırsa SDK allow uygulanmaz', async () => {
    enqueue(); await runner.tick();
    const pending = tool('Bash', { command: 'git status' });
    const interaction = store.listInteractions(sessionId)[0];
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    store.setSetting('remoteControlEnabled', false);
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(store.getInteraction(interaction.id)?.appliedAt).toBeNull();
  });

  it('tüketicisiz kalan kararı iptal eder; diğer callbacki korur ve kontrol açılınca kuyruk ilerler', async () => {
    const message = enqueue(); await runner.tick();
    const controller = new AbortController();
    const abandoned = tool('Bash', { command: 'git status' }, controller.signal);
    const first = store.listInteractions(sessionId)[0];
    const remaining = tool('AskUserQuestion', { questions: [{ question: 'Devam?', options: [{ label: 'Evet' }] }] });
    const second = store.listInteractions(sessionId).find(value => value.id !== first.id)!;
    store.decideInteraction(first.id, { generation: first.generation, contentHash: first.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    controller.abort();
    expect(await abandoned).toMatchObject({ behavior: 'deny' });
    expect(store.getInteraction(first.id)).toMatchObject({ status: 'cancelled', appliedAt: null });
    expect(store.getInteraction(second.id)?.status).toBe('pending');
    store.setSetting('remoteControlEnabled', false);
    expect(await remaining).toMatchObject({ behavior: 'deny' });
    expect(store.getInteraction(second.id)?.status).toBe('cancelled');
    query.emit({ type: 'result', subtype: 'success', session_id: 'sdk-session', result: 'Tur tamamlandı.', is_error: false });
    await until(() => store.listMessages(sessionId).find(value => value.id === message.id)?.state === 'completed');
    store.setSetting('remoteControlEnabled', true);
    enqueue('Yeni komut'); await runner.tick();
    await until(() => query.inputs.length === 2);
  });

  it('stop gecikmeli iterator kapanışını bekler; Store kapandıktan sonra olay yazmaz', async () => {
    const stoppingStore = new Store(path.join(directory, 'stopping.db'));
    const project = stoppingStore.createProject({ name: 'Shutdown', cwd: directory, host: 'localhost' });
    const session = stoppingStore.createSession({ projectId: project.id });
    stoppingStore.enqueueMessage(session.id, { clientId: crypto.randomUUID(), text: 'Başla', generation: session.generation });
    let iteratorFinished = false;
    let rejectRead: (error: Error) => void = () => undefined;
    const delayedQuery: RuntimeQuery = {
      interrupt: async () => undefined,
      close: () => { setTimeout(() => { iteratorFinished = true; rejectRead(new Error('Late iterator rejection')); }, 30); },
      [Symbol.asyncIterator]: () => ({ next: () => new Promise((_resolve, reject) => { rejectRead = reject; }) }),
    };
    const stoppingRunner = new Runner(stoppingStore, { allowedRoots: [directory], claudeHome: directory, query: () => delayedQuery });
    await stoppingRunner.start();
    await stoppingRunner.stop();
    const finishedAtStop = iteratorFinished;
    const writes = vi.spyOn(stoppingStore, 'event');
    stoppingStore.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(finishedAtStop).toBe(true);
    expect(writes).not.toHaveBeenCalled();
  });

  it('somut plan içermeyen ExitPlanMode çağrısına uygulanabilir onay üretmez', async () => {
    enqueue(); await runner.tick();
    expect(await tool('ExitPlanMode', {})).toMatchObject({ behavior: 'deny' });
    expect(store.listInteractions(sessionId)).toEqual([]);
  });

  it('ExitPlanMode hook planını otomatik onaylamadan mevcut karar kapısına taşır', async () => {
    enqueue(); await runner.tick();
    const hook = query.options.hooks?.PreToolUse?.find(entry => entry.matcher === 'ExitPlanMode')?.hooks[0];
    expect(hook).toBeDefined();
    const signal = new AbortController().signal;
    const toolUseID = crypto.randomUUID();
    const input = { plan: 'Yalnız test çalıştır.', planFilePath: path.join(directory, 'plan.md'), allowedPrompts: [] };
    const event = { hook_event_name: 'PreToolUse' as const, session_id: 'sdk-session', cwd: directory, transcript_path: '', tool_name: 'ExitPlanMode', tool_use_id: toolUseID, tool_input: input };
    for (const missing of [{}, { plan: ' ' }]) {
      expect(await hook!({ ...event, tool_input: missing }, toolUseID, { signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
    const result = await hook!(event, toolUseID, { signal }) as SyncHookJSONOutput;
    expect(result).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', updatedInput: input } });
    expect(store.listInteractions(sessionId)).toEqual([]);
    const forwarded = (result.hookSpecificOutput as { updatedInput: Record<string, unknown> }).updatedInput;
    input.plan = 'Başka bir plan';
    expect(forwarded.plan).toBe('Yalnız test çalıştır.');
    const pending = query.options.canUseTool!('ExitPlanMode', forwarded, { signal, toolUseID, requestId: toolUseID });
    const interaction = store.listInteractions(sessionId)[0];
    expect(interaction).toMatchObject({ kind: 'plan', input: forwarded, requestId: toolUseID, status: 'pending', appliedAt: null });
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: forwarded });
  });

  it('SDK plan snapshotını oturum, nesil ve istek kimliğine bağlar; aynı kararı tekrar uygulamaz', async () => {
    enqueue(); await runner.tick();
    const input = { plan: '# Uygulama planı\n\n1. Dar değişikliği yap.\n2. Testi çalıştır.', planFilePath: path.join(directory, 'sdk-plan.md'), allowedPrompts: [] };
    const callback = { signal: new AbortController().signal, requestId: crypto.randomUUID(), toolUseID: crypto.randomUUID() };
    const pending = query.options.canUseTool!('ExitPlanMode', input, callback);
    const interaction = store.listInteractions(sessionId)[0];
    expect(interaction).toMatchObject({ sessionId, generation: store.getSession(sessionId)!.generation, requestId: callback.requestId, kind: 'plan', toolName: 'ExitPlanMode', input });
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: input });
    expect(store.getInteraction(interaction.id)?.appliedAt).not.toBeNull();
    expect(await query.options.canUseTool!('ExitPlanMode', input, callback)).toMatchObject({ behavior: 'deny' });
    expect(store.listInteractions(sessionId)).toHaveLength(1);
  });

  it('onay beklerken plan metni değişirse eski içerik onayını uygulamaz', async () => {
    enqueue(); await runner.tick();
    const input = { plan: 'Yalnız test dosyasını değiştir.' };
    const pending = tool('ExitPlanMode', input);
    const interaction = store.listInteractions(sessionId)[0];
    input.plan = 'Uygulama dosyalarını da değiştir.';
    expect(store.getInteraction(interaction.id)?.input.plan).toBe('Yalnız test dosyasını değiştir.');
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(store.getInteraction(interaction.id)?.appliedAt).toBeNull();
  });

  it('onay kaydedildikten sonra nesli değişen planı yeni oturuma uygulamaz', async () => {
    enqueue(); await runner.tick();
    const pending = tool('ExitPlanMode', { plan: 'Onay bekleyen plan.' });
    const interaction = store.listInteractions(sessionId)[0];
    store.decideInteraction(interaction.id, { generation: interaction.generation, contentHash: interaction.contentHash, deviceId: 'test-device', decision: { behavior: 'allow' } });
    store.updateSession(sessionId, { generation: crypto.randomUUID() });
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(store.getInteraction(interaction.id)?.appliedAt).toBeNull();
  });

  it('SDK turu biterse bekleyen planı iptal eder ve gecikmiş callbacki allow yapmaz', async () => {
    const message = enqueue(); await runner.tick();
    const pending = tool('ExitPlanMode', { plan: 'Tura bağlı plan.' });
    const interaction = store.listInteractions(sessionId)[0];
    query.emit({ type: 'result', subtype: 'success', session_id: 'sdk-session', result: 'Tur sona erdi.', is_error: false });
    await until(() => store.listMessages(sessionId).find(x => x.id === message.id)?.state === 'completed');
    expect(store.getInteraction(interaction.id)?.status).toBe('cancelled');
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(store.getSession(sessionId)?.state).toBe('idle');
  });
});
