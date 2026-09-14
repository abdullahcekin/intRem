import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'intrem-config-'));
  vi.stubEnv('INTREM_DATA_DIR', dataDir);
  vi.stubEnv('INTREM_ORIGIN', 'https://intrem.test');
  vi.stubEnv('INTREM_PORT', '4100');
  vi.stubEnv('INTREM_ALLOWED_ROOTS', '[]');
  vi.stubEnv('INTREM_OMNIROUTE_URL', undefined);
  vi.stubEnv('INTREM_OMNIROUTE_TOKEN', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dataDir, { recursive: true, force: true }); });

describe('OmniRoute origin ayarı', () => {
  it('isteğe bağlı URL ve token olmadan başlar', () => {
    const config = loadConfig();
    expect(config.omnirouteUrl).toBeNull();
    expect(config.omnirouteToken).toBeUndefined();
  });
  it.each(['https://gateway.test', 'https://gateway.test/', 'http://localhost:8090', 'http://127.0.0.1:8090/', 'http://[::1]:8090'])('%s origin kabul edilir', value => {
    vi.stubEnv('INTREM_OMNIROUTE_URL', value);
    vi.stubEnv('INTREM_OMNIROUTE_TOKEN', 'oma_PRIVATE_TOKEN');
    const config = loadConfig();
    expect(config.omnirouteUrl).toBe(new URL(value).origin);
    expect(config.omnirouteToken).toBe('oma_PRIVATE_TOKEN');
  });
  it.each([
    'http://gateway.test', 'ftp://gateway.test', 'invalid_PRIVATE_URL', '',
    'https://PRIVATE_USER:PRIVATE_PASSWORD@gateway.test', 'https://@gateway.test', 'https://gateway.test/api',
    'https://gateway.test/?PRIVATE_QUERY', 'https://gateway.test/#PRIVATE_HASH',
    'https://gateway.test/?', 'https://gateway.test/#', 'https://gateway.test/.',
    'https://gateway.test/a/..', 'https://gateway.test\\PRIVATE_PATH',
  ])('origin dışı %s ayarı sırlardan arındırılmış hatayla reddedilir', value => {
    vi.stubEnv('INTREM_OMNIROUTE_URL', value);
    let failure: unknown;
    try { loadConfig(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('INTREM_OMNIROUTE_URL');
    expect((failure as Error).message).not.toContain('PRIVATE_');
  });
});
