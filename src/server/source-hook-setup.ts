import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { allowedProjectPath } from '../runtime/discovery.js';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export async function installSourceQuestionHook(config: AppConfig, projectId: string, directory: string, socketPath: string) {
  if (process.platform !== 'linux') throw new AppError(409, 'SOURCE_HOOK_UNSUPPORTED', 'Canlı kaynak soruları Linux çalıştırıcısı gerektirir.');
  const cwd = await allowedProjectPath(directory, config.allowedRoots);
  const folder = path.join(cwd, '.claude');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if ((await realpath(folder)) !== folder) throw new AppError(409, 'SOURCE_HOOK_CONFIG_PATH', 'Proje ayar dizini başka bir hedefe bağlı; canlı soru kurulumu yapılmadı.');
  const filename = path.join(folder, 'settings.local.json');
  let previous: string | null = null;
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new AppError(409, 'SOURCE_HOOK_CONFIG_PATH', 'Proje ayar dosyası güvenle güncellenemedi.');
    previous = await readFile(filename, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let settings: Record<string, unknown>;
  try {
    settings = previous === null ? {} : JSON.parse(previous);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings');
  } catch { throw new AppError(409, 'SOURCE_HOOK_CONFIG_INVALID', 'Mevcut proje ayarı geçerli JSON değil; dosya değiştirilmedi.'); }
  const hooks = settings.hooks ?? {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new AppError(409, 'SOURCE_HOOK_CONFIG_INVALID', 'Mevcut hook ayarı geçersiz; dosya değiştirilmedi.');
  const entries = (hooks as Record<string, unknown>).PreToolUse ?? [];
  if (!Array.isArray(entries)) throw new AppError(409, 'SOURCE_HOOK_CONFIG_INVALID', 'Mevcut hook listesi geçersiz; dosya değiştirilmedi.');
  const development = import.meta.url.endsWith('.ts');
  const client = fileURLToPath(new URL(`../runtime/source-hook-client.${development ? 'ts' : 'js'}`, import.meta.url));
  const command = [process.execPath, ...(development ? ['--import', import.meta.resolve('tsx')] : []), client, socketPath].map(quote).join(' ');
  if (entries.some(entry => entry?.matcher === 'AskUserQuestion' && Array.isArray(entry.hooks) && entry.hooks.some((hook: { command?: unknown }) => hook?.command === command))) return;
  const next = { ...settings, hooks: { ...hooks, PreToolUse: [...entries, { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command, timeout: 900, statusMessage: 'intRem üzerinden yanıtınızı bekliyor' }] }] } };
  const backups = path.join(config.dataDir, 'source-hook-backups');
  await mkdir(backups, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(projectId).digest('hex').slice(0,16);
  await writeFile(path.join(backups, `${key}-${randomUUID()}.json`), JSON.stringify({ filename, previous }), { flag: 'wx', mode: 0o600 });
  const temporary = path.join(folder, `.intrem-hook-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const current = await readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (current !== previous) throw new AppError(409, 'SOURCE_HOOK_CONFIG_CHANGED', 'Proje ayarı kurulum sırasında değişti; tekrar deneyin.');
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
