import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createApp } from './app.js';
const config = loadConfig(), store = new Store(config.dbPath);
const app = await createApp({ config, store });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); store.close(); process.exit(0); });
try { await app.listen({ host: config.host, port: config.port }); console.log(`intRem API ${config.origin} adresi için hazır.`); }
catch { console.error('intRem API başlatılamadı. Dinleme adresi ve veri dizinini kontrol edin.'); store.close(); process.exit(1); }
