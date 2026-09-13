import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../server/errors.js';
import { readProcessStart } from './discovery.js';

interface LockRecord { ownerId: string; pid: number; processStart: string | null; uid: number | null }

export class RunnerLock {
  private readonly ownerId = randomUUID();
  private held = false;

  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS runner_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1), ownerId TEXT NOT NULL,
      pid INTEGER NOT NULL, processStart TEXT, uid INTEGER
    )`);
  }

  async acquire(): Promise<void> {
    if (this.held) return;
    const processStart = process.platform === 'linux' ? await readProcessStart(process.pid) : null;
    const uid = process.getuid?.() ?? null;
    const previous = this.db.prepare('SELECT ownerId,pid,processStart,uid FROM runner_lock WHERE id = 1').get() as unknown as LockRecord | undefined;
    if (previous && await this.alive(previous)) throw new AppError(409, 'RUNNER_ALREADY_RUNNING', 'Bu veritabanı için bir runner zaten çalışıyor.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT ownerId FROM runner_lock WHERE id = 1').get() as { ownerId: string } | undefined;
      // Recheck after the asynchronous OS probe; a concurrent contender may now own it.
      if (current?.ownerId !== previous?.ownerId) throw new AppError(409, 'RUNNER_ALREADY_RUNNING', 'Runner sahipliği başka bir süreç tarafından alındı.');
      this.db.prepare('INSERT OR REPLACE INTO runner_lock (id,ownerId,pid,processStart,uid) VALUES (1,?,?,?,?)').run(this.ownerId, process.pid, processStart, uid);
      this.db.exec('COMMIT');
      this.held = true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private async alive(record: LockRecord): Promise<boolean> {
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0) throw new AppError(409, 'RUNNER_LOCK_UNVERIFIED', 'Runner kilidindeki süreç kimliği doğrulanamadı.');
    if (process.platform === 'linux') {
      const current = await readProcessStart(record.pid, { uid: record.uid ?? undefined });
      if (current === null) return false;
      if (!record.processStart || !/^\d+$/.test(record.processStart)) throw new AppError(409, 'RUNNER_LOCK_UNVERIFIED', 'Runner kilidindeki başlangıç bilgisi doğrulanamadı.');
      return current === record.processStart;
    }
    // On platforms without /proc, a live PID is retained conservatively, even after reuse.
    try { process.kill(record.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw new AppError(409, 'RUNNER_LOCK_UNVERIFIED', 'Runner sürecinin çıktığı doğrulanamadı.');
    }
  }

  release(): void {
    if (!this.held) return;
    this.db.prepare('DELETE FROM runner_lock WHERE id = 1 AND ownerId = ?').run(this.ownerId);
    this.held = false;
  }
}
