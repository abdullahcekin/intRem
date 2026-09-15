import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
if (process.platform !== 'linux') throw new Error('Bu pilot Linux /proc ve Claude CLI gerektirir.');
const root = path.resolve(process.env.INTREM_PROBE_BUILD || 'dist');
const { Store } = await import(pathToFileURL(path.join(root, 'server/store.js')));
const { Auth } = await import(pathToFileURL(path.join(root, 'server/auth.js')));
const { createApp } = await import(pathToFileURL(path.join(root, 'server/app.js')));
const { SourceHooks } = await import(pathToFileURL(path.join(root, 'server/source-hooks.js')));
const { discoverSessions } = await import(pathToFileURL(path.join(root, 'runtime/discovery.js')));

// Isolated real CLI, synthetic local provider, synthetic question; no production account or source session.
const dir = mkdtempSync(path.join(tmpdir(), 'intrem-hook-cli-'));
const cwd = path.join(dir, 'project');
mkdirSync(cwd); mkdirSync(path.join(dir, 'config'));
const marker = `intrem-synthetic-${randomUUID()}`;
const question = 'Sentetik bağlantı doğrulamasında hangi seçenek iletilsin?';
const label = `Seçim-${randomUUID()}`;
const input = { questions: [{ question, header: 'Bağlantı testi', options: [{ label, description: 'Yalnız sentetik seçim.' }, { label: 'Diğer', description: 'Seçilmemeli.' }], multiSelect: false }] };
const config = { dataDir: dir, dbPath: path.join(dir, 'intrem.sqlite'), host: '127.0.0.1', port: 4199, origin: 'http://localhost:4199', rpId: 'localhost', secureCookies: false, allowedRoots: [dir], claudeHome: path.join(dir, 'config'), claudeExecutable: 'missing', codexExecutable: 'missing', omnirouteUrl: null, pushSubject: 'http://localhost:4199' };
const store = new Store(config.dbPath), auth = new Auth(store.db);
auth.saveCredential({ id: 'synthetic-key', publicKey: new Uint8Array([1]), counter: 0, transports: [] }, true);
const identity = auth.issueSession('synthetic-device', 'synthetic-key');
const headers = { cookie: `intrem_session=${identity.token}`, origin: config.origin, 'x-csrf-token': identity.csrfToken };
const hooks = new SourceHooks(config, store);
const app = await createApp({ config, store, auth, sourceHooks: hooks });
await app.ready();
const project = store.createProject({ name: 'Synthetic source pilot', cwd, host: 'synthetic' });
const sessionId = randomUUID();
let imported, discoveredNative = false, apiStatus = null;
const hook = path.join(root, 'runtime/source-hook-client.js');
const settings = path.join(dir, 'settings.json');
const hookSettings = { hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hook)} ${JSON.stringify(hooks.socketPath)}`, timeout: 45 }] }] } };
const lateInstall = process.env.INTREM_PROBE_LATE === '1';
const localInstall = process.env.INTREM_PROBE_LOCAL === '1';
const interactive = process.env.INTREM_PROBE_INTERACTIVE === '1';
mkdirSync(path.join(cwd, '.claude'));
const targetSettings = localInstall ? path.join(cwd, '.claude/settings.local.json') : settings;
writeFileSync(settings, '{}');
writeFileSync(targetSettings, JSON.stringify(lateInstall ? {} : hookSettings));
writeFileSync(path.join(config.claudeHome, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [cwd]: { hasTrustDialogAccepted: true } } }));
let calls = 0, asked = false, answered = false, toolNames = [], mainCalls = 0;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  let data; try { data = JSON.parse(raw); } catch { data = {}; }
  if (req.url.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ input_tokens: 10 })); return; }
  if (!req.url.includes('/messages')) { res.writeHead(404); res.end('{}'); return; }
  calls++;
  const tools = data.tools ?? [];
  toolNames = tools.map(tool => tool.name);
  const result = (data.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'tool_result' && block.tool_use_id === 'synthetic-question');
  if (result) answered = JSON.stringify(result).includes(label);
  const main = tools.some(tool => tool.name === 'AskUserQuestion');
  if (main) mainCalls++;
  const prepareNextTurn = interactive && lateInstall && main && mainCalls === 1;
  if (prepareNextTurn) writeFileSync(targetSettings, JSON.stringify(hookSettings));
  const ask = main && !asked && !prepareNextTurn;
  if (ask) {
    asked = true;
    const sources = await discoverSessions({ claudeHome: config.claudeHome, allowedRoots: config.allowedRoots });
    const source = sources.find(item => item.claudeSessionId === sessionId);
    discoveredNative = !!source;
    if (source) {
      imported = store.createSession({ projectId: project.id, source: 'imported', sourcePid: source.pid, sourceStart: source.processStart, claudeSessionId: source.claudeSessionId });
      store.setSetting(`sourceQuestions:${imported.id}`, true);
    }
    if (lateInstall && !interactive) { writeFileSync(targetSettings, JSON.stringify(hookSettings)); await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  const content = ask ? [{ type: 'tool_use', id: 'synthetic-question', name: 'AskUserQuestion', input }] : [{ type: 'text', text: answered ? 'PROBE_DONE_REMOTE_APPROVED' : prepareNextTurn ? 'PROBE_READY_FOR_NEW_QUESTION' : 'synthetic auxiliary response' }];
  const message = { id: `msg_probe_${calls}`, type: 'message', role: 'assistant', model: data.model || 'claude-sonnet-4-6', content, stop_reason: ask ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
  if (!data.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  content.forEach((block, index) => {
    event('content_block_start', { index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event('message_stop', {}); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'config'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: 'synthetic-local-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_OAUTH_TOKEN; delete env.CLAUDECODE;
let output = '', timedOut = false;
try {
  const binary = process.env.INTREM_PROBE_CLAUDE || path.join(process.env.HOME, '.local/bin/claude');
  const common = ['--session-id', sessionId, '--model', 'claude-sonnet-4-6', '--settings', settings, ...(process.env.INTREM_PROBE_DEFAULT === '1' ? [] : ['--setting-sources', localInstall ? 'local' : '']), '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  const cliArgs = interactive ? [marker, ...common] : ['-p', marker, '--permission-prompt-tool', 'stdio', ...common, '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
  const child = spawn(interactive ? 'script' : binary, interactive ? ['-q', '-e', '-c', [binary, ...cliArgs].map(quote).join(' '), '/dev/null'] : cliArgs, { cwd, env: { ...env, TERM: 'xterm-256color' }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  let deciding = false;
  const decisionTimer = setInterval(async () => {
    if (deciding) return;
    const item = store.listInteractions().find(item => item.status === 'pending');
    if (!item) return;
    deciding = true;
    try {
      const response = await app.inject({ method: 'POST', url: `/api/interactions/${item.id}/decision`, headers, payload: { generation: item.generation, contentHash: item.contentHash, behavior: 'allow', answers: { [question]: label } } });
      apiStatus = response.statusCode;
    } catch { apiStatus = -1; }
  }, 50);
  let syntheticKeyAccepted = false, nextTurn = false;
  child.stdout.on('data', chunk => {
    if (output.length < 200000) output += chunk;
    if (interactive && !syntheticKeyAccepted && output.includes('synthetic-local-only')) { syntheticKeyAccepted = true; child.stdin.write('\u001b[A\r'); }
    if (interactive && lateInstall && !nextTurn && output.includes('PROBE_READY_FOR_NEW_QUESTION')) { nextTurn = true; setTimeout(() => child.stdin.write('Sentetik soruyu sor.\r'), 10000); }
    if (interactive && answered && output.includes('PROBE_DONE_REMOTE_APPROVED')) setTimeout(stop, 100);
  });
  child.stderr.on('data', chunk => { if (output.length < 200000) output += chunk; });
  const timer = setTimeout(() => { timedOut = true; stop(); }, 45000);
  const exit = await new Promise(resolve => { child.on('exit', resolve); child.on('error', error => { output += error.code; resolve(-1); }); });
  clearTimeout(timer);
  clearInterval(decisionTimer);
  const report = { ok: (exit === 0 || interactive && !timedOut) && discoveredNative && apiStatus === 200 && asked && answered && output.includes('PROBE_DONE_REMOTE_APPROVED'), exit, timedOut, calls, asked, answered, discoveredNative, apiStatus, lateInstall, localInstall, interactive, sourceStillReadonly: imported ? store.getSession(imported.id).controlEnabled === false : null, normalMessages: imported ? store.listMessages(imported.id).length : null, finalMarker: output.includes('PROBE_DONE_REMOTE_APPROVED') };
  if (!report.ok) report.diagnostic = output.slice(-1800).replaceAll(dir, '<probe-dir>').replaceAll(marker, '<marker>');
  console.log(JSON.stringify(report));
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await app.close(); store.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
