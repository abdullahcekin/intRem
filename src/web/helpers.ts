import type { Interaction, MessageState, Session, SessionState } from '../shared/types';

export const sessionLabels: Record<SessionState, string> = {
  idle: 'Hazır', working: 'Çalışıyor', waiting_answer: 'Cevabınızı bekliyor',
  permission_required: 'İzin bekliyor', offline: 'Çevrimdışı', delivery_unknown: 'Teslimat belirsiz',
};
export const messageLabels: Record<MessageState, string> = {
  queued: 'Sırada', delivering: 'İletiliyor', processing: 'İşleniyor',
  completed: 'Tamamlandı', failed: 'Başarısız', cancelled: 'İptal edildi', delivery_unknown: 'Teslimat belirsiz',
};
export function displayTime(value?: string | null): string {
  if (!value) return 'Bilinmiyor';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Bilinmiyor' : new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
export function decisionBlock(item: Interaction, session: Session | undefined, now = Date.now()): string | null {
  if (item.status === 'answered') return 'Bu istek yanıtlandı. İlk kaydedilen karar geçerlidir.';
  if (item.status === 'cancelled') return 'Bu istek iptal edildi.';
  if (item.status === 'expired' || Date.parse(item.expiresAt) <= now) return 'Bu isteğin süresi doldu.';
  if (!session || session.generation !== item.generation) return 'Oturumun süreç nesli değişti. Bu eski istek yanıtlanamaz.';
  if (!session.controlEnabled) return 'Bu oturumda kontrol yetkisi etkin değil.';
  return null;
}
export function readDraft(sessionId: string): string {
  try { return localStorage.getItem(`intrem:draft:${sessionId}`) || ''; } catch { return ''; }
}
export function saveDraft(sessionId: string, text: string): void {
  try {
    if (text) localStorage.setItem(`intrem:draft:${sessionId}`, text);
    else localStorage.removeItem(`intrem:draft:${sessionId}`);
  } catch { /* The composer remains usable when local storage is unavailable. */ }
}
export function notificationSupport(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}
