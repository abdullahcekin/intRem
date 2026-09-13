import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.js';
import { RunnerLock } from '../src/runtime/lock.js';

describe('runner süreç sahipliği', () => {
  let directory: string;
  let store: Store;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'intrem-lock-'));
    store = new Store(path.join(directory, 'intrem.db'));
  });
  afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

  it('başka SQLite bağlantısından aynı anda yalnız tek süreç kilidi alınır', async () => {
    const connection = new Store(path.join(directory, 'intrem.db'));
    const first = new RunnerLock(store.db);
    const second = new RunnerLock(connection.db);
    try {
      const results = await Promise.allSettled([first.acquire(), second.acquire()]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    } finally { first.release(); second.release(); connection.close(); }
  });

  it('yalnız çıkmış PIDye ait stale kilidi devralır, eski owner yenisini silemez', async () => {
    const first = new RunnerLock(store.db); await first.acquire();
    store.db.prepare('UPDATE runner_lock SET pid = ?, processStart = ? WHERE id = 1').run(2147483647, '1');
    const second = new RunnerLock(store.db); await second.acquire();
    first.release();
    const third = new RunnerLock(store.db);
    await expect(third.acquire()).rejects.toMatchObject({ code: 'RUNNER_ALREADY_RUNNING' });
    second.release();
    await third.acquire(); third.release();
  });
});
