import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CanUseTool, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
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

  it('somut plan içermeyen ExitPlanMode çağrısına uygulanabilir onay üretmez', async () => {
    enqueue(); await runner.tick();
    expect(await tool('ExitPlanMode', {})).toMatchObject({ behavior: 'deny' });
    expect(store.listInteractions(sessionId)).toEqual([]);
  });
});
