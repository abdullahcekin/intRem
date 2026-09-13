import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppEvent, DecisionInput, Interaction, Message, Project, Review, Session } from '../shared/types.js';
import { AppError } from './errors.js';

type Row = Record<string, unknown>;
type NewProject = Pick<Project, 'name' | 'cwd' | 'host'> & Partial<Pick<Project, 'mode'>>;
type NewSession = Pick<Session, 'projectId'> & Partial<Pick<Session, 'title' | 'source' | 'claudeSessionId' | 'sourcePid' | 'sourceStart' | 'tmuxPane'>>;
type NewInteraction = Pick<Interaction, 'sessionId' | 'generation' | 'requestId' | 'kind' | 'toolName' | 'input' | 'expiresAt'>;
type InteractionDecision = { generation: string; contentHash: string; decision: DecisionInput; deviceId: string };
const sessionStates = ['idle', 'working', 'waiting_answer', 'permission_required', 'offline', 'delivery_unknown'];
const messageStates = ['queued', 'delivering', 'processing', 'completed', 'failed', 'cancelled', 'delivery_unknown'];
const now = () => new Date().toISOString();
const conflict = (code: string, message: string): never => { throw new AppError(409, code, message); };

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(400, 'INVALID_FIELD', `${field} boş olmayan metin olmalıdır.`);
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || seen.has(value)) throw new AppError(400, 'INVALID_JSON', 'Veri geçerli JSON olmalıdır.');
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) result = `[${value.map(item => canonical(item, seen)).join(',')}]`;
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new AppError(400, 'INVALID_JSON', 'Veri düz JSON nesnesi olmalıdır.');
    result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Row)[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function projectRow(row: Row): Project { return { ...row, pushEnabled: !!row.pushEnabled } as unknown as Project; }
function sessionRow(row: Row): Session { return { ...row, controlEnabled: !!row.controlEnabled } as unknown as Session; }
function messageRow(row: Row): Message {
  const { generation: _generation, ...message } = row;
  return message as unknown as Message;
}
function interactionRow(row: Row): Interaction {
  return { ...row, input: JSON.parse(row.input as string), decision: row.decision === null ? null : JSON.parse(row.decision as string) } as unknown as Interaction;
}

export class Store {
  readonly db: DatabaseSync;
  private inTransaction = false;
  private closed = false;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, host TEXT NOT NULL,
        createdAt TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('default','plan')),
        dailyBudgetUsd REAL NOT NULL DEFAULT 0 CHECK(dailyBudgetUsd >= 0),
        pushEnabled INTEGER NOT NULL DEFAULT 0 CHECK(pushEnabled IN (0,1))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('managed','imported')),
        state TEXT NOT NULL CHECK(state IN ('idle','working','waiting_answer','permission_required','offline','delivery_unknown')),
        generation TEXT NOT NULL, claudeSessionId TEXT, sourcePid INTEGER, sourceStart TEXT, tmuxPane TEXT,
        requestedModel TEXT, actualModel TEXT, account TEXT, fallbackReason TEXT,
        controlEnabled INTEGER NOT NULL CHECK(controlEnabled IN (0,1)),
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastActivityAt TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), clientId TEXT,
        generation TEXT, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), text TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','delivering','processing','completed','failed','cancelled','delivery_unknown')),
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, error TEXT,
        UNIQUE(sessionId,clientId)
      );
      CREATE INDEX IF NOT EXISTS messages_queue ON messages(sessionId,state,createdAt);
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), generation TEXT NOT NULL,
        requestId TEXT NOT NULL, contentHash TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('permission','question','plan')), toolName TEXT NOT NULL,
        input TEXT NOT NULL CHECK(json_valid(input)),
        status TEXT NOT NULL CHECK(status IN ('pending','answered','expired','cancelled')),
        createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
        decision TEXT CHECK(decision IS NULL OR json_valid(decision)), decidedBy TEXT, appliedAt TEXT,
        UNIQUE(sessionId,generation,requestId)
      );
      CREATE INDEX IF NOT EXISTS interactions_pending ON interactions(status,expiresAt);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
        sessionId TEXT REFERENCES sessions(id), data TEXT NOT NULL CHECK(json_valid(data)), createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), generation TEXT NOT NULL, clientId TEXT NOT NULL,
        status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', revision TEXT, exitCode INTEGER,
        UNIQUE(sessionId,clientId)
      );
    `);
  }

  private transaction<T>(operation: () => T): T {
    if (this.inTransaction) return operation();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally { this.inTransaction = false; }
  }

  private requiredSession(id: string): Session {
    const session = this.getSession(id);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Oturum bulunamadı.');
    return session;
  }

  listReviews(sessionId?: string): Review[] {
    return (sessionId ? this.db.prepare('SELECT * FROM reviews WHERE sessionId = ? ORDER BY createdAt').all(sessionId) : this.db.prepare('SELECT * FROM reviews ORDER BY createdAt').all()) as unknown as Review[];
  }
  getReview(id: string): Review | undefined { return this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as unknown as Review | undefined; }
  hasActiveReview(projectId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM reviews r JOIN sessions s ON s.id=r.sessionId WHERE s.projectId=? AND r.status IN ('queued','running','cancelling') LIMIT 1").get(projectId);
  }
  requestReview(sessionId: string, generation: string, clientId: string): Review {
    text(clientId, 'clientId');
    return this.transaction(() => {
      const session = this.requiredSession(sessionId);
      const existing = this.listReviews(sessionId).find(r => r.clientId === clientId);
      if (existing) { if (existing.generation !== generation) conflict('STALE_GENERATION', 'İnceleme nesli değişti.'); return existing; }
      this.controllable(session);
      if (session.generation !== generation) conflict('STALE_GENERATION', 'Oturum değişti.');
      if (this.hasActiveReview(session.projectId) || this.listSessions().some(s => s.projectId === session.projectId && !['idle', 'offline'].includes(s.state))) conflict('PROJECT_BUSY', 'Projedeki etkin işi tamamlayıp incelemeyi başlatın.');
      const stamp = now(), id = randomUUID();
      this.db.prepare("INSERT INTO reviews(id,sessionId,generation,clientId,status,createdAt,updatedAt) VALUES(?,?,?,?,'queued',?,?)").run(id, sessionId, generation, clientId, stamp, stamp);
      const review = this.getReview(id)!;
      this.event('review.queued', sessionId, { review });
      return review;
    });
  }
  updateReview(id: string, status: Review['status'], output = '', revision: string | null = null, exitCode: number | null = null): Review {
    return this.transaction(() => {
      const existing = this.getReview(id);
      if (!existing) throw new AppError(404, 'REVIEW_NOT_FOUND', 'İnceleme bulunamadı.');
      this.db.prepare('UPDATE reviews SET status=?,output=?,revision=?,exitCode=?,updatedAt=? WHERE id=?').run(status, output.slice(-64000), revision ?? existing.revision, exitCode, now(), id);
      const review = this.getReview(id)!;
      this.event(`review.${status}`, review.sessionId, { review });
      return review;
    });
  }
  cancelReview(id: string): Review {
    return this.transaction(() => {
      const review = this.getReview(id);
      if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'İnceleme bulunamadı.');
      if (!['queued', 'running'].includes(review.status)) conflict('REVIEW_FINISHED', 'İnceleme artık durdurulabilir durumda değil.');
      return this.updateReview(id, review.status === 'queued' ? 'cancelled' : 'cancelling');
    });
  }

  private controllable(session: Session): void {
    if (!this.getSetting('remoteControlEnabled', true)) conflict('CONTROL_DISABLED', 'Uzaktan kontrol kapalı.');
    if (!session.controlEnabled || session.source !== 'managed') conflict('SESSION_CONTROL_DISABLED', 'Oturum kontrolü etkin değil.');
    if (session.state === 'offline' || session.state === 'delivery_unknown') conflict('SESSION_UNAVAILABLE', 'Oturum komut kabul edemiyor.');
  }

  listProjects(): Project[] { return this.db.prepare('SELECT * FROM projects ORDER BY rowid').all().map(projectRow); }
  getProject(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? projectRow(row) : undefined;
  }
  createProject(input: NewProject): Project {
    text(input.name, 'name'); text(input.cwd, 'cwd'); text(input.host, 'host');
    const mode = input.mode ?? 'default';
    if (!['default', 'plan'].includes(mode)) throw new AppError(400, 'INVALID_MODE', 'Proje modu geçersiz.');
    return this.transaction(() => {
      const project: Project = { id: randomUUID(), name: input.name, cwd: input.cwd, host: input.host, mode, createdAt: now(), dailyBudgetUsd: 0, pushEnabled: false };
      this.db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(project.id, project.name, project.cwd, project.host, project.createdAt, project.mode, project.dailyBudgetUsd, 0);
      this.event('project.created', null, { project });
      return project;
    });
  }

  updateProject(id: string, input: { pushEnabled: boolean }): Project {
    if (typeof input.pushEnabled !== 'boolean') throw new AppError(400, 'INVALID_INPUT', 'Bildirim tercihi geçersiz.');
    return this.transaction(() => {
      if (!this.getProject(id)) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Proje bulunamadı.');
      this.db.prepare('UPDATE projects SET pushEnabled = ? WHERE id = ?').run(Number(input.pushEnabled), id);
      const project = this.getProject(id)!;
      this.event('project.updated', null, { project });
      return project;
    });
  }

  takeoverSession(id: string, generation: string, history: Pick<Message, 'role' | 'text'>[]): Session {
    return this.transaction(() => {
      const session = this.requiredSession(id);
      if (session.generation !== generation || session.source !== 'imported') conflict('STALE_GENERATION', 'Devir hedefi değişti.');
      if (!this.getSetting('remoteControlEnabled', true)) conflict('CONTROL_DISABLED', 'Uzaktan kontrol kapalı.');
      for (const message of history) this.appendMessage(id, message.role, message.text);
      const changed = this.updateSession(id, { source: 'managed', state: 'idle', controlEnabled: true, generation: randomUUID() });
      this.appendMessage(id, 'system', 'Kontrollü devir hazır. Bir sonraki mesaj kayıtlı Claude konuşmasını sürdürecek. Kaynak geçmişindeki zamanlar aktarım anını gösterir.');
      return changed;
    });
  }

  listSessions(): Session[] { return this.db.prepare('SELECT * FROM sessions ORDER BY rowid').all().map(sessionRow); }
  getSession(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? sessionRow(row) : undefined;
  }
  createSession(input: NewSession): Session {
    text(input.projectId, 'projectId');
    const source = input.source ?? 'managed';
    if (!['managed', 'imported'].includes(source)) throw new AppError(400, 'INVALID_SOURCE', 'Oturum kaynağı geçersiz.');
    if (input.title !== undefined) text(input.title, 'title');
    for (const field of ['claudeSessionId', 'sourceStart', 'tmuxPane'] as const) if (input[field] !== undefined && input[field] !== null) text(input[field], field);
    if (input.sourcePid !== undefined && input.sourcePid !== null && (!Number.isSafeInteger(input.sourcePid) || input.sourcePid <= 0)) throw new AppError(400, 'INVALID_PID', 'Süreç kimliği geçersiz.');
    return this.transaction(() => {
      if (!this.getProject(input.projectId)) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Proje bulunamadı.');
      const stamp = now();
      const session: Session = { id: randomUUID(), projectId: input.projectId, title: input.title ?? 'Yeni oturum', source, state: source === 'managed' ? 'idle' : 'offline', generation: randomUUID(), claudeSessionId: input.claudeSessionId ?? null, sourcePid: input.sourcePid ?? null, sourceStart: input.sourceStart ?? null, tmuxPane: input.tmuxPane ?? null, requestedModel: null, actualModel: null, account: null, fallbackReason: null, controlEnabled: source === 'managed', createdAt: stamp, updatedAt: stamp, lastActivityAt: null };
      this.db.prepare(`INSERT INTO sessions (${Object.keys(session).join(',')}) VALUES (${Object.keys(session).map(() => '?').join(',')})`).run(...Object.values(session).map(value => typeof value === 'boolean' ? Number(value) : value));
      this.event('session.created', session.id, { session });
      return session;
    });
  }

  updateSession(id: string, patch: Partial<Session>): Session {
    const strings = ['title', 'generation'];
    const nullableStrings = ['claudeSessionId', 'sourceStart', 'tmuxPane', 'requestedModel', 'actualModel', 'account', 'fallbackReason', 'lastActivityAt'];
    for (const [key, value] of Object.entries(patch)) {
      if (strings.includes(key)) text(value, key);
      else if (nullableStrings.includes(key)) { if (value !== null) text(value, key); }
      else if (key === 'state' && typeof value === 'string' && sessionStates.includes(value)) continue;
      else if (key === 'source' && (value === 'managed' || value === 'imported')) continue;
      else if (key === 'controlEnabled' && typeof value === 'boolean') continue;
      else if (key === 'sourcePid' && (value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0))) continue;
      else throw new AppError(400, 'INVALID_SESSION_PATCH', `Oturum alanı güncellenemez: ${key}`);
    }
    return this.transaction(() => {
      const current = this.requiredSession(id);
      if (!Object.keys(patch).length) return current;
      const values = { ...patch, updatedAt: now() };
      this.db.prepare(`UPDATE sessions SET ${Object.keys(values).map(key => `${key} = ?`).join(',')} WHERE id = ?`).run(...Object.values(values).map(value => typeof value === 'boolean' ? Number(value) : value), id);
      const session = this.requiredSession(id);
      this.event('session.updated', id, { session });
      return session;
    });
  }

  listMessages(sessionId: string): Message[] { return this.db.prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY rowid').all(sessionId).map(messageRow); }
  private getMessage(id: string): Message {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
    return messageRow(row);
  }
  enqueueMessage(sessionId: string, input: { clientId: string; text: string; generation: string }): Message {
    text(input.clientId, 'clientId'); text(input.text, 'text'); text(input.generation, 'generation');
    return this.transaction(() => {
      const session = this.requiredSession(sessionId);
      const existing = this.db.prepare('SELECT * FROM messages WHERE sessionId = ? AND clientId = ?').get(sessionId, input.clientId);
      if (existing) {
        if (existing.text !== input.text || existing.generation !== input.generation) conflict('IDEMPOTENCY_MISMATCH', 'Aynı istemci kimliği farklı içerikle kullanıldı.');
        return messageRow(existing);
      }
      if (session.generation !== input.generation) conflict('STALE_GENERATION', 'Oturum nesli değişti.');
      this.controllable(session);
      const stamp = now();
      const message: Message = { id: randomUUID(), sessionId, clientId: input.clientId, role: 'user', text: input.text, state: 'queued', createdAt: stamp, updatedAt: stamp, error: null };
      this.db.prepare('INSERT INTO messages (id,sessionId,clientId,generation,role,text,state,createdAt,updatedAt,error) VALUES (?,?,?,?,?,?,?,?,?,?)').run(message.id, sessionId, message.clientId, input.generation, message.role, message.text, message.state, stamp, stamp, null);
      this.event('message.created', sessionId, { message });
      return message;
    });
  }
  cancelMessage(id: string): Message {
    return this.transaction(() => {
      const message = this.getMessage(id);
      if (message.state !== 'queued') conflict('MESSAGE_NOT_QUEUED', 'Yalnız kuyruktaki mesaj iptal edilebilir.');
      return this.updateMessage(id, { state: 'cancelled' });
    });
  }
  claimNextMessage(sessionId: string): Message | undefined {
    return this.transaction(() => {
      const session = this.requiredSession(sessionId);
      if (session.state !== 'idle' || session.source !== 'managed' || !session.controlEnabled || !this.getSetting('remoteControlEnabled', true)) return undefined;
      if (this.hasActiveReview(session.projectId)) return undefined;
      if (this.db.prepare("SELECT id FROM interactions WHERE sessionId = ? AND generation = ? AND (status = 'pending' OR (status = 'answered' AND appliedAt IS NULL)) LIMIT 1").get(sessionId, session.generation)) return undefined;
      const row = this.db.prepare("SELECT * FROM messages WHERE sessionId = ? AND state = 'queued' AND generation = ? ORDER BY rowid LIMIT 1").get(sessionId, session.generation);
      if (!row) return undefined;
      const message = this.updateMessage(row.id as string, { state: 'delivering' });
      this.updateSession(sessionId, { state: 'working', lastActivityAt: now() });
      return message;
    });
  }
  updateMessage(id: string, patch: Partial<Message>): Message {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'text' && typeof value === 'string') continue;
      if (key === 'error' && (typeof value === 'string' || value === null)) continue;
      if (key === 'state' && typeof value === 'string' && messageStates.includes(value)) continue;
      throw new AppError(400, 'INVALID_MESSAGE_PATCH', `Mesaj alanı güncellenemez: ${key}`);
    }
    return this.transaction(() => {
      const current = this.getMessage(id);
      if (!Object.keys(patch).length) return current;
      const values = { ...patch, updatedAt: now() };
      this.db.prepare(`UPDATE messages SET ${Object.keys(values).map(key => `${key} = ?`).join(',')} WHERE id = ?`).run(...Object.values(values), id);
      const message = this.getMessage(id);
      this.event('message.updated', message.sessionId, { message });
      return message;
    });
  }
  appendMessage(sessionId: string, role: Message['role'], value: string): Message {
    if (!['user', 'assistant', 'system'].includes(role) || typeof value !== 'string') throw new AppError(400, 'INVALID_MESSAGE', 'Mesaj geçersiz.');
    return this.transaction(() => {
      const session = this.requiredSession(sessionId);
      const stamp = now();
      const message: Message = { id: randomUUID(), sessionId, clientId: null, role, text: value, state: 'completed', createdAt: stamp, updatedAt: stamp, error: null };
      this.db.prepare('INSERT INTO messages (id,sessionId,clientId,generation,role,text,state,createdAt,updatedAt,error) VALUES (?,?,?,?,?,?,?,?,?,?)').run(message.id, sessionId, null, session.generation, role, value, message.state, stamp, stamp, null);
      this.event('message.created', sessionId, { message });
      return message;
    });
  }

  createInteraction(input: NewInteraction): Interaction {
    text(input.generation, 'generation'); text(input.requestId, 'requestId'); text(input.toolName, 'toolName');
    if (!['permission', 'question', 'plan'].includes(input.kind)) throw new AppError(400, 'INVALID_INTERACTION', 'İstek türü geçersiz.');
    if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) throw new AppError(400, 'INVALID_INPUT', 'İstek girdisi nesne olmalıdır.');
    const expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiry)) throw new AppError(400, 'INVALID_EXPIRY', 'Son geçerlilik zamanı geçersiz.');
    const serializedInput = canonical(input.input);
    const contentHash = createHash('sha256').update(canonical({ kind: input.kind, toolName: input.toolName, input: input.input })).digest('hex');
    return this.transaction(() => {
      const session = this.requiredSession(input.sessionId);
      if (session.generation !== input.generation) conflict('STALE_GENERATION', 'Oturum nesli değişti.');
      const existing = this.db.prepare('SELECT * FROM interactions WHERE sessionId = ? AND generation = ? AND requestId = ?').get(input.sessionId, input.generation, input.requestId);
      if (existing) {
        if (existing.contentHash !== contentHash) conflict('INTERACTION_MISMATCH', 'Aynı istek kimliği farklı içerikle kullanıldı.');
        return interactionRow(existing);
      }
      const interaction: Interaction = { ...input, id: randomUUID(), input: JSON.parse(serializedInput) as Record<string, unknown>, contentHash, status: 'pending', createdAt: now(), expiresAt: new Date(expiry).toISOString(), decision: null, decidedBy: null, appliedAt: null };
      this.db.prepare('INSERT INTO interactions (id,sessionId,generation,requestId,contentHash,kind,toolName,input,status,createdAt,expiresAt,decision,decidedBy,appliedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(interaction.id, input.sessionId, input.generation, input.requestId, contentHash, input.kind, input.toolName, serializedInput, interaction.status, interaction.createdAt, interaction.expiresAt, null, null, null);
      this.updateSession(input.sessionId, { state: input.kind === 'question' ? 'waiting_answer' : 'permission_required' });
      this.event('interaction.created', input.sessionId, { interaction });
      return interaction;
    });
  }
  getInteraction(id: string): Interaction | undefined {
    const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
    return row ? interactionRow(row) : undefined;
  }
  listInteractions(sessionId?: string): Interaction[] {
    return (sessionId === undefined ? this.db.prepare('SELECT * FROM interactions ORDER BY rowid').all() : this.db.prepare('SELECT * FROM interactions WHERE sessionId = ? ORDER BY rowid').all(sessionId)).map(interactionRow);
  }
  decideInteraction(id: string, input: InteractionDecision): Interaction {
    text(input.deviceId, 'deviceId'); text(input.generation, 'generation'); text(input.contentHash, 'contentHash');
    if (!input.decision || !['allow', 'deny'].includes(input.decision.behavior)) throw new AppError(400, 'INVALID_DECISION', 'Karar geçersiz.');
    for (const key of Object.keys(input.decision)) if (!['behavior', 'answers', 'reason'].includes(key)) throw new AppError(400, 'INVALID_DECISION', 'Karar alanı geçersiz.');
    if (input.decision.reason !== undefined && typeof input.decision.reason !== 'string') throw new AppError(400, 'INVALID_DECISION', 'Karar gerekçesi metin olmalıdır.');
    if (input.decision.answers !== undefined && (input.decision.answers === null || typeof input.decision.answers !== 'object' || Array.isArray(input.decision.answers) || Object.values(input.decision.answers).some(answer => typeof answer !== 'string'))) throw new AppError(400, 'INVALID_DECISION', 'Yanıtlar metin eşleşmeleri olmalıdır.');
    const serializedDecision = canonical(input.decision);
    this.expireInteractions();
    return this.transaction(() => {
      const interaction = this.getInteraction(id);
      if (!interaction) throw new AppError(404, 'INTERACTION_NOT_FOUND', 'İstek bulunamadı.');
      const session = this.requiredSession(interaction.sessionId);
      if (interaction.status !== 'pending') conflict('INTERACTION_ALREADY_DECIDED', 'İstek artık yanıt beklemiyor.');
      if (interaction.generation !== input.generation || session.generation !== input.generation) conflict('STALE_GENERATION', 'Oturum nesli değişti.');
      if (interaction.contentHash !== input.contentHash) conflict('CONTENT_MISMATCH', 'İstek içeriği değişti.');
      if (Date.parse(interaction.expiresAt) <= Date.now()) conflict('INTERACTION_EXPIRED', 'İsteğin süresi doldu.');
      if (input.decision.behavior === 'allow' && interaction.kind === 'plan' && (typeof interaction.input.plan !== 'string' || !interaction.input.plan.trim())) conflict('PLAN_CONTENT_REQUIRED', 'Onaylanacak plan içeriği bulunamadı.');
      if (input.decision.behavior === 'allow' && interaction.kind === 'question') {
        const questions = interaction.input.questions;
        const answers = input.decision.answers ?? {};
        if (!Array.isArray(questions) || !questions.length || questions.some(q => !q || typeof q.question !== 'string' || !answers[q.question]?.trim()) || Object.keys(answers).some(key => !questions.some(q => q.question === key))) throw new AppError(400, 'ANSWERS_REQUIRED', 'Her soru için geçerli bir yanıt gereklidir.');
      }
      this.controllable(session);
      const result = this.db.prepare("UPDATE interactions SET status = 'answered', decision = ?, decidedBy = ? WHERE id = ? AND status = 'pending'").run(serializedDecision, input.deviceId, id);
      if (result.changes !== 1) conflict('INTERACTION_ALREADY_DECIDED', 'İstek zaten yanıtlandı.');
      const decided = this.getInteraction(id)!;
      this.event('interaction.answered', interaction.sessionId, { interaction: decided });
      return decided;
    });
  }

  markInteractionApplied(id: string, generation: string): Interaction {
    return this.transaction(() => {
      const interaction = this.getInteraction(id);
      if (!interaction) throw new AppError(404, 'INTERACTION_NOT_FOUND', 'İstek bulunamadı.');
      const session = this.requiredSession(interaction.sessionId);
      if (interaction.generation !== generation || session.generation !== generation) conflict('STALE_GENERATION', 'Oturum nesli değişti.');
      if (interaction.status !== 'answered') conflict('INTERACTION_NOT_ANSWERED', 'İstek uygulanabilir bir yanıt içermiyor.');
      if (interaction.appliedAt !== null) conflict('INTERACTION_ALREADY_APPLIED', 'Karar zaten uygulandı.');
      if (Date.parse(interaction.expiresAt) <= Date.now()) conflict('INTERACTION_EXPIRED', 'İsteğin süresi doldu.');
      this.controllable(session);
      this.db.prepare('UPDATE interactions SET appliedAt = ? WHERE id = ? AND appliedAt IS NULL').run(now(), id);
      const updated = this.getInteraction(id)!;
      this.event('interaction.applied', interaction.sessionId, { interaction: updated });
      return updated;
    });
  }
  expireInteractions(): number {
    return this.transaction(() => {
      const expired = this.db.prepare("SELECT id,sessionId FROM interactions WHERE status = 'pending' AND expiresAt <= ?").all(now());
      for (const interaction of expired) {
        this.db.prepare("UPDATE interactions SET status = 'expired' WHERE id = ?").run(interaction.id as string);
        this.event('interaction.expired', interaction.sessionId as string, { interaction: this.getInteraction(interaction.id as string)! });
      }
      return expired.length;
    });
  }
  cancelInteraction(id: string, generation: string): boolean {
    return this.transaction(() => {
      const result = this.db.prepare("UPDATE interactions SET status = 'cancelled' WHERE id = ? AND generation = ? AND appliedAt IS NULL AND status IN ('pending', 'answered')").run(id, generation);
      if (result.changes !== 1) return false;
      const interaction = this.getInteraction(id)!;
      this.event('interaction.cancelled', interaction.sessionId, { interaction });
      return true;
    });
  }

  expireSessionInteractions(sessionId: string, generation: string): number {
    return this.transaction(() => {
      this.requiredSession(sessionId);
      const interactions = this.db.prepare("SELECT id FROM interactions WHERE sessionId = ? AND generation = ? AND (status = 'pending' OR (status = 'answered' AND appliedAt IS NULL))").all(sessionId, generation);
      for (const interaction of interactions) {
        this.db.prepare("UPDATE interactions SET status = 'cancelled' WHERE id = ?").run(interaction.id as string);
        this.event('interaction.cancelled', sessionId, { interaction: this.getInteraction(interaction.id as string)! });
      }
      return interactions.length;
    });
  }

  event(type: string, sessionId: string | null, data: Record<string, unknown>): AppEvent {
    text(type, 'type');
    const serialized = canonical(data);
    const createdAt = now();
    const result = this.db.prepare('INSERT INTO events (type,sessionId,data,createdAt) VALUES (?,?,?,?)').run(type, sessionId, serialized, createdAt);
    return { id: Number(result.lastInsertRowid), type, sessionId, data: JSON.parse(serialized) as Record<string, unknown>, createdAt };
  }
  eventsAfter(cursor: number, limit = 500): AppEvent[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new AppError(400, 'INVALID_CURSOR', 'Olay imleci veya sınırı geçersiz.');
    return this.db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?').all(cursor, limit).map(row => ({ ...row, data: JSON.parse(row.data as string) }) as unknown as AppEvent);
  }
  cursor(): number { return Number(this.db.prepare('SELECT COALESCE(MAX(id),0) AS cursor FROM events').get()!.cursor); }
  getSetting<T = unknown>(key: string, fallback?: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) return JSON.parse(row.value as string) as T;
    return (fallback === undefined && key === 'remoteControlEnabled' ? true : fallback) as T;
  }
  setSetting(key: string, value: unknown): void {
    text(key, 'key');
    if (key === 'remoteControlEnabled' && typeof value !== 'boolean') throw new AppError(400, 'INVALID_SETTING', 'Uzaktan kontrol ayarı mantıksal değer olmalıdır.');
    const serialized = canonical(value);
    this.transaction(() => {
      this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, serialized);
      // Ayarlar VAPID gibi sırları ve sık heartbeat kayıtlarını içerir; olay akışına taşınmaz.
      if (key === 'remoteControlEnabled') this.event('control.updated', null, { enabled: value });
    });
  }

  recoverDeliveries(): number {
    return this.transaction(() => {
      const messages = this.db.prepare("SELECT id,sessionId FROM messages WHERE state IN ('delivering','processing')").all();
      const interactions = this.db.prepare("SELECT id,sessionId FROM interactions WHERE status = 'pending' OR (status = 'answered' AND appliedAt IS NULL)").all();
      const affected = new Set([...messages, ...interactions].map(row => row.sessionId as string));
      for (const message of messages) this.updateMessage(message.id as string, { state: 'delivery_unknown', error: 'Runner yeniden başladı; önceki teslimin sonucu bilinmiyor.' });
      for (const interaction of interactions) {
        this.db.prepare("UPDATE interactions SET status = 'expired' WHERE id = ?").run(interaction.id as string);
        this.event('interaction.expired', interaction.sessionId as string, { interaction: this.getInteraction(interaction.id as string)! });
      }
      for (const id of affected) this.updateSession(id, { state: 'delivery_unknown', controlEnabled: false });
      return messages.length;
    });
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}
