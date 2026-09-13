import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Auth } from '../src/server/auth.js';

const open: DatabaseSync[] = [];
function fixture() { const db = new DatabaseSync(':memory:'); open.push(db); return { db, auth: new Auth(db) }; }
afterEach(() => open.splice(0).forEach(db => db.close()));
describe('Auth persistence boundaries', () => {
  it('consumes a browser-bound challenge once, with kind and expiry checking', () => {
    const { auth } = fixture();
    const token = auth.createChallenge('login', 'challenge', false);
    expect(() => auth.consumeChallenge(token, 'registration')).toThrow();
    const correct = auth.createChallenge('login', 'right', false);
    expect(auth.consumeChallenge(correct, 'login').challenge).toBe('right');
    expect(() => auth.consumeChallenge(correct, 'login')).toThrow();
    const expired = auth.createChallenge('login', 'expired', false, Date.now() - 1);
    expect(() => auth.consumeChallenge(expired, 'login')).toThrow();
  });
  it('stores only hashed session secrets and revokes the passkey and related sessions', () => {
    const { db, auth } = fixture();
    auth.saveCredential({ id: 'key', publicKey: new Uint8Array([1,2,3]), counter: 0, transports: [] }, true);
    const first = auth.issueSession('Telefon', 'key');
    const second = auth.issueSession('Bilgisayar', 'key');
    expect(auth.authenticate(first.token)?.device.id).toBe(first.device.id);
    expect(JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all())).not.toContain(first.token);
    auth.revokeDevice(first.device.id);
    expect(auth.authenticate(first.token)).toBeNull();
    expect(auth.authenticate(second.token)).toBeNull();
    expect(auth.getCredential('key')).toBeUndefined();
  });
  it('allows bootstrap once and rejects a competing initial registration', () => {
    const { auth } = fixture();
    const token = auth.resetBootstrap();
    expect(auth.verifyBootstrap('wrong')).toBe(false);
    expect(auth.verifyBootstrap(token)).toBe(true);
    auth.saveCredential({ id: 'key1', publicKey: new Uint8Array([1]), counter: 0, transports: [] }, true);
    expect(auth.verifyBootstrap(token)).toBe(false);
    expect(() => auth.saveCredential({ id: 'key2', publicKey: new Uint8Array([2]), counter: 0, transports: [] }, true)).toThrow();
  });
});
