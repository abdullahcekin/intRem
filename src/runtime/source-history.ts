import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Message } from '../shared/types.js';

export interface SourceHistoryRow {
  id: string;
  role: Message['role'];
  text: string;
  createdAt?: string;
  sourceQuestion?: { answered: boolean };
}

function blocks(message: SessionMessage): Record<string, unknown>[] {
  const content = (message.message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter(block => block && typeof block === 'object') : [];
}

function questionText(input: unknown): string {
  const questions = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return '';
  return questions.flatMap(question => {
    if (!question || typeof question.question !== 'string') return [];
    const options = Array.isArray(question.options) ? question.options.flatMap((option: { label?: unknown; description?: unknown } | null, index: number) => {
      if (!option || typeof option.label !== 'string') return [];
      return [`${index + 1}. ${option.label}${typeof option.description === 'string' ? ` — ${option.description}` : ''}`];
    }) : [];
    return [[typeof question.header === 'string' ? question.header : '', question.question, ...options].filter(Boolean).join('\n')];
  }).join('\n\n');
}

export function projectSourceHistory(messages: SessionMessage[]): SourceHistoryRow[] {
  const main = messages.filter(message => !message.parent_tool_use_id && (message.type === 'user' || message.type === 'assistant'));
  // A transcript result is evidence of a recorded answer, not authority to act on a live terminal.
  const answered = new Set(main.flatMap(message => blocks(message).filter(block => block.type === 'tool_result' && !block.is_error && typeof block.tool_use_id === 'string').map(block => block.tool_use_id)));
  return main.flatMap(message => {
    const content = blocks(message);
    const timestamp = (message as SessionMessage & { timestamp?: unknown }).timestamp;
    const createdAt = typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined;
    const text = content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
    const notification = message.type === 'user' && /^\s*<task-notification>[\s\S]*<\/task-notification>\s*$/.test(text);
    const rows: SourceHistoryRow[] = text ? [{ id: message.uuid, role: notification ? 'system' : message.type, text: text.slice(0, 16000), createdAt }] : [];
    if (message.type === 'assistant') content.forEach((block, index) => {
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') return;
      const question = questionText(block.input);
      if (question) rows.push({ id: `${message.uuid}:question:${index}`, role: 'assistant', text: `Kaynak terminaldeki soru\n\n${question}`.slice(0, 16000), createdAt, sourceQuestion: { answered: typeof block.id === 'string' && answered.has(block.id) } });
    });
    return rows;
  }).slice(-200);
}
