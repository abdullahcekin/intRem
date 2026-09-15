import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSourceQuestionHook } from '../src/server/source-hook-setup.js';
import type { AppConfig } from '../src/server/config.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture(previous?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'intrem-hook-setup-'));
  directories.push(directory);
  const project = path.join(directory, "project with 'quotes'");
  const dataDir = path.join(directory, 'private-data');
  await mkdir(project);
  await mkdir(dataDir, { mode: 0o700 });
  const folder = path.join(project, '.claude');
  const filename = path.join(folder, 'settings.local.json');
  if (previous !== undefined) {
    await mkdir(folder);
    await writeFile(filename, previous);
  }
  const config = { allowedRoots: [project], dataDir } as AppConfig;
  const socketPath = path.join(dataDir, 'source-hooks.sock');
  const install = () => installSourceQuestionHook(config, 'synthetic-project', project, socketPath);
  const backups = path.join(dataDir, 'source-hook-backups');
  return { directory, project, folder, filename, backups, install, config, socketPath };
}

describe.runIf(process.platform === 'linux')('source question hook installation', () => {
  it('creates an isolated question hook and private rollback backup for a new project', async () => {
    const f = await fixture();
    await f.install();
    const settings = JSON.parse(await readFile(f.filename, 'utf8'));
    expect(Object.keys(settings.hooks)).toEqual(['PreToolUse']);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0]).toMatchObject({ matcher: 'AskUserQuestion', hooks: [{ type: 'command', timeout: 900 }] });
    expect((await stat(f.folder)).mode & 0o777).toBe(0o700);
    expect((await stat(f.filename)).mode & 0o777).toBe(0o600);
    expect((await stat(f.backups)).mode & 0o777).toBe(0o700);
    const backupFiles = await readdir(f.backups);
    expect(backupFiles).toHaveLength(1);
    const backup = path.join(f.backups, backupFiles[0]);
    expect((await stat(backup)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(backup, 'utf8'))).toEqual({ filename: f.filename, previous: null });
    expect(await readdir(f.folder)).toEqual(['settings.local.json']);
  });

  it('preserves existing permissions, settings and hooks, including another question hook', async () => {
    const settings = {
      permissions: { allow: ['Read'], deny: ['Bash(rm *)'] },
      env: { SYNTHETIC_SETTING: 'preserve' },
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing-shell-hook' }] },
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'echo existing-question-hook' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'echo existing-stop-hook' }] }],
      },
    };
    const previous = JSON.stringify(settings, null, 4) + '\n';
    const f = await fixture(previous);
    await f.install();
    const installed = JSON.parse(await readFile(f.filename, 'utf8'));
    expect(installed.permissions).toEqual(settings.permissions);
    expect(installed.env).toEqual(settings.env);
    expect(installed.hooks.Stop).toEqual(settings.hooks.Stop);
    expect(installed.hooks.PreToolUse.slice(0, 2)).toEqual(settings.hooks.PreToolUse);
    expect(installed.hooks.PreToolUse).toHaveLength(3);
    const backupFiles = await readdir(f.backups);
    expect(backupFiles).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(f.backups, backupFiles[0]), 'utf8'))).toEqual({ filename: f.filename, previous });
  });

  it('does not rewrite settings or create extra backups when the same hook is already installed', async () => {
    const f = await fixture('{"permissions":{"allow":["Read"]}}\n');
    await f.install();
    const installed = await readFile(f.filename, 'utf8');
    const fileInfo = await stat(f.filename);
    const backups = await readdir(f.backups);
    await f.install();
    expect(await readFile(f.filename, 'utf8')).toBe(installed);
    expect((await stat(f.filename)).ino).toBe(fileInfo.ino);
    expect((await stat(f.filename)).mtimeMs).toBe(fileInfo.mtimeMs);
    expect(await readdir(f.backups)).toEqual(backups);
  });

  it.each([
    ['malformed JSON', '{ broken'],
    ['array settings', '[]'],
    ['null settings', 'null'],
    ['array hooks', '{"hooks":[]}'],
    ['non-array hook list', '{"hooks":{"PreToolUse":{}}}'],
  ])('rejects %s without changing the original file or creating a backup', async (_name, previous) => {
    const f = await fixture(previous);
    await expect(f.install()).rejects.toMatchObject({ code: 'SOURCE_HOOK_CONFIG_INVALID' });
    expect(await readFile(f.filename, 'utf8')).toBe(previous);
    expect(await readdir(f.config.dataDir)).toEqual([]);
    expect(await readdir(f.folder)).toEqual(['settings.local.json']);
  });

  it('rejects a linked settings file and leaves its target untouched', async () => {
    const f = await fixture();
    const target = path.join(f.directory, 'external-settings.json');
    const previous = '{"permissions":{"deny":["Bash"]}}\n';
    await writeFile(target, previous);
    await mkdir(f.folder);
    await symlink(target, f.filename);
    await expect(f.install()).rejects.toMatchObject({ code: 'SOURCE_HOOK_CONFIG_PATH' });
    expect(await readFile(target, 'utf8')).toBe(previous);
    expect(await readdir(f.config.dataDir)).toEqual([]);
  });

  it('rejects a linked .claude directory without writing into its target', async () => {
    const f = await fixture();
    const target = path.join(f.directory, 'external-config');
    await mkdir(target);
    await symlink(target, f.folder, 'dir');
    await expect(f.install()).rejects.toMatchObject({ code: 'SOURCE_HOOK_CONFIG_PATH' });
    expect(await readdir(target)).toEqual([]);
    expect(await readdir(f.config.dataDir)).toEqual([]);
  });

  it('rejects projects outside the allowed roots before creating settings', async () => {
    const f = await fixture();
    const outside = path.join(f.directory, 'outside-project');
    await mkdir(outside);
    await expect(installSourceQuestionHook(f.config, 'outside', outside, f.socketPath)).rejects.toMatchObject({ code: 'PROJECT_PATH_NOT_ALLOWED' });
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(f.config.dataDir)).toEqual([]);
  });
});

it.skipIf(process.platform === 'linux')('rejects hook installation on unsupported platforms without changing project settings', async () => {
  const previous = '{"permissions":{"allow":["Read"]}}\n';
  const f = await fixture(previous);
  await expect(f.install()).rejects.toMatchObject({ code: 'SOURCE_HOOK_UNSUPPORTED' });
  expect(await readFile(f.filename, 'utf8')).toBe(previous);
  expect(await readdir(f.config.dataDir)).toEqual([]);
});
