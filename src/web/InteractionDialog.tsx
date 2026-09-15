import { useEffect, useRef, useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { Interaction, Project, Question, Session } from '../shared/types';
import { Button, Modal, Notice } from './App';
import { api, errorText } from './api';
import { decisionBlock, displayTime } from './helpers';

export function InteractionDialog({ item, session, project, canAct, onClose, onRefresh }: {
  item: Interaction; session?: Session; project?: Project; canAct: boolean; onClose: () => void; onRefresh: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const guard = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const questions = (Array.isArray(item.input.questions) ? item.input.questions : []) as Question[];
  const blocked = decisionBlock(item, session, now);
  const planText = typeof item.input.plan === 'string' ? item.input.plan : null;
  const answerReady = item.kind === 'question' ? questions.length > 0 && questions.every(q => answers[q.question]?.trim()) : confirmed;
  async function decide(behavior: 'allow' | 'deny') {
    if (guard.current || blocked || !canAct) return;
    guard.current = true; setBusy(true); setError('');
    try {
      await api(`/interactions/${encodeURIComponent(item.id)}/decision`, { generation: item.generation, contentHash: item.contentHash, behavior, ...(item.kind === 'question' && behavior === 'allow' ? { answers } : {}) });
      await onRefresh(); onClose();
    } catch (error) { setError(errorText(error)); await onRefresh(); }
    finally { setBusy(false); guard.current = false; }
  }
  return <Modal title={item.kind === 'question' ? 'Claude cevabınızı bekliyor' : item.kind === 'plan' ? 'Plan kararı' : 'Araç izni'} onClose={onClose} busy={busy}>
    <div className="target-box"><ShieldCheck size={22} /><div><strong>{project?.name ?? 'Hedef doğrulanamadı'}</strong><span className="mono">{project?.cwd}</span><span>{session?.title} · {item.toolName}</span></div></div>
    <p className="hint">Son geçerlilik: {displayTime(item.expiresAt)}. Bu karar yalnız bu istek ve süreç nesli için geçerlidir.</p>
    {item.origin === 'source_hook' && <Notice tone="info">Bu soru kaynak Claude sürecinden canlı geldi. Seçtiğiniz yanıt aynı soruya iletilecek; terminal kapanmaz. Normal mesaj gönderimi ayrı bir yetenektir.</Notice>}
    {blocked && <Notice>{blocked}</Notice>}{!canAct && <Notice>Bağlantı ve güncel oturum durumu doğrulanmadan karar gönderilemez.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {item.kind === 'question' ? <div className="question-list">{questions.map((q, i) => <fieldset key={`${item.id}-${i}`} disabled={busy || !!blocked || !canAct}>
      <legend>{q.question}</legend><div className="answer-options">{(q.options ?? []).map(option => {
        const values = (answers[q.question] ?? '').split(', '), selected = values.includes(option.label);
        return <label className={`answer-option ${selected ? 'selected' : ''}`} key={option.label}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={`question-${i}`} checked={selected} onChange={() => setAnswers(previous => ({ ...previous, [q.question]: q.multiSelect ? (selected ? values.filter(v => v !== option.label) : [...values.filter(Boolean), option.label]).join(', ') : option.label }))} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>;
      })}</div><label className="field"><span>Yanıtınız <span className="muted">(seçebilir veya yazabilirsiniz)</span></span><textarea rows={2} value={answers[q.question] ?? ''} maxLength={10000} onChange={e => setAnswers(old => ({ ...old, [q.question]: e.target.value }))} /></label>
    </fieldset>)}</div> : <>
      {item.kind === 'plan' && planText ? <pre className="tool-preview">{planText}</pre> : <pre className="tool-preview">{JSON.stringify(item.input, null, 2)}</pre>}
      {item.kind === 'plan' && !planText && <Notice>Bu istekte plan metni bulunmuyor. Planın tam sürümünü terminalde inceleyin; burada plan onayı verilemez.</Notice>}
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} disabled={!!blocked || busy} onChange={e => setConfirmed(e.target.checked)} /><span>{item.kind === 'plan' ? 'Gösterilen plan sürümünü inceledim. Bu onay yeni araç izinlerinin yerine geçmez.' : 'Araç girdisini ve hedef projeyi inceledim. Yalnız bu çağrıya bir kez izin veriyorum.'}</span></label>
    </>}
    <div className="modal-actions"><Button className="danger-text" onClick={() => void decide('deny')} disabled={!!blocked || !canAct} busy={busy}><X size={18} />Reddet</Button><Button className="primary" onClick={() => void decide('allow')} disabled={!!blocked || !canAct || !answerReady || (item.kind === 'plan' && !planText)} busy={busy}><Check size={18} />{item.kind === 'question' ? 'Yanıtı gönder' : 'Bir kez onayla'}</Button></div>
  </Modal>;
}
