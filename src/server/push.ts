import webpush from 'web-push';
import type { Store } from './store.js';
import type { Auth } from './auth.js';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

export function validatePushEndpoint(endpoint: string): void {
  let url: URL; try { url = new URL(endpoint); } catch { throw new AppError(400, 'PUSH_ENDPOINT', 'Bildirim adresi geçersiz.'); }
  const h = url.hostname;
  const allowed = h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com') || h === 'web.push.apple.com' || h.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new AppError(400, 'PUSH_ENDPOINT', 'Bu bildirim sağlayıcısı desteklenmiyor.');
}
export class PushService {
  public publicKey: string;
  private privateKey: string;
  private stopped = false;
  constructor(private store: Store, private auth: Auth, private config: AppConfig) {
    let keys = store.getSetting('vapidKeys', null) as { publicKey: string; privateKey: string } | null;
    if (!keys) { keys = webpush.generateVAPIDKeys(); store.setSetting('vapidKeys', keys); }
    this.publicKey = keys.publicKey; this.privateKey = keys.privateKey;
  }
  async send(deviceId?: string, sessionId?: string): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    if (this.stopped) return { sent, failed };
    for (const entry of this.auth.pushSubscriptions().filter(s => !deviceId || s.id === deviceId)) {
      try {
        const subscription = JSON.parse(entry.subscription) as webpush.PushSubscription;
        validatePushEndpoint(subscription.endpoint);
        await webpush.sendNotification(subscription, JSON.stringify({ sessionId }), {
          vapidDetails: { subject: this.config.pushSubject, publicKey: this.publicKey, privateKey: this.privateKey }, TTL: 300, timeout: 8000,
        });
        sent++;
      } catch (error) {
        failed++;
        if (!this.stopped && [404, 410].includes(Number((error as { statusCode?: number }).statusCode))) this.auth.clearPush(entry.id);
      }
      if (this.stopped) break;
    }
    return { sent, failed };
  }
  start(): () => Promise<void> {
    this.stopped = false;
    let running: Promise<void> | null = null;
    // Tarihsel olaylar ilk kurulumda toplu bildirim üretmez.
    let cursor = this.store.getSetting('pushCursor', this.store.cursor()) as number;
    const timer = setInterval(() => {
      if (running) return;
      running = (async () => {
        for (const event of this.store.eventsAfter(cursor, 100)) {
          if (event.type === 'interaction.created' || event.type === 'model.fallback') {
            const session = event.sessionId ? this.store.getSession(event.sessionId) : undefined;
            const project = session ? this.store.getProject(session.projectId) : undefined;
            if (project?.pushEnabled) await this.send(undefined, event.sessionId ?? undefined);
          }
          if (this.stopped) return;
          cursor = event.id;
          this.store.setSetting('pushCursor', cursor);
        }
      })().catch(() => { if (!this.stopped) this.store.event('push.failed', null, { code: 'PUSH_DELIVERY_FAILED' }); }).finally(() => { running = null; });
    }, 2000);
    timer.unref(); return async () => { this.stopped = true; clearInterval(timer); await running; };
  }
}
