import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store.js';
import { PushService } from '../src/server/push.js';
import type { Auth } from '../src/server/auth.js';
import type { AppConfig } from '../src/server/config.js';
import webpush from 'web-push';

vi.mock('web-push', () => ({ default: { generateVAPIDKeys: () => ({ publicKey: 'public-key', privateKey: 'private-key' }), sendNotification: vi.fn() } }));

const directories: string[] = [];
const stores: Store[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'intrem-store-'));
  directories.push(directory);
  const path = join(directory, 'store.db');
  const store = new Store(path);
  stores.push(store);
  const project = store.createProject({ name: 'Pilot', cwd: directory, host: 'localhost' });
  const session = store.createSession({ projectId: project.id });
  return { store, session, project, path };
}

function permission(store: Store, session: ReturnType<Store['createSession']>, input: Record<string, unknown> = { command: 'pwd' }) {
  return store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'request-1', kind: 'permission', toolName: 'Bash', input, expiresAt: new Date(Date.now() + 60_000).toISOString() });
}

describe('son SDK maliyet tahmini', () => {
  it('önceki şemadaki oturumu veri kaybetmeden bilinmeyen maliyetle açar', () => {
    const { store, session, path } = fixture();
    store.appendMessage(session.id, 'assistant', 'Korunan yanıt');
    store.db.exec('DROP TABLE session_cost_estimates');
    const migrated = new Store(path); stores.push(migrated);
    expect(migrated.getSession(session.id)!.costEstimate).toBeNull();
    expect(migrated.listMessages(session.id)[0].text).toBe('Korunan yanıt');
    migrated.recordSessionCost(session.id, session.generation, 0.5);
    expect(store.getSession(session.id)!.costEstimate?.costUsd).toBe(0.5);
  });
  it('son gözlemi listede, bağımsız bağlantıda ve session.updated olayında korur', () => {
    const { store, session, path } = fixture();
    store.recordSessionCost(session.id, session.generation, 0.5);
    store.recordSessionCost(session.id, session.generation, 0.75);
    const reopened = new Store(path); stores.push(reopened);
    const estimate = reopened.getSession(session.id)!.costEstimate;
    expect(estimate).toEqual({ costUsd: 0.75, observedAt: expect.any(String) });
    expect(reopened.listSessions()[0].costEstimate).toEqual(estimate);
    expect(store.eventsAfter(0).filter(event => event.type === 'session.updated').at(-1)?.data.session).toMatchObject({ costEstimate: estimate });
    store.recordSessionCost(session.id, session.generation, null);
    expect(reopened.getSession(session.id)!.costEstimate?.costUsd).toBeNull();
  });

  it('eski neslin tahmini yeni nesle yazmasını ve geçersiz tutarı reddeder', () => {
    const { store, session } = fixture();
    store.recordSessionCost(session.id, session.generation, 0);
    store.updateSession(session.id, { generation: 'new-generation' });
    expect(() => store.recordSessionCost(session.id, session.generation, 99)).toThrow();
    expect(() => store.recordSessionCost(session.id, 'new-generation', -1)).toThrow();
    expect(() => store.recordSessionCost(session.id, 'new-generation', Infinity)).toThrow();
    expect(store.getSession(session.id)!.costEstimate?.costUsd).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Store persistence and queue', () => {
  it('persists records and settings across connections with relational integrity', () => {
    const { store, session, path } = fixture();
    const message = store.enqueueMessage(session.id, { clientId: 'one', text: 'First', generation: session.generation });
    store.setSetting('remoteControlEnabled', false);
    const other = new Store(path); stores.push(other);
    expect(other.listMessages(session.id)).toEqual([message]);
    expect(other.getSession(session.id)?.source).toBe('managed');
    expect(other.getSetting('remoteControlEnabled', true)).toBe(false);
    expect(other.getSetting('missing', 'fallback')).toBe('fallback');
    expect(() => other.createSession({ projectId: 'missing' })).toThrow();
    expect(other.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(other.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });

  it('makes retries idempotent and rejects changed content or generation', () => {
    const { store, session } = fixture();
    const input = { clientId: 'one', text: 'First', generation: session.generation };
    const message = store.enqueueMessage(session.id, input);
    expect(store.enqueueMessage(session.id, input).id).toBe(message.id);
    expect(() => store.enqueueMessage(session.id, { ...input, text: 'Changed' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => store.enqueueMessage(session.id, { ...input, generation: 'stale' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(store.listMessages(session.id)).toHaveLength(1);
  });

  it('queues while working or awaiting an answer and atomically claims in order only when idle', () => {
    const { store, session, path } = fixture();
    const first = store.enqueueMessage(session.id, { clientId: 'one', text: 'First', generation: session.generation });
    const second = store.enqueueMessage(session.id, { clientId: 'two', text: 'Second', generation: session.generation });
    const other = new Store(path); stores.push(other);
    expect(store.claimNextMessage(session.id)?.id).toBe(first.id);
    expect(other.claimNextMessage(session.id)).toBeUndefined();
    expect(other.getSession(session.id)?.state).toBe('working');
    expect(store.enqueueMessage(session.id, { clientId: 'three', text: 'Third', generation: session.generation }).state).toBe('queued');
    store.updateMessage(first.id, { state: 'completed' });
    store.updateSession(session.id, { state: 'idle' });
    expect(other.claimNextMessage(session.id)?.id).toBe(second.id);
    permission(store, session);
    expect(store.enqueueMessage(session.id, { clientId: 'four', text: 'Fourth', generation: session.generation }).state).toBe('queued');
    expect(other.claimNextMessage(session.id)).toBeUndefined();
  });

  it('enforces offline, imported, session and global control boundaries', () => {
    const { store, session, project } = fixture();
    const input = { clientId: 'one', text: 'First', generation: session.generation };
    store.updateSession(session.id, { state: 'offline' });
    expect(() => store.enqueueMessage(session.id, input)).toThrow(expect.objectContaining({ statusCode: 409 }));
    store.updateSession(session.id, { state: 'idle', controlEnabled: false });
    expect(() => store.enqueueMessage(session.id, input)).toThrow(expect.objectContaining({ statusCode: 409 }));
    store.updateSession(session.id, { controlEnabled: true });
    store.enqueueMessage(session.id, input);
    store.setSetting('remoteControlEnabled', false);
    expect(store.claimNextMessage(session.id)).toBeUndefined();
    expect(() => store.enqueueMessage(session.id, { ...input, clientId: 'two' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    const imported = store.createSession({ projectId: project.id, source: 'imported' });
    expect(imported.controlEnabled).toBe(false);
    expect(() => store.enqueueMessage(imported.id, { ...input, generation: imported.generation })).toThrow();
  });

  it('cancels only queued messages and refuses unknown patch fields', () => {
    const { store, session } = fixture();
    const first = store.enqueueMessage(session.id, { clientId: 'one', text: 'First', generation: session.generation });
    expect(store.cancelMessage(first.id).state).toBe('cancelled');
    const next = store.enqueueMessage(session.id, { clientId: 'two', text: 'Second', generation: session.generation });
    store.claimNextMessage(session.id);
    expect(() => store.cancelMessage(next.id)).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => store.updateMessage(next.id, { injected: true } as never)).toThrow();
    expect(() => store.updateSession(session.id, { injected: true } as never)).toThrow();
  });

  it('preserves queued messages and marks uncertain deliveries without replay on restart', () => {
    const { store, session, path } = fixture();
    const first = store.enqueueMessage(session.id, { clientId: 'one', text: 'First', generation: session.generation });
    const queued = store.enqueueMessage(session.id, { clientId: 'two', text: 'Second', generation: session.generation });
    store.claimNextMessage(session.id);
    store.updateMessage(first.id, { state: 'processing' });
    const restarted = new Store(path); stores.push(restarted);
    restarted.recoverDeliveries();
    expect(restarted.listMessages(session.id).find(message => message.id === first.id)?.state).toBe('delivery_unknown');
    expect(restarted.listMessages(session.id).find(message => message.id === queued.id)?.state).toBe('queued');
    expect(restarted.getSession(session.id)?.state).toBe('delivery_unknown');
    expect(restarted.claimNextMessage(session.id)).toBeUndefined();
    const cursor = restarted.cursor();
    restarted.recoverDeliveries();
    expect(restarted.cursor()).toBe(cursor);
  });

  it('records ordered events for updates and settings without cursor duplicates', () => {
    const { store, session } = fixture();
    const cursor = store.cursor();
    store.updateSession(session.id, { title: 'Updated' });
    const message = store.appendMessage(session.id, 'assistant', 'Hello');
    store.updateMessage(message.id, { text: 'Hello again' });
    store.setSetting('remoteControlEnabled', false);
    const first = store.eventsAfter(cursor, 2);
    expect(first).toHaveLength(2);
    const second = store.eventsAfter(first[1]!.id);
    expect(second.length).toBeGreaterThanOrEqual(2);
    expect(new Set([...first, ...second].map(event => event.id)).size).toBe(first.length + second.length);
    expect(store.eventsAfter(store.cursor())).toEqual([]);
  });

  it('never exposes settings or VAPID keys in the event stream', () => {
    const { store } = fixture();
    const cursor = store.cursor();
    store.setSetting('vapidKeys', { publicKey: 'public-secret-marker', privateKey: 'private-secret-marker' });
    store.setSetting('pushCursor', 12);
    store.setSetting('arbitrarySecret', 'secret-marker');
    expect(store.eventsAfter(cursor)).toEqual([]);
    store.setSetting('remoteControlEnabled', false);
    expect(store.eventsAfter(cursor)).toEqual([expect.objectContaining({ type: 'control.updated', data: { enabled: false } })]);
    expect(JSON.stringify(store.eventsAfter(cursor))).not.toContain('secret-marker');
  });

  it('updates only the project push preference and publishes its event', () => {
    const { store, project, path } = fixture();
    const cursor = store.cursor();
    const updated = store.updateProject(project.id, { pushEnabled: true });
    expect(updated).toEqual({ ...project, pushEnabled: true });
    const other = new Store(path); stores.push(other);
    expect(other.getProject(project.id)?.pushEnabled).toBe(true);
    expect(store.eventsAfter(cursor)).toEqual([expect.objectContaining({ type: 'project.updated', data: { project: updated } })]);
    expect(() => store.updateProject(project.id, { pushEnabled: 'yes' } as never)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => store.updateProject(project.id, { cwd: '/elsewhere' } as never)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => store.updateProject('missing', { pushEnabled: true })).toThrow(expect.objectContaining({ statusCode: 404 }));
    expect(store.getProject(project.id)).toEqual(updated);
  });
});

describe('Store permission decisions', () => {
  it('uses stable content hashing and rejects changed payloads for an existing request', () => {
    const { store, session } = fixture();
    const input = { args: { b: 2, a: 1 }, command: 'pwd' };
    const interaction = permission(store, session, input);
    const retry = permission(store, session, { command: 'pwd', args: { a: 1, b: 2 } });
    expect(retry.id).toBe(interaction.id);
    expect(retry.contentHash).toBe(interaction.contentHash);
    expect(() => permission(store, session, { command: 'rm something' })).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('allows exactly the first decision and validates both generation and content hash', () => {
    const { store, session, path } = fixture();
    const interaction = permission(store, session);
    const input = { generation: session.generation, contentHash: interaction.contentHash, decision: { behavior: 'allow' as const }, deviceId: 'phone' };
    expect(() => store.decideInteraction(interaction.id, { ...input, generation: 'stale' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => store.decideInteraction(interaction.id, { ...input, contentHash: 'wrong' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    const other = new Store(path); stores.push(other);
    expect(other.decideInteraction(interaction.id, input)).toMatchObject({ status: 'answered', decidedBy: 'phone', decision: { behavior: 'allow' } });
    expect(() => store.decideInteraction(interaction.id, { ...input, deviceId: 'tablet' })).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('rejects stale generation, expired requests, and decisions while control is disabled', () => {
    const { store, session } = fixture();
    const interaction = permission(store, session);
    const input = { generation: session.generation, contentHash: interaction.contentHash, decision: { behavior: 'allow' as const }, deviceId: 'phone' };
    store.setSetting('remoteControlEnabled', false);
    expect(() => store.decideInteraction(interaction.id, input)).toThrow(expect.objectContaining({ statusCode: 409 }));
    store.setSetting('remoteControlEnabled', true);
    store.updateSession(session.id, { generation: 'next-generation' });
    expect(() => store.decideInteraction(interaction.id, input)).toThrow(expect.objectContaining({ statusCode: 409 }));
    const expired = store.createInteraction({ sessionId: session.id, generation: 'next-generation', requestId: 'expired', kind: 'permission', toolName: 'Bash', input: {}, expiresAt: new Date(Date.now() - 1_000).toISOString() });
    expect(() => store.decideInteraction(expired.id, { ...input, generation: expired.generation, contentHash: expired.contentHash })).toThrow(expect.objectContaining({ statusCode: 409 }));
    store.expireInteractions();
    expect(store.getInteraction(expired.id)?.status).toBe('expired');
  });

  it('requires complete question answers before accepting the first decision', () => {
    const { store, session } = fixture();
    const interaction = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'questions', kind: 'question', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Hangi ortam?', options: [{ label: 'Pilot' }] }, { question: 'Hangi modüller?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const input = { generation: session.generation, contentHash: interaction.contentHash, decision: { behavior: 'allow' as const }, deviceId: 'phone' };
    const invalidAnswers: (Record<string, string> | undefined)[] = [undefined, {}, { 'Hangi ortam?': 'Pilot' }, { 'Hangi ortam?': 'Pilot', 'Hangi modüller?': ' ' }, { 'Hangi ortam?': 'Pilot', 'Hangi modüller?': 'A', fazladan: 'C' }];
    for (const answers of invalidAnswers) {
      expect(() => store.decideInteraction(interaction.id, { ...input, decision: { ...input.decision, ...(answers ? { answers } : {}) } })).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(store.getInteraction(interaction.id)).toMatchObject({ status: 'pending', decision: null });
    }
    expect(store.decideInteraction(interaction.id, { ...input, decision: { behavior: 'allow', answers: { 'Hangi ortam?': 'Özel test ortamı', 'Hangi modüller?': 'A, B' } } }).status).toBe('answered');
  });

  it('rejects plan approval without a concrete plan and prevents duplicate application', () => {
    const { store, session, path } = fixture();
    const interaction = store.createInteraction({ sessionId: session.id, generation: session.generation, requestId: 'plan', kind: 'plan', toolName: 'ExitPlanMode', input: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const input = { generation: session.generation, contentHash: interaction.contentHash, decision: { behavior: 'allow' as const }, deviceId: 'phone' };
    expect(() => store.decideInteraction(interaction.id, input)).toThrow(expect.objectContaining({ statusCode: 409, code: 'PLAN_CONTENT_REQUIRED' }));
    expect(store.getInteraction(interaction.id)?.status).toBe('pending');
    store.decideInteraction(interaction.id, { ...input, decision: { behavior: 'deny' } });
    store.setSetting('remoteControlEnabled', false);
    expect(() => store.markInteractionApplied(interaction.id, session.generation)).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(store.getInteraction(interaction.id)?.appliedAt).toBeNull();
    store.setSetting('remoteControlEnabled', true);
    expect(store.markInteractionApplied(interaction.id, session.generation).appliedAt).not.toBeNull();
    const other = new Store(path); stores.push(other);
    expect(() => other.markInteractionApplied(interaction.id, session.generation)).toThrow(expect.objectContaining({ statusCode: 409, code: 'INTERACTION_ALREADY_APPLIED' }));
  });

  it('arbitrates simultaneous decisions across independent processes', async () => {
    const { store, session, path } = fixture();
    const interaction = permission(store, session);
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src/server/store.ts')).href;
    const input = { generation: session.generation, contentHash: interaction.contentHash, decision: { behavior: 'allow' }, deviceId: 'phone' };
    const children: ChildProcess[] = [];
    try {
      const run = () => {
        const code = `import { Store } from ${JSON.stringify(moduleUrl)}; const store = new Store(${JSON.stringify(path)}); process.send({ ready: true }); process.once('message', () => { try { const result = store.decideInteraction(${JSON.stringify(interaction.id)}, ${JSON.stringify(input)}); process.send({ status: result.status }); } catch (error) { process.send({ code: error.statusCode }); } finally { store.close(); process.disconnect(); } });`;
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        children.push(child);
        let stderr = '';
        child.stderr!.on('data', chunk => { stderr += String(chunk); });
        let readyResolve: () => void;
        let resultResolve: (value: { status?: string; code?: number }) => void;
        let rejectRun: (error: Error) => void;
        const ready = new Promise<void>(resolve => { readyResolve = resolve; });
        const result = new Promise<{ status?: string; code?: number }>((resolve, reject) => { resultResolve = resolve; rejectRun = reject; });
        child.on('message', (message: { ready?: boolean; status?: string; code?: number }) => {
          if (message.ready) readyResolve(); else resultResolve(message);
        });
        child.on('error', error => { readyResolve(); rejectRun(error); });
        child.on('exit', code => { if (code) { readyResolve(); rejectRun(new Error(stderr)); } });
        return { child, ready, result };
      };
      const contenders = [run(), run()];
      await Promise.all(contenders.map(contender => contender.ready));
      for (const contender of contenders) contender.child.send('go');
      const results = await Promise.all(contenders.map(contender => contender.result));
      expect(results.filter(result => result.status === 'answered')).toHaveLength(1);
      expect(results.filter(result => result.code === 409)).toHaveLength(1);
    } finally {
      for (const child of children) child.kill();
    }
  }, 15_000);
});

describe('PushService lifecycle', () => {
  it('commits a takeover once and rejects a stale second takeover', () => {
    const { store, project } = fixture();
    const source = store.createSession({ projectId: project.id, source: 'imported', claudeSessionId: '12345678-1234-1234-1234-123456789012', sourcePid: 1234, sourceStart: '100' });
    const taken = store.takeoverSession(source.id, source.generation, [{ role: 'assistant', text: '[Kaynak geçmişi] Önceki yanıt' }]);
    expect(taken.source).toBe('managed');
    expect(taken.generation).not.toBe(source.generation);
    expect(() => store.takeoverSession(source.id, source.generation, [{ role: 'assistant', text: 'ikinci' }])).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(store.listMessages(source.id).filter(m => m.role === 'assistant')).toHaveLength(1);
  });

  it('does not access a closed database when an in-flight push finishes', async () => {
    vi.useFakeTimers();
    const { store, session, project } = fixture();
    store.db.prepare('UPDATE projects SET pushEnabled = 1 WHERE id = ?').run(project.id);
    let rejectDelivery!: (error: unknown) => void;
    vi.mocked(webpush.sendNotification).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDelivery = reject; }));
    const clearPush = vi.fn();
    const auth = { pushSubscriptions: () => [{ id: 'phone', subscription: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/send/test', keys: {} }) }], clearPush } as unknown as Auth;
    const service = new PushService(store, auth, { pushSubject: 'mailto:pilot@example.com' } as AppConfig);
    const close = service.start();
    permission(store, session);
    await vi.advanceTimersByTimeAsync(2000);
    expect(webpush.sendNotification).toHaveBeenCalled();
    const writes = vi.spyOn(store, 'setSetting');
    close();
    store.close();
    rejectDelivery({ statusCode: 410 });
    await vi.advanceTimersByTimeAsync(0);
    expect(clearPush).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('contains background delivery errors and can run another poll', async () => {
    vi.useFakeTimers();
    const { store, session, project } = fixture();
    store.db.prepare('UPDATE projects SET pushEnabled = 1 WHERE id = ?').run(project.id);
    const auth = { pushSubscriptions: () => [], clearPush: vi.fn() } as unknown as Auth;
    const service = new PushService(store, auth, { pushSubject: 'mailto:pilot@example.com' } as AppConfig);
    const send = vi.spyOn(service, 'send').mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValue({ sent: 1, failed: 0 });
    const close = service.start();
    permission(store, session);
    await vi.advanceTimersByTimeAsync(4000);
    close();
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.eventsAfter(0).some(event => event.type === 'push.failed')).toBe(true);
  });
});
