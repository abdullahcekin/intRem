import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { projectSourceHistory } from './source-history.js';

const [sessionId, cwd] = process.argv.slice(2);
if (!sessionId || !/^[a-f0-9-]{36}$/i.test(sessionId) || !cwd) process.exit(2);
const messages = await getSessionMessages(sessionId, { dir: cwd });
const history = projectSourceHistory(messages);
process.stdout.write(JSON.stringify(history));
