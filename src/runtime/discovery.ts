import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredSession } from '../shared/types.js';
import { AppError } from '../server/errors.js';

export interface ProcessOptions {
  procRoot?: string;
  platform?: NodeJS.Platform;
  uid?: number;
}

export interface DiscoveryOptions extends ProcessOptions {
  claudeHome: string;
  allowedRoots: string[];
}

export async function allowedProjectPath(cwd: string, allowedRoots: string[]): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(cwd);
    if (!(await stat(resolved)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AppError(400, 'PROJECT_PATH_NOT_ALLOWED', 'Proje dizini mevcut ve erişilebilir olmalı.');
  }
  for (const root of allowedRoots) {
    try {
      const relative = path.relative(await realpath(root), resolved);
      if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) return resolved;
    } catch { /* An unavailable allowed root does not authorize another path. */ }
  }
  throw new AppError(403, 'PROJECT_PATH_NOT_ALLOWED', 'Proje dizini izin verilen kökler dışında.');
}

export async function readProcessStart(pid: number, options: ProcessOptions = {}): Promise<string | null> {
  const unverified = () => new AppError(409, 'SOURCE_PROCESS_UNVERIFIED', 'Kaynak sürecin çıktığı güvenilir biçimde doğrulanamadı.');
  if ((options.platform ?? process.platform) !== 'linux' || !Number.isSafeInteger(pid) || pid <= 0) throw unverified();
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined) throw unverified();
  const procRoot = options.procRoot ?? '/proc';
  const directory = path.join(procRoot, String(pid));
  try {
    if (!(await stat(procRoot)).isDirectory()) throw unverified();
    const [statText, status] = await Promise.all([readFile(path.join(directory, 'stat'), 'utf8'), readFile(path.join(directory, 'status'), 'utf8')]);
    const processUid = /^Uid:\s+(\d+)\s+/m.exec(status)?.[1];
    // comm (field 2) may contain spaces and parentheses; starttime is field 22.
    if (!statText.startsWith(`${pid} (`) || statText.lastIndexOf(')') < 0) throw unverified();
    const fields = statText.slice(statText.lastIndexOf(')') + 2).trim().split(/\s+/);
    const start = fields[19];
    if (processUid !== String(uid) || !start || !/^\d+$/.test(start)) throw unverified();
    if (fields[0] === 'Z' || fields[0] === 'X') return null;
    return start;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Missing /proc itself or an incomplete record is not evidence of process exit.
      try { await stat(procRoot); } catch { throw unverified(); }
      try { await stat(directory); } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return null;
      }
    }
    throw unverified();
  }
}

export async function isSourceAlive(
  source: { sourcePid: number | null; sourceStart: string | null } | { pid: number; processStart: string },
  options: ProcessOptions = {},
): Promise<boolean> {
  const pid = 'pid' in source ? source.pid : source.sourcePid;
  const start = 'processStart' in source ? source.processStart : source.sourceStart;
  if (pid === null && start === null) return false;
  if (pid === null || start === null || !/^\d+$/.test(start)) throw new AppError(409, 'SOURCE_PROCESS_UNVERIFIED', 'Kaynak süreç kimliği eksik.');
  return await readProcessStart(pid, options) === start;
}

export async function discoverSessions(options: DiscoveryOptions): Promise<DiscoveredSession[]> {
  if ((options.platform ?? process.platform) !== 'linux') return [];
  const directory = path.join(options.claudeHome, 'sessions');
  let files: string[];
  try { files = await readdir(directory); } catch { return []; }
  const sessions: DiscoveredSession[] = [];
  for (const filename of files) {
    if (!/^\d+\.json$/.test(filename)) continue;
    try {
      const file = path.join(directory, filename);
      const resolvedFile = await realpath(file);
      if (path.dirname(resolvedFile) !== await realpath(directory) || (await stat(file)).size > 65536) continue;
      const record: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const metadata = record as Record<string, unknown>;
      const pid = Number(filename.slice(0, -5));
      const sessionId = metadata.sessionId;
      const processStart = typeof metadata.procStart === 'string' || typeof metadata.procStart === 'number' ? String(metadata.procStart) : '';
      if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) || typeof metadata.cwd !== 'string') continue;
      if (metadata.pid !== undefined && metadata.pid !== pid) continue;
      if (!await isSourceAlive({ pid, processStart }, options)) continue;
      const cwd = await allowedProjectPath(metadata.cwd, options.allowedRoots);
      sessions.push({
        claudeSessionId: sessionId, pid, processStart, cwd,
        title: `${path.basename(cwd)} · Claude`,
        version: typeof metadata.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version) ? metadata.version : null,
        tmuxPane: typeof metadata.tmuxPane === 'string' && /^%\d+$/.test(metadata.tmuxPane) ? metadata.tmuxPane : typeof metadata.tmux === 'string' ? /\.(%\d+)$/.exec(metadata.tmux)?.[1] ?? null : null,
        active: true,
      });
    } catch { /* Invalid or concurrently removed metadata is not a live session. */ }
  }
  return sessions.sort((left, right) => left.cwd.localeCompare(right.cwd) || left.pid - right.pid);
}
