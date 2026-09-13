import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { AppError } from './errors.js';
import type { AppConfig } from './config.js';
import { registerAuthRoutes, type Identity } from './auth-routes.js';
import { allowedProjectPath, discoverSessions, isSourceAlive } from '../runtime/discovery.js';
import { healthReader } from './health.js';
import { PushService, validatePushEndpoint } from './push.js';
import { historyReader } from './history.js';

export async function createApp({ config, store = new Store(config.dbPath), auth = new Auth(store.db) }: { config: AppConfig; store?: Store; auth?: Auth }) {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, trustProxy: false });
  await app.register(cookie);
  const identities = new WeakMap<FastifyRequest, Identity | null>();
  const getIdentity = (req: FastifyRequest) => identities.get(req) ?? null;
  const buckets = new Map<string, { count: number; until: number }>();
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.addHook('preHandler', async (req) => {
    const route = req.routeOptions.url ?? req.url.split('?')[0];
    if (!route.startsWith('/api/')) return;
    const authRoute = route.startsWith('/api/auth/');
    const key = `${authRoute ? 'auth' : 'api'}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60_000 }; buckets.set(key, bucket); }
    if (++bucket.count > (authRoute ? 40 : 300)) throw new AppError(429, 'RATE_LIMIT', 'Çok fazla istek gönderildi. Bir dakika sonra tekrar deneyin.');
    if (buckets.size > 1000) for (const [id, value] of buckets) if (value.until < now) buckets.delete(id);
    const current = auth.authenticate(req.cookies.intrem_session);
    identities.set(req, current);
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== config.origin) || (writes && req.headers.origin !== config.origin)) throw new AppError(403, 'ORIGIN', 'İstek kaynağı doğrulanamadı.');
    if (!authRoute && !current) throw new AppError(401, 'LOGIN_REQUIRED', 'Oturum açmanız gerekiyor.');
    if (!authRoute && writes && req.headers['x-csrf-token'] !== current?.csrfToken) throw new AppError(403, 'CSRF', 'İstek doğrulanamadı. Sayfayı yenileyin.');
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    if (error instanceof z.ZodError || (error as { statusCode?: number }).statusCode === 400) return reply.code(400).send({ error: 'İstek alanları geçersiz.', code: 'INVALID_INPUT' });
    return reply.code(500).send({ error: 'İşlem tamamlanamadı. Sistem durumunu kontrol edin.', code: 'INTERNAL_ERROR' });
  });
  registerAuthRoutes(app, auth, config, getIdentity);
  const idParam = (req: FastifyRequest) => z.object({ id: z.string().min(1).max(100) }).parse(req.params).id;
  const sessionById = (id: string) => { const s = store.getSession(id); if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Oturum bulunamadı.'); return s; };
  const discoveryOptions = { claudeHome: config.claudeHome, allowedRoots: config.allowedRoots };
  const sourceHistory = historyReader(config);
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/health', healthReader(config, store));
  app.get('/api/snapshot', async () => ({ projects: store.listProjects(), sessions: store.listSessions(), interactions: store.listInteractions(), cursor: store.cursor(), remoteControlEnabled: store.getSetting('remoteControlEnabled', true) }));
  app.post('/api/projects', async req => {
    const input = z.object({ name: z.string().trim().min(1).max(80), cwd: z.string().min(1).max(2048), mode: z.enum(['default', 'plan']).optional() }).parse(req.body);
    const cwd = await allowedProjectPath(input.cwd, config.allowedRoots);
    if (store.listProjects().some(p => p.cwd === cwd)) throw new AppError(409, 'PROJECT_EXISTS', 'Bu proje dizini zaten kayıtlı.');
    return store.createProject({ ...input, cwd, host: os.hostname() });
  });
  app.post('/api/projects/:id/preferences', async req => {
    const input = z.object({ pushEnabled: z.boolean() }).strict().parse(req.body);
    return store.updateProject(idParam(req), input);
  });
  app.post('/api/sessions', async req => {
    const body = z.object({ projectId: z.string(), title: z.string().trim().min(1).max(120).optional() }).parse(req.body);
    if (!store.getSetting('remoteControlEnabled', true)) throw new AppError(409, 'CONTROL_DISABLED', 'Uzaktan komut kabulü kapalı.');
    return store.createSession(body);
  });
  app.get('/api/discovery', async () => ({ sessions: await discoverSessions(discoveryOptions) }));
  app.post('/api/sessions/import', async req => {
    const body = z.object({ claudeSessionId: z.string().uuid(), pid: z.number().int().positive(), projectId: z.string() }).parse(req.body);
    const discovered = (await discoverSessions(discoveryOptions)).find(s => s.claudeSessionId === body.claudeSessionId && s.pid === body.pid);
    const project = store.getProject(body.projectId);
    if (!discovered || !project || project.cwd !== discovered.cwd) throw new AppError(409, 'IMPORT_TARGET_CHANGED', 'Kaynak süreç veya proje eşlemesi doğrulanamadı. Listeyi yenileyin.');
    if (store.listSessions().some(s => s.claudeSessionId === discovered.claudeSessionId)) throw new AppError(409, 'SESSION_EXISTS', 'Bu konuşma zaten kayıtlı.');
    const session = store.createSession({ projectId: project.id, source: 'imported', claudeSessionId: discovered.claudeSessionId, sourcePid: discovered.pid, sourceStart: discovered.processStart, tmuxPane: discovered.tmuxPane, title: discovered.title });
    store.appendMessage(session.id, 'system', 'Mevcut Claude oturumu kaydedildi. Kaynak süreç çalışırken intRem mesaj göndermez. İş tamamlanıp terminal oturumundan çıktıktan sonra aynı konuşma devralınabilir.');
    return session;
  });
  app.post('/api/sessions/:id/takeover', async req => {
    const input = z.object({ generation: z.string() }).parse(req.body), session = sessionById(idParam(req));
    if (session.generation !== input.generation) throw new AppError(409, 'STALE_GENERATION', 'Oturum değişti. Listeyi yenileyin.');
    if (!store.getSetting('remoteControlEnabled', true)) throw new AppError(409, 'CONTROL_DISABLED', 'Uzaktan komut kabulü kapalı.');
    if (session.source !== 'imported' || !session.claudeSessionId) throw new AppError(409, 'NOT_IMPORT', 'Bu oturum devir beklemiyor.');
    if (await isSourceAlive(session)) throw new AppError(409, 'SOURCE_ACTIVE', 'Kaynak Claude süreci hâlâ çalışıyor. İşi güvenle tamamlayıp terminalden çıktıktan sonra devralın.');
    const project = store.getProject(session.projectId)!;
    await allowedProjectPath(project.cwd, config.allowedRoots);
    const history = await sourceHistory(session, project.cwd, true);
    if (await isSourceAlive(session)) throw new AppError(409, 'SOURCE_ACTIVE', 'Kaynak süreç hâlâ çalışıyor.');
    if ((await discoverSessions(discoveryOptions)).some(s => s.claudeSessionId === session.claudeSessionId)) throw new AppError(409, 'SOURCE_ACTIVE', 'Bu konuşma başka bir kaynak süreçte hâlâ çalışıyor.');
    return store.takeoverSession(session.id, input.generation, history);
  });
  app.get('/api/sessions/:id/messages', async req => {
    const session = sessionById(idParam(req));
    const history = session.source === 'imported' ? await sourceHistory(session, await allowedProjectPath(store.getProject(session.projectId)!.cwd, config.allowedRoots)) : [];
    return { messages: [...history, ...store.listMessages(session.id)] };
  });
  app.post('/api/sessions/:id/messages', async req => store.enqueueMessage(idParam(req), z.object({ clientId: z.string().min(1).max(100), text: z.string().trim().min(1).max(32000), generation: z.string().min(1) }).parse(req.body)));
  app.post('/api/messages/:id/cancel', async req => store.cancelMessage(idParam(req)));
  app.get('/api/sessions/:id/reviews', async req => { const session = sessionById(idParam(req)); return { reviews: store.listReviews(session.id) }; });
  app.post('/api/sessions/:id/reviews', async req => {
    const input = z.object({ generation: z.string(), clientId: z.string().uuid() }).parse(req.body);
    const heartbeat = store.getSetting<string | null>('runnerHeartbeat', null);
    if (!heartbeat || Date.now() - Date.parse(heartbeat) > 15000) throw new AppError(409, 'RUNNER_OFFLINE', 'Çalıştırıcı çevrimdışı.');
    return store.requestReview(idParam(req), input.generation, input.clientId);
  });
  app.post('/api/reviews/:id/cancel', async req => store.cancelReview(idParam(req)));
  app.post('/api/interactions/:id/decision', async req => {
    const body = z.object({ generation: z.string(), contentHash: z.string(), behavior: z.enum(['allow', 'deny']), answers: z.record(z.string(), z.string().max(10000)).optional(), reason: z.string().max(2000).optional() }).parse(req.body);
    return store.decideInteraction(idParam(req), { generation: body.generation, contentHash: body.contentHash, decision: { behavior: body.behavior, ...(body.answers ? { answers: body.answers } : {}), ...(body.reason ? { reason: body.reason } : {}) }, deviceId: getIdentity(req)!.device.id });
  });
  app.post('/api/sessions/:id/stop', async req => {
    const body = z.object({ generation: z.string(), confirm: z.literal(true) }).parse(req.body), session = sessionById(idParam(req));
    if (session.source !== 'managed' || session.generation !== body.generation) throw new AppError(409, 'STALE_GENERATION', 'Yönetilen hedef oturum doğrulanamadı.');
    const heartbeat = store.getSetting<string | null>('runnerHeartbeat', null);
    if (!heartbeat || Date.now() - Date.parse(heartbeat) > 15_000) throw new AppError(409, 'RUNNER_OFFLINE', 'Oturum çalıştırıcısına ulaşılamıyor; durdurma isteği uygulanmış sayılmadı.');
    store.setSetting(`stop:${session.id}`, session.generation); store.event('session.stop_requested', session.id, { deviceId: getIdentity(req)!.device.id }); return { requested: true };
  });
  app.post('/api/control', async req => { const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body); store.setSetting('remoteControlEnabled', enabled); return { enabled }; });
  app.get('/api/devices', async () => ({ devices: auth.devices() }));
  app.post('/api/devices/:id/revoke', async req => { auth.revokeDevice(idParam(req)); store.event('device.revoked', null, { id: idParam(req) }); return { ok: true }; });
  const push = new PushService(store, auth, config);
  app.get('/api/push/key', async () => ({ publicKey: push.publicKey }));
  app.post('/api/devices/push', async req => {
    const body = z.object({ subscription: z.object({ endpoint: z.string().url().max(4096), expirationTime: z.number().nullable().optional(), keys: z.object({ auth: z.string().min(1).max(256), p256dh: z.string().min(1).max(512) }) }) }).parse(req.body);
    validatePushEndpoint(body.subscription.endpoint); auth.setPush(getIdentity(req)!.device.id, body.subscription); return { ok: true };
  });
  app.post('/api/push/test', async req => push.send(getIdentity(req)!.device.id));
  const streams = new Set<() => void>();
  app.get('/api/events/stream', async (req, reply) => {
    let after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(req.headers['last-event-id'] ?? (req.query as Record<string, unknown>).after ?? 0);
    const token = req.cookies.intrem_session;
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write('retry: 2000\n\n');
    const close = () => { clearInterval(timer); streams.delete(close); reply.raw.end(); };
    let ticks = 0;
    const pump = () => {
      if (!auth.authenticate(token)) { close(); return; }
      if (after > store.cursor()) { after = store.cursor(); reply.raw.write(`event: update\nid: ${after}\ndata: {"type":"resync"}\n\n`); }
      for (const event of store.eventsAfter(after, 200)) { after = event.id; if (!reply.raw.write(`event: update\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)) { close(); return; } }
      if (++ticks % 15 === 0) reply.raw.write(': keepalive\n\n');
    };
    const timer = setInterval(pump, 1000); timer.unref(); streams.add(close); req.raw.on('close', close); pump();
  });
  const stopPush = push.start();
  app.addHook('onClose', async () => { for (const close of streams) close(); await stopPush(); });
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
  if (fs.existsSync(path.join(webRoot, 'index.html')) && !webRoot.includes(`${path.sep}src${path.sep}`)) {
    await app.register(staticFiles, { root: webRoot, prefix: '/' });
    app.setNotFoundHandler(async (req, reply) => req.method === 'GET' && !req.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Adres bulunamadı.', code: 'NOT_FOUND' }));
  }
  return app;
}
