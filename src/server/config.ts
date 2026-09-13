import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface AppConfig {
  dataDir: string; dbPath: string; host: string; port: number; origin: string; rpId: string;
  secureCookies: boolean; allowedRoots: string[]; claudeHome: string; claudeExecutable: string;
  codexExecutable: string; omnirouteUrl: string | null; pushSubject: string;
}
export function loadConfig(): AppConfig {
  const dataDir = path.resolve(process.env.INTREM_DATA_DIR ?? '.intrem/data');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const origin = new URL(process.env.INTREM_ORIGIN ?? 'http://localhost:4100');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('INTREM_ORIGIN yalnız origin içermelidir.');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('Uzak erişim için HTTPS gereklidir.');
  const port = Number(process.env.INTREM_PORT ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INTREM_PORT geçersiz.');
  const rootValue = process.env.INTREM_ALLOWED_ROOTS;
  const allowedRoots = rootValue ? JSON.parse(rootValue) as unknown : [];
  if (!Array.isArray(allowedRoots) || !allowedRoots.every(p => typeof p === 'string' && path.isAbsolute(p))) throw new Error('INTREM_ALLOWED_ROOTS mutlak dizinlerden oluşan JSON dizi olmalıdır.');
  return {
    dataDir, dbPath: path.join(dataDir, 'intrem.sqlite'), host: process.env.INTREM_HOST ?? '127.0.0.1', port,
    origin: origin.origin, rpId: origin.hostname, secureCookies: origin.protocol === 'https:',
    allowedRoots, claudeHome: process.env.INTREM_CLAUDE_HOME ?? path.join(os.homedir(), '.claude'),
    claudeExecutable: process.env.INTREM_CLAUDE_EXECUTABLE ?? path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    codexExecutable: process.env.INTREM_CODEX_EXECUTABLE ?? path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    omnirouteUrl: process.env.INTREM_OMNIROUTE_URL ?? null,
    pushSubject: process.env.INTREM_PUSH_SUBJECT ?? origin.origin,
  };
}
