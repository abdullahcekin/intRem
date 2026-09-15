import { connect } from 'node:net';

// This local command is called by Claude's PreToolUse hook, never by transcript replay.
const socketPath = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > 128 * 1024) process.exit(1);
}
let input: Record<string, unknown>;
try { input = JSON.parse(raw); } catch { process.exit(1); }
if (!socketPath || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'AskUserQuestion') {
  process.stdout.write('{}');
  process.exit(0);
}
const original = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
const { answers: _answers, ...questionInput } = original;
const fallback = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'intRem bağlantısından yanıt alınamadı. Kaynak terminalden yanıtlayın.', updatedInput: questionInput } };
const result = await new Promise<Record<string, unknown>>(resolve => {
  let received = '', settled = false;
  const socket = connect(socketPath);
  socket.setEncoding('utf8');
  const finish = (value: Record<string, unknown>) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); resolve(value); };
  const timer = setTimeout(() => finish(fallback), 14 * 60 * 1000);
  socket.on('connect', () => socket.write(JSON.stringify({ hook: input, hookPid: process.pid }) + '\n'));
  socket.on('data', chunk => {
    received += chunk;
    if (Buffer.byteLength(received) > 128 * 1024) return finish(fallback);
    if (!received.includes('\n')) return;
    try {
      const response = JSON.parse(received.slice(0, received.indexOf('\n')));
      if (response.passthrough === true) return finish({});
      if (response.behavior === 'deny') return finish({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Kullanıcı intRem üzerinden bu soruyu reddetti.' } });
      const questions = questionInput.questions;
      const answers = response.answers;
      if (response.behavior !== 'allow' || !Array.isArray(questions) || !answers || typeof answers !== 'object' || Array.isArray(answers) || questions.some(question => !question || typeof question.question !== 'string' || typeof answers[question.question] !== 'string' || !answers[question.question].trim()) || Object.keys(answers).some(key => !questions.some(question => question.question === key))) return finish(fallback);
      finish({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...questionInput, answers } } });
    } catch { finish(fallback); }
  });
  socket.on('error', () => finish(fallback));
  socket.on('close', () => finish(fallback));
});
process.stdout.write(JSON.stringify(result));
