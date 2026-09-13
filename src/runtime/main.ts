import { loadConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { Runner } from './runner.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const runner = new Runner(store, {
  allowedRoots: config.allowedRoots,
  claudeHome: config.claudeHome,
  claudeExecutable: config.claudeExecutable,
  codexExecutable: config.codexExecutable,
});
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await runner.stop();
  store.close();
  process.exitCode = 0;
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
await runner.start();
console.log('intRem runner hazır.');
