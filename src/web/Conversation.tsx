import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, Copy, FileText, LockKeyhole, MessageSquare, Pause, Send, ShieldCheck, Square, Terminal, X } from 'lucide-react';
import type { Interaction, Message, Project, Session } from '../shared/types';
import { api, ApiError, errorText } from './api';
import { displayTime, messageLabels, readDraft, saveDraft } from './helpers';
import { Button, Modal, Notice, StatusBadge } from './App';

export function Conversation({ session, project, interactions, cursor, canAct, onRefresh, onInteraction, onBack }: {
  session: Session; project: Project; interactions: Interaction[]; cursor: number; canAct: boolean;
  onRefresh: () => Promise<void>; onInteraction: (id: string) => void; onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState(() => readDraft(session.id));
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const deliveryKey = `intrem:delivery:${session.id}:${session.generation}`;
  const savedDelivery = () => { try { return localStorage.getItem(deliveryKey); } catch { return null; } };
  const [localUnknown, setLocalUnknown] = useState(() => Boolean(savedDelivery()));
  const [confirm, setConfirm] = useState<'stop' | 'takeover' | null>(null);
  const [newEvents, setNewEvents] = useState(false);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const loadSequence = useRef(0);
  const lastMessageId = useRef<string | undefined>(undefined);
  const pending = interactions.filter(item => item.status === 'pending');
  const remoteUnknown = session.state === 'delivery_unknown';
  const inputEnabled = canAct && loaded && session.controlEnabled && !remoteUnknown && !localUnknown;
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const data = await api<{ messages: Message[] }>(`/sessions/${encodeURIComponent(session.id)}/messages`);
      if (sequence !== loadSequence.current) return;
      setMessages(data.messages); setLoaded(true);
      const pendingClient = savedDelivery();
      const accepted = pendingClient && data.messages.find(message => message.clientId === pendingClient);
      if (accepted) {
        localStorage.removeItem(deliveryKey); setLocalUnknown(false);
        setDraft(previous => { if (previous.trim() === accepted.text) { saveDraft(session.id, ''); return ''; } return previous; });
      }
      const id = data.messages.at(-1)?.id;
      if (id && lastMessageId.current !== id) {
        if (atBottom.current) requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' }));
        else setNewEvents(true);
      }
      lastMessageId.current = id;
    } catch (error) { if (sequence === loadSequence.current) { setError(errorText(error)); setLoaded(false); } }
  }, [session.id, session.generation]);
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load, cursor]);
  useEffect(() => {
    if (session.source !== 'imported') return;
    const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') void load(); }, 5000);
    return () => clearInterval(timer);
  }, [session.source, load]);
  useEffect(() => { setLocalUnknown(Boolean(savedDelivery())); }, [session.generation]);

  const setText = (value: string) => { setDraft(value); saveDraft(session.id, value); };
  async function send(text = draft) {
    if (guard.current || !inputEnabled || !text.trim()) return;
    guard.current = true; setBusy(true); setError('');
    const clientId = crypto.randomUUID();
    const targetGeneration = session.generation;
    try {
      // Persist intent before crossing the network so a reload cannot create a duplicate.
      try { localStorage.setItem(deliveryKey, clientId); }
      catch { throw new ApiError('Güvenli gönderim kaydı saklanamadı. Tarayıcı depolamasına izin verin.', 400, 'STORAGE_REQUIRED'); }
      await api<Message>(`/sessions/${encodeURIComponent(session.id)}/messages`, { clientId, text: text.trim(), generation: targetGeneration });
      localStorage.removeItem(deliveryKey); setLocalUnknown(false);
      setText('');
      await onRefresh(); await load();
    } catch (error) {
      setError(errorText(error));
      if (!(error instanceof ApiError) || error.status >= 500) {
        setLocalUnknown(true);
        // A lost response does not prove whether the server accepted the command.
        setError('Sunucunun mesajı alıp almadığı doğrulanamadı. Taslak korundu. Konuşmayı ve sunucu durumunu kontrol etmeden yeniden göndermeyin.');
      } else { try { localStorage.removeItem(deliveryKey); } catch { /* No command was accepted. */ } }
      await onRefresh(); await load();
    } finally { guard.current = false; setBusy(false); }
  }
  async function action() {
    if (!confirm || guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      await api(`/sessions/${encodeURIComponent(session.id)}/${confirm}`, { generation: session.generation, ...(confirm === 'stop' ? { confirm: true } : {}) });
      setConfirm(null); await onRefresh(); await load();
    } catch (error) { setError(errorText(error)); await onRefresh(); }
    finally { guard.current = false; setBusy(false); }
  }
  async function cancel(messageId: string) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try { await api(`/messages/${encodeURIComponent(messageId)}/cancel`, {}); await onRefresh(); await load(); }
    catch (error) { setError(errorText(error)); await load(); }
    finally { guard.current = false; setBusy(false); }
  }
  async function copyTarget() {
    try { await navigator.clipboard.writeText(`${project.name}\n${project.host}\n${project.cwd}\nOturum: ${session.id}\nNesil: ${session.generation}`); setCopied(true); }
    catch { setError('Hedef bilgisi panoya kopyalanamadı. Aşağıdaki metni seçerek kopyalayabilirsiniz.'); }
  }
  return <article className="conversation">
    <header className="conversation-heading"><div className="conversation-title"><Button className="icon-button subtle mobile-back" onClick={onBack} aria-label="Oturum listesine dön"><ArrowLeft size={22} /></Button><div className="conversation-project-icon"><Terminal size={21} /></div><div><span className="project-name">{project.name}</span><h2>{session.title}</h2></div><StatusBadge state={session.state} /></div><div className="target-summary"><span>{project.host}</span><code>{project.cwd}</code></div><div className="session-identity"><code>Oturum: {session.id}</code><code>Nesil: {session.generation}</code></div><div className="conversation-toolbar"><span className="source-label">{session.source === 'managed' ? 'intRem ile başlatıldı' : 'Mevcut oturumdan devralındı'}</span><Button className="subtle compact" onClick={() => setDetails(!details)} aria-expanded={details}><FileText size={15} />Oturum bilgisi<ChevronDown size={15} /></Button></div>
      {details && <div className="session-details"><dl><div><dt>İstenen model</dt><dd>{session.requestedModel || 'Bilinmiyor'}</dd></div><div><dt>Gerçek model</dt><dd>{session.actualModel || 'Bilinmiyor'}</dd></div><div><dt>Hesap</dt><dd>{session.account || 'Bilinmiyor'}</dd></div><div><dt>Son ilerleme</dt><dd>{displayTime(session.lastActivityAt)}</dd></div><div><dt>Kontrol</dt><dd>{session.controlEnabled ? 'Mesaj gönderebilir · İzin yanıtlayabilir' : 'Yalnız izleme'}</dd></div><div><dt>Kaynak Claude oturumu</dt><dd className="mono">{session.claudeSessionId || 'Henüz başlamadı'}</dd></div><div><dt>Kullanım / maliyet</dt><dd>Ölçüm yok · Bilinmiyor</dd></div></dl>{session.fallbackReason && <Notice>Sağlayıcı geçişi: {session.fallbackReason}</Notice>}<div className="detail-actions"><Button className="subtle" onClick={() => void copyTarget()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Hedef kopyalandı' : 'Hedefi kopyala'}</Button><Button className="danger-text" onClick={() => setConfirm('stop')} disabled={!canAct || !session.controlEnabled || busy}><Square size={15} />Çalışan ajanı durdur</Button></div></div>}
    </header>
    {!session.controlEnabled && <div className="conversation-notice"><Notice tone="info">Bu oturum yalnız izlenebilir. Kaynak süreç çıktıktan sonra aynı konuşmayı intRem’de sürdürebilirsiniz.<Button className="subtle" onClick={() => setConfirm('takeover')} disabled={!canAct || busy}><ArrowUpRight size={16} />Kontrollü devral</Button></Notice></div>}
    {pending.length > 0 && <div className="pending-inline"><Bell size={18} /><span><strong>{pending.length} istek yanıtınızı bekliyor</strong><small>Devam etmeden önce isteği inceleyin.</small></span><Button onClick={() => onInteraction(pending[0].id)} className="compact">İncele<ArrowUpRight size={16} /></Button></div>}
    <div className="messages" ref={content} onScroll={() => { const node = content.current; if (node) { atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (atBottom.current) setNewEvents(false); } }}>
      {messages === null ? <div className="empty-compact"><MessageSquare size={24} /><p>Konuşma yükleniyor…</p></div> : !messages.length ? <div className="conversation-empty"><MessageSquare size={30} /><h3>Bu oturumun ilk mesajı sizden</h3><p>{session.controlEnabled ? 'Yapılacak işi yazın. Yanıtlar ve karar istekleri bu konuşmada görünecek.' : 'Kaynak süreçten aktarılmış mesaj bulunmuyor. Kontrol devri tamamlandığında burada devam edebilirsiniz.'}</p></div> : messages.map(message => <section className={`message ${message.role}`} key={message.id}><div className="message-author"><span className="message-avatar">{message.role === 'user' ? 'S' : message.role === 'assistant' ? <Terminal size={15} /> : <AlertCircle size={15} />}</span><strong>{message.role === 'user' ? 'Siz' : message.role === 'assistant' ? 'Claude' : 'Sistem'}</strong><time>{displayTime(message.createdAt)}</time></div><div className="message-body">{message.text}</div><div className={`message-status ${message.state === 'failed' || message.state === 'delivery_unknown' ? 'warning' : ''}`}>{message.state === 'completed' ? <Check size={13} /> : <span className="status-dot" />}{messageLabels[message.state]}{message.state === 'queued' && message.role === 'user' && <Button className="subtle compact" onClick={() => void cancel(message.id)} disabled={!canAct || busy}><X size={14} />Sıradan çıkar</Button>}</div>{message.error && <Notice tone="error">{message.error}</Notice>}{message.state === 'delivery_unknown' && <Notice>Bu mesajın teslimatı belirsiz. Otomatik yeniden gönderim yapılmaz. Önce oturumun gerçek durumunu kontrol edin.</Notice>}</section>)}
      {interactions.filter(item => item.status !== 'pending').map(item => <button className="decision-event" key={item.id} onClick={() => onInteraction(item.id)}><ShieldCheck size={16} /><span>{item.toolName} · {item.status === 'answered' ? (item.decision?.behavior === 'allow' ? 'Kabul edildi' : 'Reddedildi') : item.status === 'expired' ? 'Süresi doldu' : 'İptal edildi'}</span><ArrowUpRight size={15} /></button>)}
      <div ref={bottom} />
    </div>
    {newEvents && <Button className="new-events" onClick={() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' }); setNewEvents(false); }}><ArrowDown size={16} />Yeni olaylar</Button>}
    <div className="composer-area">
      {error && <Notice tone="error">{error}</Notice>}
      {localUnknown && <Notice>Konuşmayı inceleyip mesajın ulaşmadığını doğruladıysanız taslağı yeniden göndermek için kilidi açın.<Button onClick={() => { setLocalUnknown(false); setError(''); }} className="subtle" disabled={!loaded || !canAct}>Oturumu kontrol ettim; taslağı aç</Button></Notice>}
      {remoteUnknown && <Notice>Önceki mesajın teslimatı belirsiz. Yeni mesaj gönderimi, oturum durumu doğrulanana kadar kapalı.</Notice>}
      <div className="composer-target"><LockKeyhole size={14} /><span>Hedef: <strong>{project.name}</strong> / {session.title}</span></div>
      <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="message-draft">Bu oturuma mesaj</label><textarea id="message-draft" placeholder={session.controlEnabled ? 'Bu projede ne yapılmasını istiyorsunuz?' : 'Kontrol devrinden sonra göndermek için taslak yazın'} value={draft} onChange={event => setText(event.target.value)} rows={3} maxLength={100000} disabled={busy} /><div className="composer-bottom"><span className="hint">{!canAct ? 'Gönderim kapalı · Taslak bu oturumda kalır' : !session.controlEnabled ? 'Yalnız izleme · Taslak saklanır' : 'Taslak yalnız bu oturuma aittir'}</span><Button type="submit" className="primary" busy={busy} disabled={!inputEnabled || !draft.trim()} aria-label="Mesajı bu oturuma gönder"><Send size={17} /><span>Gönder</span></Button></div></form>
      <div className="composer-help"><Button className="subtle compact" onClick={() => void send('Mevcut çalışmanın durumunu, tamamlanan işleri, doğrulama sonuçlarını ve varsa engelleri kısaca raporla.')} disabled={!inputEnabled || busy || !!draft.trim()}>Durum raporu iste</Button><span>Ajana yeni bir mesaj gönderir.</span></div>
    </div>
    {confirm && <Modal title={confirm === 'stop' ? 'Çalışan ajanı durdur' : 'Oturumu kontrollü devral'} onClose={() => setConfirm(null)} busy={busy}><div className="target-box"><strong>{project.name} / {session.title}</strong><span>{project.host}</span><code>{project.cwd}</code><code>Oturum: {session.id}</code><code>Nesil: {session.generation}</code></div><Notice>{confirm === 'stop' ? 'Çalışan tur durdurulur ve sıradaki mesajlar iptal edilir. Araçların daha önce yaptığı değişiklikler geri alınmaz. Yeni süreç nesliyle daha sonra yeni bir mesaj gönderebilirsiniz.' : 'Kaynak sürecin kapandığı sunucuda doğrulanır. Kaynak süreç canlıysa devir reddedilir. Kapatmak için kaynak terminali kullanın; bu işlem kaynak sürece son vermez.'}</Notice>{error && <Notice tone="error">{error}</Notice>}<div className="modal-actions"><Button onClick={() => setConfirm(null)} disabled={busy}>Vazgeç</Button><Button className={confirm === 'stop' ? 'danger' : 'primary'} onClick={() => void action()} busy={busy} disabled={!canAct}>{confirm === 'stop' ? 'Bu oturumu durdur' : 'Doğrula ve devral'}</Button></div></Modal>}
  </article>;
}
