'use strict';

const crypto = require('crypto');
const store = require('./store');

const DEFAULTS = {
  telegram: {
    // Server: on (alerts go to Telegram). Desktop app: off by default — system notifications instead.
    enabled: !process.env.ET_DESKTOP,
    botToken: '',
    chatId: '',
    threadId: '', // wątek (forum topic) dla alertów o ofertach
    warnThreadId: '', // osobny wątek dla ostrzeżeń technicznych (puste = ten sam co alerty)
  },
  intervalMinutes: 10,
  jitterPercent: 25, // losowy rozrzut interwału ±%
  requestDelaySec: [4, 9], // odstęp między kolejnymi zapytaniami do portali
  zeroOffersWarnAfter: 3, // ile przebiegów z rzędu z 0 ofert = ostrzeżenie
  errorWarnAfter: 3, // ile przebiegów z rzędu z błędem = ostrzeżenie
  maxAlertsPerRun: 15, // bezpiecznik przed zalewem alertów
  panel: { user: 'admin', password: '' },
};

function merge(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], val ? val[k] : undefined);
    return out;
  }
  return val === undefined || val === null ? def : val;
}

function get() {
  const s = merge(DEFAULTS, store.load('settings', {}));
  if (process.env.TELEGRAM_BOT_TOKEN) s.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) s.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
  if (process.env.TELEGRAM_THREAD_ID) s.telegram.threadId = process.env.TELEGRAM_THREAD_ID;
  if (process.env.PANEL_USER) s.panel.user = process.env.PANEL_USER;
  if (process.env.PANEL_PASSWORD) s.panel.password = process.env.PANEL_PASSWORD;
  return s;
}

function set(patch) {
  const cur = merge(DEFAULTS, store.load('settings', {}));
  const next = merge(DEFAULTS, deepAssign(cur, patch));
  store.save('settings', next);
  return get();
}

function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = deepAssign(target[k] || {}, v);
    else target[k] = v;
  }
  return target;
}

// On first start there is no panel password: generate one and print it once.
function ensurePanelPassword() {
  const s = get();
  if (s.panel.password) return null;
  const pass = crypto.randomBytes(9).toString('base64url');
  set({ panel: { password: pass } });
  return pass;
}

module.exports = { get, set, ensurePanelPassword, DEFAULTS };
