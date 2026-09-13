import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Auth } from './auth.js';
const config = loadConfig(), store = new Store(config.dbPath), auth = new Auth(store.db);
try {
  if (auth.hasCredentials()) console.log('Geçiş anahtarı kayıtlı; ilk kurulum kodu üretilmedi.');
  else {
    const filename = path.join(config.dataDir, 'bootstrap-token');
    fs.writeFileSync(filename, auth.resetBootstrap() + '\n', { mode: 0o600 });
    fs.chmodSync(filename, 0o600);
    console.log(`Tek kullanımlık kurulum kodu ${filename} dosyasına yazıldı. Kod repo veya loglara eklenmemelidir.`);
  }
} finally { store.close(); }
