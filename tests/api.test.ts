import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { Auth } from '../src/server/auth.js';
import { SourceHooks } from '../src/server/source-hooks.js';
import type { AppConfig } from '../src/server/config.js';

const cleanup: (() => Promise<void>)[] = [];
async function fixture(localSourceHook = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'intrem-api-'));
  const config: AppConfig = { dataDir: dir, dbPath: path.join(dir, 'db.sqlite'), host: '127.0.0.1', port: 4100, origin: 'https://intrem.test', rpId: 'intrem.test', secureCookies: true, allowedRoots: [dir], claudeHome: path.join(dir, '.claude'), claudeExecutable: 'missing-claude', codexExecutable: 'missing-codex', omnirouteUrl: null, pushSubject: 'https://intrem.test' };
  const store = new Store(config.dbPath), auth = new Auth(store.db);
  auth.saveCredential({ id: 'key', publicKey: new Uint8Array([1]), counter: 0, transports: [] }, true);
  const session = auth.issueSession('test', 'key');
  const sourceHooks = localSourceHook ? new SourceHooks(config, store, {
    socketPath: process.platform === 'win32' ? `\\\\.\\pipe\\intrem-api-${randomUUID()}` : path.join(dir, 'hook.sock'),
    verify: async () => undefined,
    identity: async () => ({ parent: 42, start: '100' }),
    pollMs: 10,
  }) : new SourceHooks(config, store);
  const app = await createApp({ config, store, auth, sourceHooks });
  const headers = { cookie: `intrem_session=${session.token}`, origin: config.origin, 'x-csrf-token': session.csrfToken };
  cleanup.push(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, store, auth, session, headers, dir, sourceHooks };
}
afterEach(async () => { vi.unstubAllGlobals(); for (const done of cleanup.splice(0)) await done(); });
describe('HTTP security and command targeting', () => {
  it('exposes only the persisted cost snapshot to an authenticated session', async () => {
    const { app, store, headers, dir } = await fixture();
    const project = store.createProject({ name: 'Cost fixture', cwd: dir, host: 'localhost' });
    const session = store.createSession({ projectId: project.id });
    store.recordSessionCost(session.id, session.generation, 0.0125);
    expect((await app.inject('/api/snapshot')).statusCode).toBe(401);
    const response = await app.inject({ url: '/api/snapshot', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessions.find((row: { id: string }) => row.id === session.id).costEstimate).toEqual({ costUsd: 0.0125, observedAt: expect.any(String) });
  });
  it('keeps gateway inventory behind authentication and Origin checks', async () => {
    const { app, headers } = await fixture();
    const fetchGateway = vi.fn();
    vi.stubGlobal('fetch', fetchGateway);
    const publicHealth = await app.inject('/health');
    expect(publicHealth.json()).toEqual({ ok: true });
    expect((await app.inject('/api/health')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/health', headers: { ...headers, origin: 'https://evil.test' } })).statusCode).toBe(403);
    expect(fetchGateway).not.toHaveBeenCalled();
    const health = await app.inject({ url: '/api/health', headers });
    expect(health.statusCode).toBe(200);
    expect(health.json().omniroute.setup.connections).toEqual({ state: 'not_configured', count: null });
  });
  it('cannot bypass authentication using non-canonical API paths', async () => {
    const { app } = await fixture();
    for (const url of ['/api/snapshot', '/%61pi/snapshot', '/api%2Fsnapshot', '//api/snapshot', '/api/../api/snapshot']) {
      const response = await app.inject(url);
      expect([400, 401, 404]).toContain(response.statusCode);
    }
  });
  it('requires a login, matching Origin and CSRF on command routes', async () => {
    const { app, headers, dir } = await fixture();
    expect((await app.inject('/api/snapshot')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/projects', method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, payload: { name: 'X', cwd: dir } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/projects', method: 'POST', headers: { ...headers, 'x-csrf-token': 'wrong' }, payload: { name: 'X', cwd: dir } })).statusCode).toBe(403);
  });
  it('protects source question configuration with authentication, Origin, CSRF and the imported generation', async () => {
    const { app, store, headers, dir } = await fixture();
    const project = store.createProject({ name: 'Kaynak güvenlik testi', cwd: dir, host: 'localhost' });
    const source = store.createSession({ projectId: project.id, source: 'imported' });
    const managed = store.createSession({ projectId: project.id });
    const url = `/api/sessions/${source.id}/source-questions`, payload = { generation: source.generation, enabled: false };
    store.setSetting(`sourceQuestions:${source.id}`, true);
    for (const [requestHeaders, status] of [
      [{ origin: headers.origin }, 401],
      [{ ...headers, origin: 'https://evil.test' }, 403],
      [{ ...headers, 'x-csrf-token': 'wrong' }, 403],
    ] as const) {
      expect((await app.inject({ method: 'POST', url, headers: requestHeaders, payload })).statusCode).toBe(status);
      expect(store.getSetting(`sourceQuestions:${source.id}`, false)).toBe(true);
    }
    const stale = await app.inject({ method: 'POST', url, headers, payload: { ...payload, generation: 'old' } });
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe('STALE_GENERATION');
    expect(store.getSetting(`sourceQuestions:${source.id}`, false)).toBe(true);
    const wrongSource = await app.inject({ method: 'POST', url: `/api/sessions/${managed.id}/source-questions`, headers, payload: { generation: managed.generation, enabled: false } });
    expect(wrongSource.statusCode).toBe(409); expect(wrongSource.json().code).toBe('STALE_GENERATION');
    store.setSetting('remoteControlEnabled', false);
    const disabled = await app.inject({ method: 'POST', url, headers, payload: { ...payload, enabled: true } });
    expect(disabled.statusCode).toBe(409); expect(disabled.json().code).toBe('CONTROL_DISABLED');
    const response = await app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ configured: false });
    expect(store.getSetting(`sourceQuestions:${source.id}`, true)).toBe(false);
  });
  it('requires authenticated current decisions for a live source question without enabling ordinary messages', async () => {
    const { app, store, headers, dir, sourceHooks } = await fixture(true);
    await app.ready();
    const project = store.createProject({ name: 'Canlı kaynak HTTP testi', cwd: dir, host: 'localhost' });
    const source = store.createSession({ projectId: project.id, source: 'imported', sourcePid: 42, sourceStart: '100', claudeSessionId: randomUUID() });
    store.setSetting(`sourceQuestions:${source.id}`, true);
    const socket = connect(sourceHooks.socketPath);
    const response = new Promise<string>(resolve => { let text = ''; socket.on('data', chunk => { text += chunk; }); socket.on('error', () => undefined); socket.on('close', () => resolve(text)); });
    try {
      await new Promise<void>(resolve => socket.once('connect', resolve));
      socket.write(JSON.stringify({ hookPid: 43, hook: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'api-question', session_id: source.claudeSessionId, cwd: dir, tool_input: { questions: [{ question: 'Hangisi?', options: [{ label: 'A' }, { label: 'B' }] }] } } }) + '\n');
      for (let i = 0; i < 100 && store.listInteractions(source.id).length === 0; i++) await delay(10);
      const item = store.listInteractions(source.id)[0]; expect(item).toBeDefined();
      const url = `/api/interactions/${item.id}/decision`, payload = { generation: item.generation, contentHash: item.contentHash, behavior: 'allow', answers: { 'Hangisi?': 'B' } };
      for (const [requestHeaders, status] of [
        [{ origin: headers.origin }, 401],
        [{ ...headers, origin: 'https://evil.test' }, 403],
        [{ ...headers, 'x-csrf-token': 'wrong' }, 403],
      ] as const) {
        expect((await app.inject({ method: 'POST', url, headers: requestHeaders, payload })).statusCode).toBe(status);
        expect(store.getInteraction(item.id)?.status).toBe('pending');
      }
      for (const [override, code] of [[{ generation: 'old' }, 'STALE_GENERATION'], [{ contentHash: 'wrong' }, 'CONTENT_MISMATCH']] as const) {
        const rejected = await app.inject({ method: 'POST', url, headers, payload: { ...payload, ...override } });
        expect(rejected.statusCode).toBe(409); expect(rejected.json().code).toBe(code);
        expect(store.getInteraction(item.id)?.status).toBe('pending');
      }
      const message = await app.inject({ method: 'POST', url: `/api/sessions/${source.id}/messages`, headers, payload: { generation: source.generation, clientId: 'no-source-message', text: 'Gönderilmemeli' } });
      expect(message.statusCode).toBe(409); expect(store.listMessages(source.id)).toEqual([]);
      const accepted = await app.inject({ method: 'POST', url, headers, payload });
      expect(accepted.statusCode).toBe(200); expect(accepted.json().status).toBe('answered');
      expect(JSON.parse(await response)).toEqual({ behavior: 'allow', answers: { 'Hangisi?': 'B' } });
      expect(store.getSession(source.id)?.controlEnabled).toBe(false);
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(409);
    } finally { socket.destroy(); }
  });
  it('keeps managed decisions separate from imported history and refuses disconnected source decisions', async () => {
    const { app, store, headers, dir } = await fixture();
    await app.ready();
    const project = store.createProject({ name: 'Karar kaynağı testi', cwd: dir, host: 'localhost' });
    for (const source of ['managed', 'imported'] as const) {
      const session = store.createSession({ projectId: project.id, source });
      const item = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'question', kind: 'question', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Hangisi?', options: [{ label: 'A' }] }] }, expiresAt: new Date(Date.now() + 60000).toISOString() });
      const decision = await app.inject({ method: 'POST', url: `/api/interactions/${item.id}/decision`, headers, payload: { generation: item.generation, contentHash: item.contentHash, behavior: 'allow', answers: { 'Hangisi?': 'A' } } });
      expect(decision.statusCode).toBe(source === 'managed' ? 200 : 409);
      if (source === 'imported') {
        store.setSetting(`sourceQuestions:${session.id}`, true);
        const disconnected = store.createInteraction({ ...item, origin: 'source_hook', requestId: 'source-hook:disconnected' });
        const rejected = await app.inject({ method: 'POST', url: `/api/interactions/${disconnected.id}/decision`, headers, payload: { generation: disconnected.generation, contentHash: disconnected.contentHash, behavior: 'allow', answers: { 'Hangisi?': 'A' } } });
        expect(rejected.statusCode).toBe(409); expect(rejected.json().code).toBe('SOURCE_HOOK_DISCONNECTED');
        expect(store.getInteraction(disconnected.id)?.status).toBe('cancelled');
      }
    }
  });
  it('rejects paths outside the allowlist and stale generation commands', async () => {
    const { app, headers, dir } = await fixture();
    expect((await app.inject({ url: '/api/projects', method: 'POST', headers, payload: { name: 'outside', cwd: path.dirname(dir) } })).statusCode).toBe(403);
    const project = (await app.inject({ url: '/api/projects', method: 'POST', headers, payload: { name: 'Pilot', cwd: dir } })).json();
    const session = (await app.inject({ url: '/api/sessions', method: 'POST', headers, payload: { projectId: project.id } })).json();
    const stale = await app.inject({ url: `/api/sessions/${session.id}/messages`, method: 'POST', headers, payload: { generation: 'old', clientId: 'm1', text: 'test' } });
    expect(stale.statusCode).toBe(409);
    const ok = await app.inject({ url: `/api/sessions/${session.id}/messages`, method: 'POST', headers, payload: { generation: session.generation, clientId: 'm1', text: 'test' } });
    expect(ok.statusCode).toBe(200);
    const duplicate = await app.inject({ url: `/api/sessions/${session.id}/messages`, method: 'POST', headers, payload: { generation: session.generation, clientId: 'm1', text: 'test' } });
    expect(duplicate.json().id).toBe(ok.json().id);
  });
  it('revoked credentials immediately lose API access and push endpoints cannot target private hosts', async () => {
    const { app, headers, auth, session } = await fixture();
    const push = await app.inject({ url: '/api/devices/push', method: 'POST', headers, payload: { subscription: { endpoint: 'https://127.0.0.1/private', keys: { auth: 'a', p256dh: 'b' } } } });
    expect(push.statusCode).toBe(400);
    auth.revokeDevice(session.device.id);
    expect((await app.inject({ url: '/api/snapshot', headers })).statusCode).toBe(401);
  });
  it('does not expose project directories through the unauthenticated health endpoint', async () => {
    const { app, dir } = await fixture();
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(dir);
    expect((await app.inject('/api/health')).statusCode).toBe(401);
  });
});
