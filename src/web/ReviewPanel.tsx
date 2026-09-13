import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Square, X } from 'lucide-react';
import type { Review, Session } from '../shared/types';
import { api, errorText } from './api';
import { Button, Modal, Notice } from './App';

const labels: Record<Review['status'], string> = { queued: 'Sırada', running: 'Codex inceliyor', cancelling: 'Durduruluyor', completed: 'İnceleme tamamlandı', failed: 'İnceleme başarısız', stale: 'İnceleme sırasında kod değişti', interrupted: 'İnceleme kesildi', cancelled: 'İnceleme iptal edildi' };
export function ReviewPanel({ session, cursor, canAct }: { session: Session; cursor: number; canAct: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [view, setView] = useState<Review | null>(null);
  const clientId = useRef(crypto.randomUUID());
  const load = async () => { const result = await api<{ reviews: Review[] }>(`/sessions/${session.id}/reviews`); setReviews(result.reviews); };
  useEffect(() => { let active = true; void api<{ reviews: Review[] }>(`/sessions/${session.id}/reviews`).then(result => { if (active) setReviews(result.reviews); }).catch(e => { if (active) setError(errorText(e)); }); return () => { active = false; }; }, [session.id, cursor]);
  const latest = reviews.at(-1), running = latest && ['queued', 'running', 'cancelling'].includes(latest.status);
  async function request() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api(`/sessions/${session.id}/reviews`, { generation: session.generation, clientId: clientId.current }); clientId.current = crypto.randomUUID(); setConfirm(false); await load(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <div className="review-panel">
    <div className="review-actions"><Button className="subtle compact" onClick={() => setConfirm(true)} disabled={!canAct || !session.controlEnabled || session.state !== 'idle' || !!running}><ClipboardCheck size={17} />Codex ile incele</Button>
      {latest && <Button className="subtle compact" onClick={() => setView(latest)}>{labels[latest.status]}</Button>}
      {running && latest.status !== 'cancelling' && <Button className="subtle compact" disabled={!canAct || busy} aria-label="Codex incelemesini durdur" onClick={() => { setBusy(true); void api(`/reviews/${latest.id}/cancel`, {}).then(load).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}><Square size={15} />Durdur</Button>}
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    {confirm && <Modal title="Codex incelemesini başlat" onClose={() => setConfirm(false)} busy={busy}><p>Codex, bu projenin commit edilmemiş değişikliklerini salt okunur ortamda inceleyecek. Yeni Claude mesajları inceleme bitene kadar sırada bekler.</p><Notice tone="info">Sonuç bir kod incelemesidir; testlerin geçtiği veya değişikliğin onaylandığı anlamına gelmez.</Notice><div className="modal-actions"><Button onClick={() => setConfirm(false)}><X size={16} />Vazgeç</Button><Button className="primary" busy={busy} disabled={!canAct} onClick={() => void request()}>İncelemeyi başlat</Button></div></Modal>}
    {view && <Modal title={`Codex · ${labels[view.status]}`} onClose={() => setView(null)}><p className="hint">Çalışma ağacı kimliği: <code>{view.revision?.slice(0, 16) ?? 'Henüz alınmadı'}</code></p>{view.status === 'stale' && <Notice>İnceleme sırasında dosyalar değişti. Bu çıktı güncel kod için kabul edilmemelidir.</Notice>}<pre className="tool-preview">{view.output || 'İnceleme sonucu henüz yok.'}</pre><p className="hint">Kod incelemesi, test sonucu ve insan onayı ayrı adımlardır.</p></Modal>}
  </div>;
}
