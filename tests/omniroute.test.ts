import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthReader } from '../src/server/health.js';
import type { AppConfig } from '../src/server/config.js';
import type { Store } from '../src/server/store.js';

vi.mock('node:child_process', () => ({
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string }) => void) => callback(null, { stdout: 'test-version' }),
}));

const config: AppConfig = {
  dataDir: '.', dbPath: 'unused.sqlite', host: '127.0.0.1', port: 4100, origin: 'https://intrem.test', rpId: 'intrem.test',
  secureCookies: true, allowedRoots: [], claudeHome: '.', claudeExecutable: 'claude', codexExecutable: 'codex',
  omnirouteUrl: 'http://127.0.0.1:8090', pushSubject: 'https://intrem.test',
};
const gatewayFetch = vi.fn<typeof fetch>();
const getSetting = vi.fn((): string | null => null);
const store = { getSetting } as unknown as Store;
const metric = (state: string, count: number | null = null) => ({ state, count });
function respond(providers: () => Response | Promise<Response>, combos: () => Response | Promise<Response> = () => Response.json({ combos: [], total: 0 }), mappings: () => Response | Promise<Response> = () => Response.json({ mappings: [], total: 0 })) {
  gatewayFetch.mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/health') return Response.json({ ok: true });
    if (url.pathname === '/api/providers') return providers();
    if (url.pathname === '/api/combos') return combos();
    if (url.pathname === '/api/model-combo-mappings') return mappings();
    throw new Error('Unexpected gateway endpoint');
  });
}
beforeEach(() => { gatewayFetch.mockReset(); getSetting.mockReset().mockReturnValue(null); vi.stubGlobal('fetch', gatewayFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OmniRoute salt okunur kurulum görünürlüğü', () => {
  it('yalnız doğrulanmış toplamları döndürür; kayıt ayrıntılarını ve tokenı aktarmaz', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    respond(() => Response.json({ connections: [{ id: 'PRIVATE_ACCOUNT', email: 'PRIVATE_EMAIL', accessToken: 'PRIVATE_ACCESS_TOKEN' }], total: 3 }),
      () => Response.json({ combos: [{ name: 'PRIVATE_POOL', models: ['PRIVATE_MODEL'] }], total: 2 }),
      () => Response.json({ mappings: [{ pattern: 'PRIVATE_PATTERN', comboId: 'PRIVATE_POOL_ID', enabled: false }], total: 4 }));
    const report = await healthReader({ ...config, omnirouteToken: 'oma_PRIVATE_BEARER' }, store)();
    expect(report.omniroute.setup.connections).toEqual(metric('ok', 3));
    expect(report.omniroute.setup.pools).toEqual(metric('ok', 2));
    expect(report.omniroute.setup.mappings).toEqual(metric('ok', 4));
    expect(Number.isFinite(Date.parse(report.omniroute.setup.checkedAt))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_');
    expect(gatewayFetch.mock.calls).toHaveLength(4);
    expect(timeout.mock.calls).toEqual([[5000], [5000], [5000], [5000]]);
    expect(gatewayFetch.mock.calls.map(([input]) => new URL(String(input)).pathname).sort()).toEqual([
      '/api/combos', '/api/health', '/api/model-combo-mappings', '/api/providers',
    ]);
    for (const [input, options] of gatewayFetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe(config.omnirouteUrl);
      expect(options?.redirect).toBe('error');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname === '/api/health') expect(new Headers(options?.headers).has('authorization')).toBe(false);
      else {
        expect(url.search).toBe('?limit=1');
        expect(options?.method).toBe('GET');
        expect(new Headers(options?.headers).get('authorization')).toBe('Bearer oma_PRIVATE_BEARER');
      }
    }
    expect(getSetting).toHaveBeenCalledTimes(1);
  });

  it('yalnız geçerli boş listeleri sıfır olarak gösterir; token yokken başlık göndermez', async () => {
    respond(() => Response.json({ connections: [], total: 0 }));
    const { omniroute } = await healthReader(config, store)();
    expect(omniroute.setup.connections).toEqual(metric('ok', 0));
    expect(omniroute.setup.pools).toEqual(metric('ok', 0));
    expect(omniroute.setup.mappings).toEqual(metric('ok', 0));
    expect(gatewayFetch.mock.calls.every(([, options]) => !new Headers(options?.headers).has('authorization'))).toBe(true);
  });

  it('bağlantı yapılandırılmadığında gateway isteği göndermez', async () => {
    const { omniroute } = await healthReader({ ...config, omnirouteUrl: null, omnirouteToken: 'oma_PRIVATE_UNUSED' }, store)();
    expect(omniroute.setup.connections).toEqual(metric('not_configured'));
    expect(omniroute.setup.pools).toEqual(metric('not_configured'));
    expect(omniroute.setup.mappings).toEqual(metric('not_configured'));
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])('HTTP %i kimlik doğrulama gereksinimini sıfırdan ayırır ve kısmi başarıyı korur', async status => {
    respond(() => new Response('PRIVATE_AUTH_ERROR', { status }), () => Response.json({ combos: [{}], total: 1 }));
    const { omniroute } = await healthReader(config, store)();
    expect(omniroute.ok).toBe(true);
    expect(omniroute.setup.connections).toEqual(metric('auth_required'));
    expect(omniroute.setup.pools).toEqual(metric('ok', 1));
    expect(JSON.stringify(omniroute)).not.toContain('PRIVATE_');
  });

  it.each([
    ['yetki eksik', () => new Response('PRIVATE_AUTH', { status: 401 }), 'auth_required'],
    ['yetki yetersiz', () => new Response('PRIVATE_FORBIDDEN', { status: 403 }), 'auth_required'],
    ['başka kaynak şeması', () => Response.json({ combos: [], total: 0 }), 'unavailable'],
    ['tutarsız sayfalama', () => Response.json({ mappings: [], total: 2 }), 'unavailable'],
    ['ağ hatası', () => { throw new Error('PRIVATE_NETWORK'); }, 'unavailable'],
  ] as const)('eşleme okuması %s olduğunda diğer sayaçlar korunur', async (_label, response, state) => {
    respond(() => Response.json({ connections: [{}], total: 3 }), () => Response.json({ combos: [{}], total: 2 }), response);
    const { setup } = (await healthReader(config, store)()).omniroute;
    expect(setup.connections).toEqual(metric('ok', 3));
    expect(setup.pools).toEqual(metric('ok', 2));
    expect(setup.mappings).toEqual(metric(state));
    expect(JSON.stringify(setup)).not.toContain('PRIVATE_');
  });

  it.each([
    ['HTTP 500', () => new Response('PRIVATE_FAILURE', { status: 500 })],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://PRIVATE_TARGET.test' } })],
    ['login HTML', () => new Response('<html>PRIVATE_LOGIN</html>', { headers: { 'content-type': 'text/html' } })],
    ['invalid JSON', () => new Response('{PRIVATE_BROKEN', { headers: { 'content-type': 'application/json' } })],
    ['network failure', () => { throw new Error('PRIVATE_NETWORK'); }],
    ['timeout', () => { throw new DOMException('PRIVATE_TIMEOUT', 'TimeoutError'); }],
  ] as const)('%s bilinmiyor döndürür; ham hata yanıtına yansımaz', async (_label, response) => {
    respond(response);
    const { omniroute } = await healthReader(config, store)();
    expect(omniroute.setup.connections).toEqual(metric('unavailable'));
    expect(omniroute.setup.pools).toEqual(metric('ok', 0));
    expect(JSON.stringify(omniroute)).not.toContain('PRIVATE_');
  });

  it.each([
    null, [], {}, { connections: [] }, { connections: [], total: '0' }, { connections: [], total: -1 },
    { connections: [], total: 0.5 }, { connections: [], total: Number.MAX_SAFE_INTEGER + 1 },
    { connections: {}, total: 0 }, { connections: [], total: 1 }, { connections: [{}], total: 0 },
    { connections: [{}, {}], total: 2 }, { connections: [null], total: 1 }, { connections: ['PRIVATE_ITEM'], total: 1 },
  ].map(payload => [payload]))('geçersiz veya limit=1 ile tutarsız şema sıfır sayılmaz: %j', async payload => {
    respond(() => Response.json(payload));
    expect((await healthReader(config, store)()).omniroute.setup.connections).toEqual(metric('unavailable'));
  });

  it('64 KiB üzerindeki parçalara bölünmüş yanıtı iptal eder', async () => {
    const cancel = vi.fn();
    respond(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(30_000)); }, cancel,
    }), { headers: { 'content-type': 'application/json' } }));
    expect((await healthReader(config, store)()).omniroute.setup.connections).toEqual(metric('unavailable'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('önbellek 30 saniye korunurken runner bağlantısını her okumada günceller', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-14T10:00:00Z'));
    respond(() => Response.json({ connections: [{}], total: 1 }));
    const read = healthReader(config, store);
    const first = await read();
    expect(first.runner.ok).toBe(false);
    getSetting.mockReturnValue('2026-09-14T10:00:05Z');
    now.mockReturnValue(Date.parse('2026-09-14T10:00:10Z'));
    const cached = await read();
    expect(cached.omniroute.setup).toEqual(first.omniroute.setup);
    expect(cached.runner.ok).toBe(true);
    expect(gatewayFetch).toHaveBeenCalledTimes(4);
    now.mockReturnValue(Date.parse('2026-09-14T10:00:31Z'));
    respond(() => Response.json({ connections: [], total: 0 }), undefined, () => Response.json({ mappings: [{}], total: 2 }));
    const refreshed = await read();
    expect(refreshed.omniroute.setup.connections).toEqual(metric('ok', 0));
    expect(refreshed.omniroute.setup.mappings).toEqual(metric('ok', 2));
    expect(refreshed.omniroute.setup.checkedAt).not.toBe(first.omniroute.setup.checkedAt);
    expect(refreshed.runner.ok).toBe(false);
    expect(gatewayFetch).toHaveBeenCalledTimes(8);
  });
});
