'use strict';

// Server version (VPS): panel with basic auth, alerts on Telegram.
const store = require('./store');
const { start } = require('./app');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';

start({ host: HOST, port: PORT }).then(({ port }) => {
  console.log(`estate-tracker: panel na http://localhost:${port} (dane: ${store.DATA_DIR})`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
