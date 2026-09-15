import type { Interaction, Message } from '../shared/types';
import { Button } from './App';

export function SourceQuestionStatus({ message, interactions, onInteraction }: { message: Message; interactions: Interaction[]; onInteraction: (id: string) => void }) {
  const source = message.sourceQuestion!;
  const interaction = source.toolUseId ? interactions.find(item => item.origin === 'source_hook' && item.requestId === `source-hook:${source.toolUseId}`) : undefined;
  const live = interaction?.status === 'pending' ? interaction : undefined;
  return <div className="source-question-status">{live ? <Button className="primary compact" onClick={() => onInteraction(live.id)}>Soruyu yanıtla</Button> : <>
    <p className="hint">{source.answered ? 'Kaynakta bu soruya yanıt kaydı var.' : interaction?.status === 'answered' ? 'Yanıtınız intRem’de kaydedildi. Kaynaktaki sonuç henüz doğrulanmadı; yanıt otomatik tekrar gönderilmez.' : 'Kaynakta bu soruya yanıt kaydı bulunmuyor. Bu geçmiş kaydı için canlı yanıt bağlantısı yok; kaynak terminali kullanın.'}</p>
    <p className="hint">Geçmiş gösterimi tek başına onay veya bildirim oluşturmaz.</p>
  </>}</div>;
}
