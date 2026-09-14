import type { AppConfig } from './config.js';
import type { OmniRouteCount, OmniRouteSetup } from '../shared/types.js';

const unavailable = (): OmniRouteCount => ({ state: 'unavailable', count: null });
const maxBytes = 64 * 1024;

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readCount(origin: string, token: string | undefined, resource: 'providers' | 'combos'): Promise<OmniRouteCount> {
  try {
    const response = await fetch(new URL(`/api/${resource}?limit=1`, origin), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const needsAuth = response.status === 401 || response.status === 403;
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
      || Number(response.headers.get('content-length')) > maxBytes || !response.body) {
      await response.body?.cancel().catch(() => {});
      return needsAuth ? { state: 'auth_required', count: null } : unavailable();
    }
    const payload = await readJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unavailable();
    const { total } = payload as Record<string, unknown>;
    const rows = (payload as Record<string, unknown>)[resource === 'providers' ? 'connections' : 'combos'];
    // limit=1 makes an empty page evidence for zero only when the total agrees.
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)
      || rows.length !== Math.min(total, 1) || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) return unavailable();
    return { state: 'ok', count: total };
  } catch { return unavailable(); }
}

export async function readOmniRouteSetup(config: Pick<AppConfig, 'omnirouteUrl' | 'omnirouteToken'>): Promise<OmniRouteSetup> {
  const [connections, pools] = config.omnirouteUrl
    ? await Promise.all([readCount(config.omnirouteUrl, config.omnirouteToken, 'providers'), readCount(config.omnirouteUrl, config.omnirouteToken, 'combos')])
    : [{ state: 'not_configured' as const, count: null }, { state: 'not_configured' as const, count: null }];
  return { checkedAt: new Date(Date.now()).toISOString(), connections, pools };
}
