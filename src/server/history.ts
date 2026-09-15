import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';
import type { Message, Session } from '../shared/types.js';
import { AppError } from './errors.js';
import type { SourceHistoryRow } from '../runtime/source-history.js';

const execute = promisify(execFile);
export function historyReader(config: AppConfig) {
  const cache = new Map<string, { until: number; messages: Message[] }>();
  return async (session: Session, cwd: string, fresh = false): Promise<Message[]> => {
    if (!session.claudeSessionId || !/^[a-f0-9-]{36}$/i.test(session.claudeSessionId)) throw new AppError(409, 'HISTORY_TARGET', 'Kaynak konuşma kimliği doğrulanamadı.');
    const cached = cache.get(session.id);
    if (!fresh && cached && cached.until > Date.now()) return cached.messages;
    try {
      // Ayrı süreç, farklı Claude veri dizinlerinin global SDK ortamını paylaşmasını önler.
      const development = import.meta.url.endsWith('.ts');
      const script = fileURLToPath(new URL(`../runtime/history-reader.${development ? 'ts' : 'js'}`, import.meta.url));
      const { stdout } = await execute(process.execPath, ['--max-old-space-size=256', ...(development ? ['--import', 'tsx'] : []), script, session.claudeSessionId, cwd], {
        env: { ...process.env, CLAUDE_CONFIG_DIR: config.claudeHome }, timeout: 12000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      });
      const rows = JSON.parse(stdout) as SourceHistoryRow[];
      const messages: Message[] = rows.map(row => ({ id: `source:${row.id}`, sessionId: session.id, clientId: null, role: row.role, text: `[Kaynak geçmişi]\n${row.text}`, state: 'completed', createdAt: row.createdAt ?? session.createdAt, updatedAt: row.createdAt ?? session.createdAt, error: null, ...(row.sourceQuestion ? { sourceQuestion: row.sourceQuestion } : {}) }));
      cache.set(session.id, { until: Date.now() + 4000, messages });
      for (const [id, entry] of cache) if (entry.until < Date.now() - 60000) cache.delete(id);
      return messages;
    } catch { throw new AppError(503, 'HISTORY_UNAVAILABLE', 'Kaynak geçmişi okunamadı. Kaynak oturum değişmedi; tekrar yenileyin.'); }
  };
}
