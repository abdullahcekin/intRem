import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

const question = 'İşlem seçimi 🧭?', answer = 'İkinci seçenek ✅';
const input = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question, options: [{ label: answer }] }] } };
function splitCharacters(value: unknown, firstCharacter: string, secondCharacter: string) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  const first = bytes.indexOf(Buffer.from(firstCharacter)) + 1, second = bytes.indexOf(Buffer.from(secondCharacter)) + 2;
  return [bytes.subarray(0, first), bytes.subarray(first, second), bytes.subarray(second)];
}

async function runClient(stdin: Buffer[], response: Buffer[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'intrem-hook-client-'));
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\intrem-client-${randomUUID()}` : path.join(directory, 'hook.sock');
  const sockets: Socket[] = [];
  let received: unknown;
  const server = createServer(socket => {
    sockets.push(socket); socket.setEncoding('utf8');
    let raw = '', answered = false;
    socket.on('error', () => undefined);
    socket.on('data', chunk => {
      raw += chunk;
      if (answered || !raw.includes('\n')) return;
      answered = true; received = JSON.parse(raw.slice(0, raw.indexOf('\n')));
      void (async () => { for (const fragment of response) { socket.write(fragment); await delay(20); } socket.end(); })();
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  // A real Readable delivers deterministic fragments, independently of OS pipe buffering.
  const wrapper = `
    import { PassThrough } from 'node:stream';
    import { setTimeout as delay } from 'node:timers/promises';
    const [socketPath, filename, encoded] = process.argv.slice(1);
    process.argv = [process.execPath, filename, socketPath];
    const stdin = new PassThrough();
    Object.defineProperty(process, 'stdin', { value: stdin });
    const running = import(filename);
    for (let i = 0; !stdin.listenerCount('readable'); i++) {
      if (i > 500) throw new Error('Hook stdin reader did not start');
      await delay(10);
    }
    for (const fragment of JSON.parse(encoded)) { stdin.write(Buffer.from(fragment, 'base64')); await delay(20); }
    stdin.end();
    await running;
  `;
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', wrapper, socketPath, new URL('../src/runtime/source-hook-client.ts', import.meta.url).href, JSON.stringify(stdin.map(fragment => fragment.toString('base64')))], { stdio: ['ignore', 'pipe', 'pipe'] });
  const output: Buffer[] = [], errors: Buffer[] = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stderr.on('data', chunk => errors.push(chunk));
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done;
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  expect(await done, Buffer.concat(errors).toString()).toBe(0);
  return { received, output: JSON.parse(Buffer.concat(output).toString()) };
}

it('preserves Turkish and emoji characters split across hook stdin chunks', async () => {
  const result = await runClient(splitCharacters(input, 'İ', '🧭'), [Buffer.from('{"passthrough":true}\n')]);
  expect(result.received).toMatchObject({ hook: input });
  expect(result.output).toEqual({});
}, 10000);

it('preserves a selected answer split across socket response chunks', async () => {
  const decision = { behavior: 'allow', answers: { [question]: answer } };
  const result = await runClient([Buffer.from(JSON.stringify(input))], splitCharacters(decision, 'İkinci', '✅'));
  expect(result.output).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...input.tool_input, answers: decision.answers } } });
}, 10000);
