import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const [sessionId, cwd] = process.argv.slice(2);
if (!sessionId || !/^[a-f0-9-]{36}$/i.test(sessionId) || !cwd) process.exit(2);
const messages = await getSessionMessages(sessionId, { dir: cwd });
const history = messages.filter(m => !m.parent_tool_use_id && (m.type === 'user' || m.type === 'assistant')).flatMap(m => {
  const content = (m.message as { content?: unknown })?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
  return text ? [{ id: m.uuid, role: m.type, text: text.slice(0, 16000) }] : [];
}).slice(-200);
process.stdout.write(JSON.stringify(history));
