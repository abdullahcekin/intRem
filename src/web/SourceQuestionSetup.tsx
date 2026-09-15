import { useRef, useState } from 'react';
import type { Project, Session } from '../shared/types';
import { Button, Modal, Notice } from './App';
import { api, errorText } from './api';

export function SourceQuestionSetup({ session, project, canAct, onClose, onRefresh }: { session: Session; project: Project; canAct: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const guard = useRef(false);
  async function configure(enabled: boolean) {
    if (guard.current || !canAct) return;
    guard.current = true; setBusy(true); setError('');
    try {
      await api(`/sessions/${encodeURIComponent(session.id)}/source-questions`, { generation: session.generation, enabled });
      await onRefresh(); setSaved(true);
    } catch (error) { setError(errorText(error)); }
    finally { guard.current = false; setBusy(false); }
  }
  return <Modal title="Kaynak oturumun canlı soruları" onClose={onClose} busy={busy}>
    <div className="target-box"><strong>{project.name} / {session.title}</strong><code>{project.cwd}</code></div>
    <p>Yeni çoktan seçmeli Claude sorularını intRem’de yanıtlayın. Kaynak terminal çalışmaya devam eder. Seçenekleri “Bekleyenler” veya konuşmadaki “İncele” düğmesinden seçin.</p>
    <p className="hint">Projenin yerel Claude ayarına soru bağlantısı eklenir; mevcut ayarlar korunur. Başka kaynak oturumları kendiliğinden bağlanmaz. Mesaj gönderme, araç izinleri ve daha önce açılmış sorular bu bağlantının kapsamına girmez.</p>
    {session.sourceQuestionsConfigured && <Notice tone="info">Kurulum hazır. Kaynak Claude yeni bir soruyu bağlantıya ilettiğinde burada yanıt kartı açılır. Ayar değişikliğinin kaynak oturumda yüklenmesi gerekir; yalnız kurulum kaydı canlı bağlantı kanıtı değildir.</Notice>}
    {saved && <Notice tone="info">{session.sourceQuestionsConfigured ? 'Soru bağlantısı hazırlandı. Kaynakta ayar yüklendikten sonra yeni sorular intRem’e gelir. Daha önce açılmış soruyu kaynak terminalden yanıtlayın.' : 'Bu oturumun soru bağlantısı kapatıldı. Projedeki bağlantı komutu bağlı olmayan oturumlarda işlem yapmaz.'}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions"><Button onClick={onClose} disabled={busy}>Kapat</Button><Button className={session.sourceQuestionsConfigured ? 'subtle' : 'primary'} disabled={!canAct} busy={busy} onClick={() => void configure(!session.sourceQuestionsConfigured)}>{session.sourceQuestionsConfigured ? 'Soru bağlantısını kapat' : 'Canlı soruları bağla'}</Button></div>
  </Modal>;
}
