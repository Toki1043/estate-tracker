'use strict';

// Starting the engine (panel + scheduler) — shared by the server (src/index.js)
// and the desktop app (electron/main.js).

const settings = require('./settings');
const store = require('./store');
const scheduler = require('./scheduler');
const { createApp } = require('./server');

/**
 * @param {object} o
 * @param {string} o.host
 * @param {number} o.port 0 = any free port
 * @param {object|null} o.desktop { token, bridge } in the desktop app; null on the server
 * @returns {Promise<{ server, port }>}
 */
function start({ host = '0.0.0.0', port = 3100, desktop = null } = {}) {
  if (!desktop) {
    const generated = settings.ensurePanelPassword();
    if (generated) {
      console.log('==================================================================');
      console.log(` Panel: utworzono hasło. Login: ${settings.get().panel.user}  Hasło: ${generated}`);
      console.log(` (zapisane w ${store.DATA_DIR}/settings.json — zmienisz je w Ustawieniach)`);
      console.log('==================================================================');
    }
  }
  // A crash during a run must not leave the "running" flag set forever.
  store.update('status', { portals: {} }, (st) => {
    st.running = null;
  });
  return new Promise((resolve, reject) => {
    const server = createApp({ desktop }).listen(port, host, () => {
      // towns -> TERYT, distance re-check of saved offers (the first run waits for it)
      require('./migrate').start();
      scheduler.start();
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

module.exports = { start };
