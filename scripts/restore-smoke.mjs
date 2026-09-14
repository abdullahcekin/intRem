import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from '@playwright/test';
import { Store } from '../dist/server/store.js';
import { Auth } from '../dist/server/auth.js';

// Yalnız geçici fixture: gerçek sunucuya, runner'a veya sağlayıcıya bağlanmaz.
const root = mkdtempSync(path.join(tmpdir(), 'intrem-restore-'));
const original = path.join(root, 'original'), restored = path.join(root, 'restored'), damaged = path.join(root, 'damaged');
mkdirSync(original);
const origin = 'http://localhost:4112';
const dbPath = dir => path.join(dir, 'intrem.sqlite');
let child, browser;
let output = '';
const errors = [];
const waitFor = async (condition, label) => {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Doğrulanamadı: ${label}`);
};
async function start(dir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('INTREM_')) delete env[key];
  Object.assign(env, { INTREM_ORIGIN: origin, INTREM_HOST: '127.0.0.1', INTREM_PORT: '4112', INTREM_DATA_DIR: dir, INTREM_ALLOWED_ROOTS: JSON.stringify([root]), INTREM_CLAUDE_HOME: path.join(root, '.claude'), INTREM_CLAUDE_EXECUTABLE: 'missing-claude', INTREM_CODEX_EXECUTABLE: 'missing-codex' });
  output = '';
  child = spawn(process.execPath, ['dist/server/main.js'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  await waitFor(() => {
    if (child.exitCode !== null) throw new Error('Geçici API başlayamadı.');
    return output.includes('adresi için hazır.');
  }, 'ayrı API süreci');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const processToStop = child;
  const exited = once(processToStop, 'exit');
  processToStop.kill('SIGTERM');
  const timer = setTimeout(() => processToStop.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); child = undefined; }
}
function databaseSnapshot(dir) {
  const db = new DatabaseSync(dbPath(dir), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()]));
  } finally { db.close(); }
}
try {
  const initial = new Store(dbPath(original));
  const bootstrap = new Auth(initial.db).resetBootstrap();
  initial.close();
  await start(original);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(origin);
  await page.getByLabel('Kurulum anahtarı').fill(bootstrap);
  await page.getByRole('button', { name: 'Passkey oluştur ve bağlan' }).click();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  let credentialId, beforeCounter, ownerId, session;
  const seeded = new Store(dbPath(original));
  try {
    const auth = new Auth(seeded.db);
    credentialId = auth.credentialIds()[0];
    assert.ok(credentialId);
    beforeCounter = auth.getCredential(credentialId).counter;
    ownerId = auth.ownerId;
    const project = seeded.createProject({ name: 'Yedek kabul projesi', cwd: root, host: 'fixture' });
    session = seeded.createSession({ projectId: project.id, title: 'Geri yüklenen konuşma' });
    seeded.appendMessage(session.id, 'assistant', 'Yedekte korunması gereken yanıt.');
    assert.equal(auth.verifyBootstrap(bootstrap), false, 'tüketilen kurulum kodu');
  } finally { seeded.close(); }
  await page.goto('about:blank');
  await stop();
  const expected = databaseSnapshot(original);
  cpSync(original, restored, { recursive: true });
  cpSync(original, damaged, { recursive: true });
  assert.deepEqual(databaseSnapshot(restored), expected, 'bütün tablolar aynı içerikle geri yüklendi');
  const broken = new DatabaseSync(dbPath(damaged));
  broken.prepare('UPDATE credentials SET public_key=zeroblob(32) WHERE id=?').run(credentialId);
  broken.close();
  assert.notDeepEqual(databaseSnapshot(damaged), expected, 'bozuk anahtar kontrol fixture');

  await context.clearCookies();
  await start(damaged);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Passkey ile giriş yap', exact: true }).click();
  await page.getByText('Giriş doğrulanamadı. Yeniden deneyin.', { exact: true }).waitFor();
  assert.equal((await fetch(`${origin}/api/snapshot`)).status, 401);
  assert.equal(await page.getByRole('navigation', { name: 'Ana gezinme' }).count(), 0, 'bozuk anahtar ile erişim reddedilir');
  await page.goto('about:blank');
  await stop();

  await context.clearCookies();
  await start(restored);
  await page.goto(origin);
  assert.equal(await page.getByLabel('Kurulum anahtarı').count(), 0, 'geri yükleme yeni ilk kurulum değildir');
  await page.getByRole('button', { name: 'Passkey ile giriş yap', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).waitFor();
  await page.getByRole('button', { name: /Geri yüklenen konuşma/ }).click();
  await page.getByText('Yedekte korunması gereken yanıt.', { exact: true }).waitFor();
  const verification = new Store(dbPath(restored));
  try {
    const restoredAuth = new Auth(verification.db);
    assert.equal(restoredAuth.ownerId, ownerId);
    assert.deepEqual(restoredAuth.credentialIds(), [credentialId]);
    assert.ok(restoredAuth.getCredential(credentialId).counter > beforeCounter, 'aynı passkey yeni imza sayacıyla doğrulandı');
    assert.equal(restoredAuth.verifyBootstrap(bootstrap), false);
    assert.equal(verification.listSessions().length, 1);
    assert.equal(verification.listMessages(session.id).length, 1, 'geri yükleme mesajı tekrar göndermez');
  } finally { verification.close(); }
  const outputDir = path.resolve('output/playwright');
  mkdirSync(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, 'restore-passkey-mobile.png') });
  await page.goto('about:blank');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['all-table-backup-integrity', 'damaged-credential-rejected', 'fresh-process-passkey-login', 'credential-counter-advanced', 'consumed-bootstrap-stays-invalid', 'restored-conversation-no-resend'], tables: Object.keys(expected).length }));
} finally {
  await browser?.close();
  await stop();
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('intrem-restore-'));
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
