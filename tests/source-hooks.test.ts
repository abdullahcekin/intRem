import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceHooks } from '../src/server/source-hooks.js';
import { Store } from '../src/server/store.js';
import type { AppConfig } from '../src/server/config.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } throw new Error('Beklenen olay gelmedi'); }
async function fixture(beforeVerify?: () => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'intrem-hooks-'));
  const store = new Store(path.join(dir, 'data.sqlite'));
  const project = store.createProject({ name: 'Sentetik kaynak', cwd: dir, host: 'synthetic' });
  const session = store.createSession({ projectId: project.id, source: 'imported', sourcePid: 42, sourceStart: '100', claudeSessionId: randomUUID() });
  store.setSetting(`sourceQuestions:${session.id}`, true);
  const config = { dataDir: dir, claudeHome: path.join(dir, '.claude'), allowedRoots: [dir] } as AppConfig;
  let valid = true, hookStart = '100';
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\intrem-test-${randomUUID()}` : path.join(dir, 'hook.sock');
  const hooks = new SourceHooks(config, store, { socketPath, pollMs: 10, verify: async () => { await beforeVerify?.(); if (!valid) throw new Error('invalid source'); }, identity: async () => ({ parent: 42, start: hookStart }) });
  await hooks.start();
  const sockets: Socket[] = [];
  cleanup.push(async () => { sockets.forEach(socket => socket.destroy()); await hooks.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const request = { hookPid: 43, hook: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tool-1', session_id: session.claudeSessionId, cwd: dir, tool_input: { questions: [{ question: 'Hangi seçim?', options: [{ label: 'A' }, { label: 'B' }] }] } } };
  const open = async (input = request, fragments?: Buffer[]) => {
    const socket = connect(socketPath); sockets.push(socket);
    socket.setEncoding('utf8');
    const response = new Promise<string>(resolve => { let raw = ''; socket.on('data', chunk => { raw += chunk; }); socket.on('error', () => undefined); socket.on('close', () => resolve(raw)); });
    await new Promise<void>(resolve => socket.on('connect', resolve));
    if (fragments) {
      for (const fragment of fragments) { socket.write(fragment); await delay(20); }
    } else socket.write(JSON.stringify(input) + '\n');
    return { socket, response };
  };
  const decide = () => { const item = store.listInteractions(session.id)[0]; store.decideInteraction(item.id, { generation: item.generation, contentHash: item.contentHash, deviceId: 'synthetic-device', decision: { behavior: 'allow', answers: { 'Hangi seçim?': 'B' } } }); return item; };
  return { store, session, hooks, open, decide, request, invalidate: () => { valid = false; }, reusePid: () => { hookStart = '101'; } };
}

describe('yerel kaynak soru bağlantısı', () => {
  it('soket parçalarının ortasında bölünen Türkçe ve emoji karakterlerini korur', async () => {
    const f = await fixture();
    const question = 'İşlem seçimi 🧭?', answer = 'İkinci seçenek ✅';
    const request = { ...f.request, hook: { ...f.request.hook, tool_input: { questions: [{ question, options: [{ label: answer }] }] } } };
    const bytes = Buffer.from(JSON.stringify(request) + '\n');
    const first = bytes.indexOf(Buffer.from('İ')) + 1, second = bytes.indexOf(Buffer.from('🧭')) + 2;
    const connection = await f.open(request, [bytes.subarray(0, first), bytes.subarray(first, second), bytes.subarray(second)]);
    await until(() => f.store.listInteractions().length === 1);
    const item = f.store.listInteractions()[0];
    expect(item.input).toEqual(request.hook.tool_input);
    f.store.decideInteraction(item.id, { generation: item.generation, contentHash: item.contentHash, deviceId: 'synthetic-device', decision: { behavior: 'allow', answers: { [question]: answer } } });
    expect(JSON.parse(await connection.response)).toEqual({ behavior: 'allow', answers: { [question]: answer } });
  });
  it('aynı bağlı kaynağa seçilen yanıtı iletir ve tekrar bağlanarak eski kararı alamaz', async () => {
    const f = await fixture(), connection = await f.open();
    await until(() => f.store.listInteractions().length === 1);
    const item = f.decide();
    expect(JSON.parse(await connection.response)).toEqual({ behavior: 'allow', answers: { 'Hangi seçim?': 'B' } });
    expect(f.store.getInteraction(item.id)?.appliedAt).toBeTruthy();
    const duplicate = await f.open();
    expect(JSON.parse(await duplicate.response)).toEqual({});
    expect(f.store.listInteractions()).toHaveLength(1);
  });
  it('istemci kopunca bekleyen soruyu geçersiz kılar', async () => {
    const f = await fixture(), connection = await f.open();
    await until(() => f.store.listInteractions().length === 1);
    connection.socket.destroy();
    await until(() => f.store.listInteractions()[0].status === 'cancelled');
    expect(() => f.decide()).toThrow();
  });
  it.each(['source', 'pid'] as const)('%s kimliği değişirse seçilen yanıtı göndermez', async change => {
    const f = await fixture(), connection = await f.open();
    await until(() => f.store.listInteractions().length === 1);
    if (change === 'source') f.invalidate(); else f.reusePid();
    const item = f.store.listInteractions()[0];
    await expect(f.hooks.verify(item.id)).rejects.toMatchObject({ code: 'SOURCE_HOOK_DISCONNECTED' });
    expect(await connection.response).not.toContain('allow');
    expect(f.store.getInteraction(item.id)?.status).toBe('cancelled');
  });
  it('geçersiz kaynak eşleşmesini ve alt ajan sorusunu kaydetmez', async () => {
    const f = await fixture(); f.invalidate();
    const invalid = await f.open(); expect(await invalid.response).not.toContain('allow');
    expect(f.store.listInteractions()).toEqual([]);
    const nested = await f.open({ ...f.request, hook: { ...f.request.hook, agent_id: 'subagent' } } as typeof f.request);
    expect(await nested.response).not.toContain('allow'); expect(f.store.listInteractions()).toEqual([]);
  });
  it('yapılandırılmamış oturumun normal terminal akışını değiştirmez', async () => {
    const f = await fixture(); f.store.setSetting(`sourceQuestions:${f.session.id}`, false);
    const connection = await f.open();
    expect(JSON.parse(await connection.response)).toEqual({ passthrough: true });
    expect(f.store.listInteractions()).toEqual([]);
  });
  it('ilk kaynak doğrulaması sürerken kapatılan bağlantıda soru oluşturmaz', async () => {
    let verifying = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(async () => { verifying = true; await gate; });
    const connection = await f.open();
    try {
      await until(() => verifying);
      f.hooks.disconnectSession(f.session.id);
      f.store.setSetting(`sourceQuestions:${f.session.id}`, false);
    } finally { release(); }
    const response = await Promise.race([connection.response, delay(1000).then(() => null)]);
    expect(response).not.toBeNull();
    expect(JSON.parse(response!)).toEqual({});
    expect(f.store.listInteractions()).toEqual([]);
  });
  it('oturumun kaynak soru ayarı kapanınca açık bağlantıyı geçersiz kılar', async () => {
    const f = await fixture(), connection = await f.open();
    await until(() => f.store.listInteractions().length === 1);
    f.store.setSetting(`sourceQuestions:${f.session.id}`, false);
    const item = f.store.listInteractions()[0];
    await expect(f.hooks.verify(item.id)).rejects.toMatchObject({ code: 'SOURCE_HOOK_DISCONNECTED' });
    expect(await connection.response).not.toContain('allow');
    expect(f.store.getInteraction(item.id)?.status).toBe('cancelled');
  });
});
