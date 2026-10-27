'use strict';

const settings = require('./settings');
const store = require('./store');
const checker = require('./checker');

let timer = null;

function nextDelayMs() {
  const s = settings.get();
  const base = Math.max(1, Number(s.intervalMinutes) || 10) * 60 * 1000;
  const jitter = Math.min(90, Math.max(0, Number(s.jitterPercent) || 0)) / 100;
  return Math.round(base * (1 + (Math.random() * 2 - 1) * jitter));
}

function schedule(delay = nextDelayMs()) {
  clearTimeout(timer);
  const at = Date.now() + delay;
  store.update('status', { portals: {} }, (st) => {
    st.nextRun = at;
  });
  timer = setTimeout(async () => {
    try {
      await checker.runAll('harmonogram');
    } catch (e) {
      console.error('[scheduler]', e);
    }
    schedule();
  }, delay);
}

function start() {
  // First run shortly after start-up.
  schedule(15 * 1000);
}

module.exports = { start, schedule };
