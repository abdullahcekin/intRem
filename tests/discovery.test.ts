import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedProjectPath, discoverSessions, isSourceAlive } from '../src/runtime/discovery.js';

describe('salt okunur Claude süreç keşfi', () => {
  let root: string;
  let claudeHome: string;
  let project: string;
  let procRoot: string;
  const uid = 123;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'intrem-discovery-'));
    claudeHome = path.join(root, '.claude');
    project = path.join(root, 'projects', 'example');
    procRoot = path.join(root, 'proc');
    await Promise.all([mkdir(path.join(claudeHome, 'sessions'), { recursive: true }), mkdir(project, { recursive: true }), mkdir(path.join(procRoot, '42'), { recursive: true })]);
    await writeFile(path.join(procRoot, '42', 'stat'), `42 (claude worker) S ${Array(18).fill('0').join(' ')} 12345 0`);
    await writeFile(path.join(procRoot, '42', 'status'), `Name:\tclaude\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
    await writeFile(path.join(claudeHome, 'sessions', '42.json'), JSON.stringify({ pid: 42, sessionId: '9ef8807f-a897-49d0-87c3-d4db45b1bd7d', procStart: '12345', cwd: project, version: '2.1.268', tmuxPane: '%9', prompt: 'MUST NEVER LEAK' }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const options = () => ({ claudeHome, allowedRoots: [path.dirname(project)], procRoot, platform: 'linux' as const, uid });

  it('yalnız izinli kökteki aynı PID/start/uid kaydını döndürür ve promptu taşımaz', async () => {
    const sessions = await discoverSessions(options());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ pid: 42, processStart: '12345', cwd: await allowedProjectPath(project, [path.dirname(project)]), active: true, version: '2.1.268' });
    expect(JSON.stringify(sessions)).not.toContain('MUST NEVER LEAK');
  });

  it('yeniden kullanılan PID ve farklı uid için kontrol devri güvenli kalır', async () => {
    expect(await isSourceAlive({ sourcePid: 42, sourceStart: '12345' }, options())).toBe(true);
    expect(await isSourceAlive({ sourcePid: 42, sourceStart: '99999' }, options())).toBe(false);
    await writeFile(path.join(procRoot, '42', 'status'), 'Uid:\t456\t456\t456\t456\n');
    expect(await discoverSessions(options())).toEqual([]);
    await expect(isSourceAlive({ sourcePid: 42, sourceStart: '12345' }, options())).rejects.toMatchObject({ code: 'SOURCE_PROCESS_UNVERIFIED' });
  });

  it('okunamayan veya bozuk proc bilgisini çıkmış kaynak süreç saymaz', async () => {
    await writeFile(path.join(procRoot, '42', 'stat'), 'broken');
    await expect(isSourceAlive({ sourcePid: 42, sourceStart: '12345' }, options())).rejects.toMatchObject({ code: 'SOURCE_PROCESS_UNVERIFIED' });
    await rm(path.join(procRoot, '42'), { recursive: true });
    expect(await isSourceAlive({ sourcePid: 42, sourceStart: '12345' }, options())).toBe(false);
    await rm(procRoot, { recursive: true });
    await expect(isSourceAlive({ sourcePid: 42, sourceStart: '12345' }, options())).rejects.toMatchObject({ code: 'SOURCE_PROCESS_UNVERIFIED' });
  });

  it('bozuk kayıtları, izin dışı kökleri ve Windows keşfini reddeder', async () => {
    await writeFile(path.join(claudeHome, 'sessions', 'bad.json'), '{');
    expect(await discoverSessions({ ...options(), allowedRoots: [claudeHome] })).toEqual([]);
    expect(await discoverSessions({ ...options(), platform: 'win32' })).toEqual([]);
  });

  it('realpath ile dizin sınırını ve symlink kaçışını kontrol eder', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    const link = path.join(project, 'outside-link');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(allowedProjectPath(link, [project])).rejects.toMatchObject({ code: 'PROJECT_PATH_NOT_ALLOWED' });
    await expect(allowedProjectPath(path.dirname(project), [project])).rejects.toMatchObject({ code: 'PROJECT_PATH_NOT_ALLOWED' });
  });
});
