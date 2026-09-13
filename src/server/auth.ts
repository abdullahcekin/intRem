import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthenticatorTransportFuture, WebAuthnCredential } from '@simplewebauthn/server';
import type { Device } from '../shared/types.js';
import { AppError } from './errors.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export interface LoginSession { token: string; csrfToken: string; device: Device }
export class Auth {
  constructor(public db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, credential_id TEXT NOT NULL REFERENCES credentials(id), created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, push_subscription TEXT);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_challenges (ticket_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, initial INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    `);
    db.prepare('INSERT OR IGNORE INTO auth_meta(key,value) VALUES (?,?)').run('owner', randomUUID());
  }
  get ownerId(): string { return (this.db.prepare('SELECT value FROM auth_meta WHERE key=?').get('owner') as { value: string }).value; }
  hasCredentials(): boolean { return Number((this.db.prepare('SELECT count(*) AS n FROM credentials WHERE revoked_at IS NULL').get() as { n: number }).n) > 0; }
  resetBootstrap(): string {
    if (this.hasCredentials()) throw new AppError(409, 'ALREADY_CONFIGURED', 'Geçiş anahtarı zaten kayıtlı.');
    const token = secret();
    this.db.prepare("DELETE FROM auth_challenges WHERE kind = 'registration'").run();
    this.db.prepare('INSERT OR REPLACE INTO auth_meta(key,value) VALUES (?,?)').run('bootstrap', hash(token));
    return token;
  }
  verifyBootstrap(token: string): boolean {
    if (this.hasCredentials()) return false;
    const stored = this.db.prepare('SELECT value FROM auth_meta WHERE key=?').get('bootstrap') as { value: string } | undefined;
    return !!stored && timingSafeEqual(Buffer.from(stored.value, 'hex'), Buffer.from(hash(token), 'hex'));
  }
  createChallenge(kind: 'login' | 'registration', challenge: string, initial: boolean, expiresAt = Date.now() + 5 * 60_000): string {
    this.db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(Date.now());
    const ticket = secret();
    this.db.prepare('INSERT INTO auth_challenges VALUES (?,?,?,?,?)').run(hash(ticket), kind, challenge, Number(initial), expiresAt);
    return ticket;
  }
  consumeChallenge(ticket: string, kind: 'login' | 'registration'): { challenge: string; initial: boolean } {
    const row = this.db.prepare('DELETE FROM auth_challenges WHERE ticket_hash=? RETURNING *').get(hash(ticket)) as { kind: string; challenge: string; initial: number; expires_at: number } | undefined;
    if (!row || row.kind !== kind || row.expires_at <= Date.now()) throw new AppError(400, 'CHALLENGE_EXPIRED', 'Giriş isteği geçersiz veya süresi doldu. Yeniden deneyin.');
    return { challenge: row.challenge, initial: !!row.initial };
  }
  getCredential(id: string): WebAuthnCredential | undefined {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id=? AND revoked_at IS NULL').get(id) as { id: string; public_key: Uint8Array; counter: number; transports: string } | undefined;
    return row ? { id: row.id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[] } : undefined;
  }
  credentialIds(): string[] { return (this.db.prepare('SELECT id FROM credentials WHERE revoked_at IS NULL').all() as { id: string }[]).map(r => r.id); }
  saveCredential(credential: WebAuthnCredential, initial: boolean): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (initial && this.hasCredentials()) throw new AppError(409, 'ALREADY_CONFIGURED', 'İlk kurulum başka bir cihazda tamamlandı.');
      this.db.prepare('INSERT INTO credentials(id,public_key,counter,transports) VALUES (?,?,?,?)').run(credential.id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []));
      if (initial) this.db.prepare('DELETE FROM auth_meta WHERE key=?').run('bootstrap');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  updateCounter(id: string, expected: number, value: number): void {
    const result = this.db.prepare('UPDATE credentials SET counter=? WHERE id=? AND counter=? AND revoked_at IS NULL').run(value, id, expected);
    if (Number(result.changes) !== 1) throw new AppError(409, 'CREDENTIAL_CHANGED', 'Geçiş anahtarı durumu değişti; yeniden giriş yapın.');
  }
  issueSession(name: string, credentialId: string): LoginSession {
    if (!this.getCredential(credentialId)) throw new AppError(401, 'KEY_REVOKED', 'Geçiş anahtarı iptal edilmiş.');
    const token = secret(), csrfToken = secret(), now = new Date().toISOString();
    const device: Device = { id: randomUUID(), name: name.trim().slice(0,80) || 'Cihaz', createdAt: now, lastSeenAt: now, revokedAt: null, pushEnabled: false };
    this.db.prepare('INSERT INTO devices(id,name,credential_id,created_at,last_seen_at) VALUES (?,?,?,?,?)').run(device.id, device.name, credentialId, now, now);
    this.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(hash(token), device.id, csrfToken, Date.now() + 12 * 60 * 60_000);
    return { token, csrfToken, device };
  }
  authenticate(token: string | undefined): Omit<LoginSession, 'token'> | null {
    if (!token) return null;
    const row = this.db.prepare(`SELECT s.csrf_token,d.* FROM auth_sessions s JOIN devices d ON d.id=s.device_id
      JOIN credentials c ON c.id=d.credential_id WHERE s.token_hash=? AND s.expires_at>? AND d.revoked_at IS NULL AND c.revoked_at IS NULL`).get(hash(token), Date.now()) as Record<string, unknown> | undefined;
    if (!row) return null;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(now, String(row.id));
    return { csrfToken: String(row.csrf_token), device: this.device(row) };
  }
  logout(token: string): void { this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(token)); }
  devices(): Device[] { return this.db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all().map(row => this.device(row)); }
  private device(row: Record<string, unknown>): Device {
    return { id: String(row.id), name: String(row.name), createdAt: String(row.created_at), lastSeenAt: String(row.last_seen_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, pushEnabled: !!row.push_subscription };
  }
  revokeDevice(id: string): void {
    const row = this.db.prepare('SELECT credential_id FROM devices WHERE id=?').get(id) as { credential_id: string } | undefined;
    if (!row) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Cihaz bulunamadı.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      this.db.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(now, row.credential_id);
      this.db.prepare('UPDATE devices SET revoked_at=?,push_subscription=NULL WHERE credential_id=?').run(now, row.credential_id);
      this.db.prepare('DELETE FROM auth_sessions WHERE device_id IN (SELECT id FROM devices WHERE credential_id=?)').run(row.credential_id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setPush(id: string, subscription: unknown): void { this.db.prepare('UPDATE devices SET push_subscription=? WHERE id=? AND revoked_at IS NULL').run(JSON.stringify(subscription), id); }
  pushSubscriptions(): { id: string; subscription: string }[] { return this.db.prepare('SELECT id,push_subscription AS subscription FROM devices WHERE revoked_at IS NULL AND push_subscription IS NOT NULL').all() as { id: string; subscription: string }[]; }
  clearPush(id: string): void { this.db.prepare('UPDATE devices SET push_subscription=NULL WHERE id=?').run(id); }
}
