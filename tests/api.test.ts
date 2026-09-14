import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { Auth } from '../src/server/auth.js';
import type { AppConfig } from '../src/server/config.js';

const cleanup: (() => Promise<void>)[] = [];
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'intrem-api-'));
  const config: AppConfig = { dataDir: dir, dbPath: path.join(dir, 'db.sqlite'), host: '127.0.0.1', port: 4100, origin: 'https://intrem.test', rpId: 'intrem.test', secureCookies: true, allowedRoots: [dir], claudeHome: path.join(dir, '.claude'), claudeExecutable: 'missing-claude', codexExecutable: 'missing-codex', omnirouteUrl: null, pushSubject: 'https://intrem.test' };
  const store = new Store(config.dbPath), auth = new Auth(store.db);
  auth.saveCredential({ id: 'key', publicKey: new Uint8Array([1]), counter: 0, transports: [] }, true);
  const session = auth.issueSession('test', 'key');
  const app = await createApp({ config, store, auth });
  const headers = { cookie: `intrem_session=${session.token}`, origin: config.origin, 'x-csrf-token': session.csrfToken };
  cleanup.push(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, store, auth, session, headers, dir };
}
afterEach(async () => { vi.unstubAllGlobals(); for (const done of cleanup.splice(0)) await done(); });
describe('HTTP security and command targeting', () => {
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
