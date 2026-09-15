import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { projectSourceHistory } from '../src/runtime/source-history.js';

const sessionId = '9ef8807f-a897-49d0-87c3-d4db45b1bd7d';
const message = (uuid: string, type: SessionMessage['type'], content: unknown, extra: Record<string, unknown> = {}): SessionMessage => ({
  uuid, type, session_id: sessionId, parent_tool_use_id: null, parent_agent_id: null,
  message: { content }, ...extra,
});
const question = (id = 'question-tool') => ({
  type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [{
    header: 'Yayın kararı', question: 'Hazırlanan değişiklikler uygulansın mı?', multiSelect: false,
    options: [
      { label: 'Uygula', description: 'Hazırlanan iki değişikliği uygula.' },
      { label: 'Beklet', description: 'Mevcut durumu koru.' },
    ],
  }] },
});

describe('kaynak konuşmanın salt okunur gösterimi', () => {
  it('yalnız araç çağrısı içeren asistan mesajındaki soruyu ve seçenekleri kaybetmez', () => {
    const rows = projectSourceHistory([message('ask', 'assistant', [question()])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'assistant', sourceQuestion: { answered: false } });
    for (const text of ['Yayın kararı', 'Hazırlanan değişiklikler uygulansın mı?', 'Uygula', 'Hazırlanan iki değişikliği uygula.', 'Beklet', 'Mevcut durumu koru.']) {
      expect(rows[0].text).toContain(text);
    }
  });

  it('yalnız aynı araç çağrısının başarılı sonucu soruyu yanıtlanmış yapar', () => {
    const ask = message('ask', 'assistant', [question()]);
    const other = message('other-result', 'user', [{ type: 'tool_result', tool_use_id: 'other-tool', content: 'Uygula' }]);
    expect(projectSourceHistory([ask, other]).find(row => row.sourceQuestion)?.sourceQuestion?.answered).toBe(false);
    const answer = message('answer', 'user', [{ type: 'tool_result', tool_use_id: 'question-tool', content: 'Uygula' }]);
    expect(projectSourceHistory([ask, other, answer]).find(row => row.sourceQuestion)?.sourceQuestion?.answered).toBe(true);
  });

  it('araç hatasını veya alt ajan sonucunu kullanıcı yanıtı saymaz', () => {
    const ask = message('ask', 'assistant', [question()]);
    const error = message('error', 'user', [{ type: 'tool_result', tool_use_id: 'question-tool', is_error: true, content: 'İptal edildi.' }]);
    expect(projectSourceHistory([ask, error]).find(row => row.sourceQuestion)?.sourceQuestion?.answered).toBe(false);
    const nestedAnswer = message('nested-answer', 'user', [{ type: 'tool_result', tool_use_id: 'question-tool', content: 'Uygula' }], { parent_tool_use_id: 'parent-agent' });
    expect(projectSourceHistory([ask, nestedAnswer]).find(row => row.sourceQuestion)?.sourceQuestion?.answered).toBe(false);
  });

  it('iç görev bildirimini sistem mesajı olarak gösterir ve normal kullanıcı metnini korur', () => {
    const notification = '<task-notification>\n<task-id>synthetic-task</task-id>\n<summary>İnceleme tamamlandı.</summary>\n</task-notification>';
    const rows = projectSourceHistory([
      message('notification', 'user', notification),
      message('user', 'user', [{ type: 'text', text: 'Lütfen çalışmaya devam et.' }]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'system' });
    expect(rows[1]).toMatchObject({ role: 'user', text: 'Lütfen çalışmaya devam et.' });
  });

  it('alt ajan konuşmasını ana konuşma ve onay sorusu listesine karıştırmaz', () => {
    const rows = projectSourceHistory([
      message('nested', 'assistant', [{ type: 'text', text: 'Alt ajan özel çıktısı.' }, question()], { parent_tool_use_id: 'parent-agent' }),
      message('main', 'assistant', [{ type: 'text', text: 'Ana konuşma yanıtı.' }]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'assistant', text: 'Ana konuşma yanıtı.' });
  });

  it('bozuk içerik ve soru girdileri geçmişin geri kalanını gizlemez', () => {
    const rows = projectSourceHistory([
      message('null', 'assistant', null),
      message('malformed', 'assistant', [null, false, { type: 'text', text: 123 }, { type: 'tool_use', name: 'AskUserQuestion', input: null }]),
      message('bad-questions', 'assistant', [{ type: 'tool_use', id: 'bad', name: 'AskUserQuestion', input: { questions: [null, { options: 'broken' }] } }]),
      message('valid', 'user', 'Geçerli mesaj.'),
    ]);
    expect(rows.some(row => row.role === 'user' && row.text === 'Geçerli mesaj.')).toBe(true);
    expect(rows.every(row => typeof row.text === 'string')).toBe(true);
  });

  it('kaynak zamanını korur ve geçersiz zaman bilgisini kullanmaz', () => {
    const rows = projectSourceHistory([
      message('timed', 'user', 'Zamanlı mesaj.', { timestamp: '2026-09-15T06:30:00.000Z' }),
      message('bad-date', 'user', 'Bozuk zaman.', { timestamp: 'not-a-date' }),
      message('bad-type', 'user', 'Beklenmeyen zaman tipi.', { timestamp: 123 }),
    ]);
    expect(rows[0].createdAt).toBe('2026-09-15T06:30:00.000Z');
    expect(rows[1].createdAt).toBeUndefined();
    expect(rows[2].createdAt).toBeUndefined();
  });

  it('metin boyutu ve son 200 kayıt sınırını korur', () => {
    const rows = projectSourceHistory(Array.from({ length: 205 }, (_, index) => message(`message-${index}`, 'user', `Kayıt ${index}: ${'x'.repeat(17000)}`)));
    expect(rows).toHaveLength(200);
    expect(rows[0].text).toContain('Kayıt 5:');
    expect(rows.at(-1)?.text).toContain('Kayıt 204:');
    expect(rows.every(row => row.text.length <= 16000)).toBe(true);
  });
});
