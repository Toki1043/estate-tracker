'use strict';

const settings = require('./settings');
const { sleep, fmtInt, fmtNum, escapeHtml } = require('./util');

let lastSend = 0;

async function call(method, payload) {
  const { botToken } = settings.get().telegram;
  if (!botToken) throw new Error('Brak tokenu bota Telegram (Ustawienia)');
  for (let attempt = 0; attempt < 3; attempt++) {
    // Telegram allows ~1 message/second per chat.
    const wait = lastSend + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastSend = Date.now();
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) return data.result;
    if (res.status === 429 && data.parameters?.retry_after) {
      await sleep((data.parameters.retry_after + 1) * 1000);
      continue;
    }
    const err = new Error(`Telegram ${method}: ${data.description || res.status}`);
    err.status = res.status;
    throw err;
  }
  throw new Error(`Telegram ${method}: zbyt wiele prób`);
}

function target(threadOverride, kind = 'alert') {
  const t = settings.get().telegram;
  if (!t.chatId) throw new Error('Brak Chat ID (Ustawienia)');
  const thread = threadOverride || (kind === 'warn' ? t.warnThreadId || t.threadId : t.threadId);
  const out = { chat_id: t.chatId };
  if (thread) out.message_thread_id = Number(thread);
  return out;
}

function offerCaption(o, searchName) {
  const lines = [`<b>${escapeHtml(o.title || 'Nowa oferta')}</b>`, ''];
  lines.push(`💰 ${o.price ? `${fmtInt(o.price)} zł` : 'cena nieznana'}`);
  const parts = [];
  if (o.area) parts.push(`${fmtNum(o.area, 2)} m²`);
  if (o.plotArea) parts.push(`działka ${fmtNum(o.plotArea, 0)} m²`);
  if (parts.length) lines.push(`📐 ${parts.join(' · ')}`);
  if (o.pricePerM2) lines.push(`📊 ${fmtInt(o.pricePerM2)} zł/m²`);
  if (o.location) lines.push(`📍 ${escapeHtml(o.location)}`);
  if (o.featureSummary?.length) lines.push(`✨ ${escapeHtml(o.featureSummary.join(' · '))}`);
  if (o.unverified?.length) lines.push(`❔ nie potwierdzono: ${escapeHtml(o.unverified.join(', '))}`);
  lines.push(`🏷 ${escapeHtml(o.portalName)}${o.alsoOn?.length ? ` (także: ${escapeHtml(o.alsoOn.join(', '))})` : ''} · ${escapeHtml(searchName)}`);
  lines.push('', `🔗 <a href="${escapeHtml(o.url)}">Otwórz ogłoszenie</a>`);
  return lines.join('\n');
}

async function sendOffer(o, search) {
  const dest = target(search.telegramThreadId);
  let caption = offerCaption(o, search.name);
  // Photo captions are limited to 1024 characters: shorten the extras first, then the title.
  if (caption.length > 1024) caption = offerCaption({ ...o, featureSummary: (o.featureSummary || []).slice(0, 3), unverified: (o.unverified || []).slice(0, 3) }, search.name);
  if (caption.length > 1024) caption = offerCaption({ ...o, title: String(o.title || '').slice(0, 120), featureSummary: [], unverified: [] }, search.name);
  if (o.image) {
    try {
      return await call('sendPhoto', { ...dest, photo: o.image, caption, parse_mode: 'HTML' });
    } catch (e) {
      // Image could not be fetched by Telegram (hotlink protection, 404...): send text instead.
      if (e.status !== 400) throw e;
    }
  }
  return call('sendMessage', { ...dest, text: caption, parse_mode: 'HTML', link_preview_options: { is_disabled: false } });
}

async function sendText(text, { kind = 'alert', threadId } = {}) {
  return call('sendMessage', { ...target(threadId, kind), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

function configured() {
  const t = settings.get().telegram;
  return !!(t.enabled !== false && t.botToken && t.chatId);
}

module.exports = { sendOffer, sendText, configured, offerCaption };
