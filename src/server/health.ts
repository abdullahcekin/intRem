import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from './config.js';
import type { Store } from './store.js';
import type { HealthReport } from '../shared/types.js';
const exec = promisify(execFile);
async function version(executable: string) {
  try { const { stdout } = await exec(executable, ['--version'], { timeout: 5000, windowsHide: true, maxBuffer: 8192 }); return { ok: true, version: stdout.trim().slice(0,120) }; }
  catch { return { ok: false, version: null }; }
}
export function healthReader(config: AppConfig, store: Store) {
  let cached: HealthReport | null = null, until = 0;
  return async (): Promise<HealthReport> => {
    if (!cached || Date.now() > until) {
      const [claude, codex] = await Promise.all([version(config.claudeExecutable), version(config.codexExecutable)]);
      let ok = false, detail = 'OmniRoute bağlantısı yapılandırılmadı. Hesap ve gerçek model doğrulanmıyor.';
      if (config.omnirouteUrl) {
        try {
          const response = await fetch(new URL('/api/health', config.omnirouteUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' });
          ok = response.ok;
          detail = ok ? 'Sağlık adresi erişilebilir. Hesap havuzları ve istek bazında gerçek model ayrıca doğrulanmalıdır.' : `Sağlık adresi HTTP ${response.status} döndü. Hesap/model durumu bilinmiyor.`;
          await response.body?.cancel();
        } catch { detail = 'OmniRoute sağlık adresine erişilemiyor. Hesap/model durumu bilinmiyor.'; }
      }
      cached = { bridge: { ok: true, version: '0.1.0' }, runner: { ok: false, lastSeenAt: null }, claude, codex, omniroute: { ok, url: config.omnirouteUrl, detail } };
      until = Date.now() + 30_000;
    }
    const lastSeenAt = store.getSetting('runnerHeartbeat', null) as string | null;
    return { ...cached, runner: { ok: !!lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 15_000, lastSeenAt } };
  };
}
