/**
 * 麻雀セット出欠確認表 - フロントエンドエンジン（シンプル完全版）
 * 対応GASバージョン: 2026-11-28-v3
 * 機能：幹事＆招待一覧 / フィルタ / セット料金 / シンプル誤送信警告 / 開催確定＆再確認案内 / カレンダー登録 / LIFF対応
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-yNrj1KqUzx68Ar-NhDo9FgnetpyMoGdO_zAVdiM1yYHr-KJ0pHoqSVfAsVXailO5/exec';
const LIFF_ID = 'YOUR_LIFF_ID';

const STORAGE_MY_EVENTS = 'mj_set_my_events_v1';
const STORAGE_INVITED_EVENTS = 'mj_set_invited_events_v1';
const STORAGE_GUEST_NAME = 'mj_set_guest_name_v1';
const STORAGE_MY_RESPONSES = 'mj_set_my_responses_v1';
const STORAGE_LOCATIONS = 'mj_set_locations_v1';

const state = {
  createMode: 'single',
  lastCreated: [],
  dashboardEvents: [],
  invitedEvents: [],
  activeFilter: 'all',
  currentEventId: null,
  currentAdminKey: null,
  forcePreview: false,
  eventData: null,
  guestAnswers: {},
  invitedHistory: [],
  noticeType: 'confirm', // 'confirm' | 'reconfirm'
  confirmCustomEdited: false,
  liffReady: false,
  lineProfile: null
};

const calState = {
  mode: 'single',
  viewYear: 2026,
  viewMonth: 0,
  selectedStr: '',
  selectedSet: new Set(),
  existingSet: new Set(),
  onSelect: null,
  onConfirmMulti: null
};

/* =====================================================
   ユーティリティ
===================================================== */
const $ = (id) => document.getElementById(id);

function on(id, eventName, handler) {
  const el = $(id);
  if (el) el.addEventListener(eventName, handler);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLiffConfigured() {
  return Boolean(LIFF_ID && !LIFF_ID.includes('YOUR_LIFF_ID'));
}

function getBaseUrl() {
  return window.location.origin + window.location.pathname;
}

function buildGuestUrl(eventId) {
  if (isLiffConfigured()) {
    return `https://liff.line.me/${LIFF_ID}?id=${encodeURIComponent(eventId)}`;
  }
  return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}`;
}

function buildAdminUrl(eventId, adminKey) {
  if (adminKey) {
    return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}&key=${encodeURIComponent(adminKey)}`;
  }
  return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}`;
}

function buildPreviewUrl(eventId) {
  return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}&preview=1`;
}

function formatDateOnly(dateStr) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
    return `${m}/${d}(${w})`;
  }
  return String(dateStr || '').trim();
}

function formatDateLabel(dateStr, timeStr) {
  return [formatDateOnly(dateStr), String(timeStr || '').trim()].filter(Boolean).join(' ');
}

function formatDateButtonLabel(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return '日付を選択';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
  return `${y}年${m}月${d}日 (${w})`;
}

function formatShortTimestamp(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${m}/${d} ${hh}:${mm}`;
}

function getTodayStr(offsetDays = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function showLoading(text = '通信中...') {
  const txt = $('loading-text');
  const ov = $('loading-overlay');
  if (txt) txt.textContent = text;
  if (ov) ov.classList.remove('hidden');
}

function hideLoading() {
  const ov = $('loading-overlay');
  if (ov) ov.classList.add('hidden');
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function copyToClipboard(text, successMsg = 'コピーしました') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(successMsg);
  }
}

/* =====================================================
   カレンダー登録（Googleカレンダー ＆ iPhone/標準 .ics）
===================================================== */
function toCalDateTimeToken(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}00`;
}

function computeCalendarRange(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = parseTimeString(timeStr, '');
  const sh = parsed.sh !== '' ? Number(parsed.sh) : 13;
  const sm = parsed.sm !== '' ? Number(parsed.sm) : 0;

  const startDt = new Date(y, m - 1, d, sh, sm, 0);
  let endDt;

  if (parsed.eh !== '') {
    const eh = Number(parsed.eh);
    const em = parsed.em !== '' ? Number(parsed.em) : 0;
    endDt = new Date(y, m - 1, d, eh, em, 0);
    if (endDt.getTime() <= startDt.getTime()) {
      endDt.setDate(endDt.getDate() + 1);
    }
  } else {
    endDt = new Date(startDt.getTime() + 4 * 60 * 60 * 1000);
  }

  return {
    startToken: toCalDateTimeToken(startDt),
    endToken: toCalDateTimeToken(endDt)
  };
}

function buildCalendarDetailsText(ev, myRes) {
  const lines = [];
  if (ev.fee) lines.push(`セット料金：${ev.fee}`);
  if (ev.note) lines.push(ev.note);
  if (myRes?.condition_memo) lines.push(`自分の条件メモ：${myRes.condition_memo}`);
  lines.push(`出欠ページ：${buildGuestUrl(ev.id)}`);
  return lines.join('\n');
}

function buildGoogleCalendarUrl(ev, dateObj, myRes) {
  const range = computeCalendarRange(dateObj.date, dateObj.time);
  if (!range) return '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title || '麻雀セット',
    dates: `${range.startToken}/${range.endToken}`,
    ctz: 'Asia/Tokyo',
    location: ev.location || '',
    details: buildCalendarDetailsText(ev, myRes)
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeIcsText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadIcsFile(ev, dateObj, myRes) {
  const range = computeCalendarRange(dateObj.date, dateObj.time);
  if (!range) {
    showToast('日付情報が不正なためカレンダーファイルを作成できません');
    return;
  }

  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const uid = `${ev.id}-${dateObj.id || 'd1'}@mahjong-set.local`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MahjongSetApp//JP',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART;TZID=Asia/Tokyo:${range.startToken}`,
    `DTEND;TZID=Asia/Tokyo:${range.endToken}`,
    `SUMMARY:${escapeIcsText(ev.title || '麻雀セット')}`,
    `LOCATION:${escapeIcsText(ev.location || '')}`,
    `DESCRIPTION:${escapeIcsText(buildCalendarDetailsText(ev, myRes))}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mahjong_${dateObj.date || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('カレンダー用ファイル(.ics)を作成しました');
}

function renderGuestCalendarCard(ev, myRes) {
  const card = $('guest-calendar-card');
  const listEl = $('guest-calendar-list');
  if (!card || !listEl) return;

  const okDates = myRes
    ? (ev.dates || []).filter(d => myRes.answers?.[d.id] === 'ok' && /^\d{4}-\d{2}-\d{2}$/.test(d.date || ''))
    : [];

  if (okDates.length === 0) {
    card.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }

  card.classList.remove('hidden');
  listEl.innerHTML = '';

  okDates.forEach(d => {
    const gcalUrl = buildGoogleCalendarUrl(ev, d, myRes);
    const item = document.createElement('div');
    item.className = 'calendar-reg-item';
    item.innerHTML = `
      <div class="calendar-reg-date">◯ ${escapeHtml(formatDateLabel(d.date, d.time))}${ev.location ? ' ／ ' + escapeHtml(ev.location) : ''}</div>
      <div class="calendar-reg-btns">
        <a href="${gcalUrl}" target="_blank" rel="noopener" class="btn btn-gcal btn-sm">Googleカレンダーに登録</a>
        <button type="button" class="btn btn-secondary btn-sm btn-dl-ics">iPhone / 標準カレンダー (.ics)</button>
      </div>
    `;
    item.querySelector('.btn-dl-ics').addEventListener('click', () => downloadIcsFile(ev, d, myRes));
    listEl.appendChild(item);
  });
}

/* =====================================================
   LINE送信（ポップアップブロック対策 ＋ Flex Message対応）
===================================================== */
function safeFlexStr(str, fallback = '-') {
  const s = String(str || '').trim();
  return s || fallback;
}

function buildFlexInfoRow(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#607068', size: 'sm', flex: 2 },
      { type: 'text', text: safeFlexStr(value), color: '#1c2420', size: 'sm', weight: 'bold', wrap: true, flex: 5 }
    ]
  };
}

function buildInviteFlexBubble(ev) {
  const guestUrl = buildGuestUrl(ev.id);
  const dateText = ev.mode === 'single' && ev.dates?.[0]
    ? formatDateLabel(ev.dates[0].date, ev.dates[0].time)
    : (ev.dates || []).map(d => formatDateLabel(d.date, d.time)).join('\n');

  const rows = [
    buildFlexInfoRow('日時', dateText),
    buildFlexInfoRow('場所', ev.location || '未定')
  ];
  if (ev.fee) rows.push(buildFlexInfoRow('料金', ev.fee));
  rows.push(buildFlexInfoRow('定員', `${ev.capacity}名`));

  const bodyContents = [
    { type: 'text', text: safeFlexStr(ev.title, '麻雀セット'), weight: 'bold', size: 'lg', wrap: true, color: '#1c2420' },
    { type: 'separator', margin: 'md' },
    { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: rows }
  ];

  if (ev.note) {
    bodyContents.push({ type: 'text', text: safeFlexStr(ev.note), size: 'xs', color: '#5d6d65', wrap: true, margin: 'md' });
  }

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#14532d',
      paddingAll: '12px',
      contents: [{ type: 'text', text: '麻雀セットのお誘い', color: '#ffffff', weight: 'bold', size: 'sm' }]
    },
    body: { type: 'box', layout: 'vertical', contents: bodyContents },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#06c755',
        action: { type: 'uri', label: '出欠を回答する', uri: guestUrl }
      }]
    }
  };
}

function buildInviteFlexMessage(ev) {
  const url = buildGuestUrl(ev.id);
  if (!/^https:\/\//.test(url)) return null;
  return {
    type: 'flex',
    altText: `【麻雀セットのお誘い】${safeFlexStr(ev.title)}`.slice(0, 390),
    contents: buildInviteFlexBubble(ev)
  };
}

function buildBatchInviteFlexMessage(eventsList) {
  if (!eventsList || eventsList.length === 0 || eventsList.length > 10) return null;
  if (!/^https:\/\//.test(buildGuestUrl(eventsList[0].id))) return null;
  return {
    type: 'flex',
    altText: `【麻雀セット日程のお誘い】全${eventsList.length}日程`,
    contents: { type: 'carousel', contents: eventsList.map(ev => buildInviteFlexBubble(ev)) }
  };
}

function buildNoticeFlexMessage(ctx) {
  if (!ctx || !ctx.targetDate) return null;
  const { ev, targetDate, okNames, noticeType } = ctx;
  const isReconfirm = noticeType === 'reconfirm';
  const headerTitle = isReconfirm ? '開催前の再確認' : '開催確定のご案内';
  const headerBg = isReconfirm ? '#14532d' : '#06c755';
  const closingText = isReconfirm
    ? '開催が近づいてきましたので再確認です。変更等があれば早めにご連絡ください！'
    : '開催確定となりました。当日はよろしくお願いします！';

  const rows = [
    buildFlexInfoRow('日付', formatDateOnly(targetDate.date)),
    buildFlexInfoRow('時間', targetDate.time || '未定'),
    buildFlexInfoRow('場所', ev.location || '未定')
  ];
  if (ev.fee) rows.push(buildFlexInfoRow('料金', ev.fee));
  rows.push(buildFlexInfoRow('面子', okNames.length > 0 ? okNames.join('、') : '調整中'));

  const bodyContents = [
    { type: 'text', text: safeFlexStr(ev.title, '麻雀セット'), weight: 'bold', size: 'lg', wrap: true, color: '#1c2420' },
    { type: 'separator', margin: 'md' },
    { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: rows },
    { type: 'text', text: closingText, size: 'sm', color: '#1c2420', wrap: true, margin: 'md' }
  ];

  const guestUrl = buildGuestUrl(ev.id);
  const bubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerBg,
      paddingAll: '12px',
      contents: [{ type: 'text', text: headerTitle, color: '#ffffff', weight: 'bold', size: 'sm' }]
    },
    body: { type: 'box', layout: 'vertical', contents: bodyContents }
  };

  if (/^https:\/\//.test(guestUrl)) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', style: 'secondary', action: { type: 'uri', label: '出欠確認表を開く', uri: guestUrl } }]
    };
  }

  return {
    type: 'flex',
    altText: `【${headerTitle}】${safeFlexStr(ev.title)} ${formatDateOnly(targetDate.date)}`.slice(0, 390),
    contents: bubble
  };
}

async function openLineShare(fallbackText, flexMessage = null) {
  if (
    state.liffReady &&
    typeof liff !== 'undefined' &&
    liff.isApiAvailable &&
    liff.isApiAvailable('shareTargetPicker')
  ) {
    if (flexMessage) {
      try {
        const res = await liff.shareTargetPicker([flexMessage]);
        if (res) showToast('LINEでカード送信しました！');
        return;
      } catch (e) {
        console.warn('Flex送信失敗、テキスト送信へ切替:', e);
      }
    }
    try {
      const res = await liff.shareTargetPicker([{ type: 'text', text: fallbackText }]);
      if (res) showToast('LINEで送信しました！');
      return;
    } catch (e) {
      console.warn('ShareTargetPicker失敗、URL共有へ切替:', e);
    }
  }

  const url = `https://line.me/R/share?text=${encodeURIComponent(fallbackText)}`;
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) window.location.href = url;
}

function buildLineMessage(ev) {
  const guestUrl = buildGuestUrl(ev.id);
  const lines = ['【麻雀セットのお誘い】', `${ev.title}`];

  if (ev.mode === 'single' && ev.dates && ev.dates[0]) {
    lines.push(`日時：${formatDateLabel(ev.dates[0].date, ev.dates[0].time)}`);
  } else if (ev.dates && ev.dates.length > 0) {
    lines.push(`候補日：${ev.dates.map(d => formatDateLabel(d.date, d.time)).join(' / ')}`);
  }

  if (ev.location) lines.push(`場所：${ev.location}`);
  if (ev.fee) lines.push(`セット料金：${ev.fee}`);
  lines.push(`定員：${ev.capacity}名`);
  lines.push('');
  lines.push('▼出欠の回答はこちら');
  lines.push(guestUrl);
  return lines.join('\n');
}

/* =====================================================
   イベント状態判定（フィルタ用）
===================================================== */
function isEventFull(ev) {
  if (!ev.dates || ev.dates.length === 0) return false;
  if (ev.mode === 'single') return (ev.counts?.[ev.dates[0].id]?.ok || 0) >= ev.capacity;
  return ev.dates.some(d => (ev.counts?.[d.id]?.ok || 0) >= ev.capacity);
}

function isEventOpen(ev) {
  if (ev.is_closed) return false;
  if (!ev.dates || ev.dates.length === 0) return true;
  if (ev.mode === 'single') return (ev.counts?.[ev.dates[0].id]?.ok || 0) < ev.capacity;
  return ev.dates.some(d => (ev.counts?.[d.id]?.ok || 0) < ev.capacity);
}

function matchesFilter(ev, filter) {
  if (filter === 'all') return true;
  if (filter === 'closed') return Boolean(ev.is_closed);
  if (filter === 'full') return !ev.is_closed && isEventFull(ev);
  if (filter === 'open') return isEventOpen(ev);
  return true;
}

/* =====================================================
   雀荘名（場所）履歴チップ
===================================================== */
function loadLocationHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_LOCATIONS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveLocationToHistory(loc) {
  const cleaned = String(loc || '').trim();
  if (!cleaned) return;
  const list = loadLocationHistory().filter(item => item !== cleaned);
  list.unshift(cleaned);
  localStorage.setItem(STORAGE_LOCATIONS, JSON.stringify(list.slice(0, 10)));
  renderLocationHistoryChips();
}

function removeLocationFromHistory(loc) {
  localStorage.setItem(STORAGE_LOCATIONS, JSON.stringify(loadLocationHistory().filter(item => item !== loc)));
  renderLocationHistoryChips();
}

function renderLocationHistoryChips() {
  const wrap = $('location-history-chips');
  if (!wrap) return;
  const list = loadLocationHistory();
  if (list.length === 0) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  wrap.innerHTML = '';
  list.forEach(loc => {
    const chip = document.createElement('span');
    chip.className = 'loc-chip';
    chip.innerHTML = `
      <button type="button" class="loc-chip-text">${escapeHtml(loc)}</button>
      <button type="button" class="loc-chip-del" aria-label="履歴削除">×</button>
    `;
    chip.querySelector('.loc-chip-text').addEventListener('click', () => {
      $('ev-location').value = loc;
      showToast(`場所を「${loc}」に設定しました`);
    });
    chip.querySelector('.loc-chip-del').addEventListener('click', () => removeLocationFromHistory(loc));
    wrap.appendChild(chip);
  });
}

/* =====================================================
   開催確定 ＆ 数日前の再確認の案内
===================================================== */
function setNoticeType(type) {
  state.noticeType = type === 'reconfirm' ? 'reconfirm' : 'confirm';
  document.querySelectorAll('.notice-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.noticeType === state.noticeType);
  });
  state.confirmCustomEdited = false;
  refreshNoticeMessageText(true);
}

function setupConfirmSection(ev, counts) {
  const dateWrap = $('confirm-date-wrap');
  const dateSelect = $('confirm-date-select');
  const dates = Array.isArray(ev.dates) ? ev.dates : [];

  if (ev.mode === 'multi' && dates.length > 1) {
    dateWrap.classList.remove('hidden');
    let bestId = dates[0].id;
    let bestOk = -1;
    dates.forEach(d => {
      const okCnt = counts[d.id]?.ok || 0;
      if (okCnt > bestOk) { bestOk = okCnt; bestId = d.id; }
    });
    dateSelect.innerHTML = dates.map(d => {
      const c = counts[d.id] || { ok: 0 };
      const label = `${formatDateLabel(d.date, d.time)}（◯${c.ok}名）`;
      return `<option value="${escapeHtml(d.id)}" ${d.id === bestId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  } else {
    dateWrap.classList.add('hidden');
    dateSelect.innerHTML = '';
  }

  setNoticeType('confirm');
}

function getNoticeContext() {
  if (!state.eventData) return null;
  const { event: ev, responses = [] } = state.eventData;
  const dates = Array.isArray(ev.dates) ? ev.dates : [];
  if (dates.length === 0) return null;

  let targetDate = dates[0];
  if (ev.mode === 'multi' && dates.length > 1) {
    const selectedId = $('confirm-date-select').value;
    targetDate = dates.find(d => d.id === selectedId) || dates[0];
  }
  const dId = targetDate.id;
  const okNames = responses
    .filter(r => r.answers[dId] === 'ok')
    .map(r => r.name);

  return {
    ev,
    targetDate,
    okNames,
    noticeType: state.noticeType
  };
}

function generateNoticeMessage() {
  const ctx = getNoticeContext();
  if (!ctx) return '';
  const { ev, targetDate, okNames, noticeType } = ctx;

  const isReconfirm = noticeType === 'reconfirm';
  const header = isReconfirm ? '【開催前の再確認】' : '【開催確定のご案内】';
  const closing = isReconfirm
    ? '開催が近づいてきましたので再確認です。\n変更などがあれば早めにご連絡ください。よろしくお願いします！'
    : '開催確定となりました。\n当日はよろしくお願いします！';

  const lines = [
    header,
    ev.title,
    '',
    `日付：${formatDateOnly(targetDate.date)}`,
    `時間：${targetDate.time || '未定'}`,
    `場所：${ev.location || '未定'}`
  ];

  if (ev.fee) {
    lines.push(`セット料金：${ev.fee}`);
  }

  lines.push(`面子：${okNames.length > 0 ? okNames.join('、') : '調整中'}`);
  lines.push('', closing);

  return lines.join('\n');
}

function refreshNoticeMessageText(force = false) {
  if (!force && state.confirmCustomEdited) return;
  const ta = $('confirm-message-text');
  if (ta) ta.value = generateNoticeMessage();
}

function getCurrentNoticeMessage() {
  const ta = $('confirm-message-text');
  if (state.confirmCustomEdited && ta && ta.value.trim()) return ta.value;
  return generateNoticeMessage();
}

/* =====================================================
   カスタムカレンダー（単日変更 & 複数日連続タップ追加）
===================================================== */
function openCalendarSingle(currentDateStr, onSelect) {
  const baseStr = /^\d{4}-\d{2}-\d{2}$/.test(currentDateStr || '') ? currentDateStr : getTodayStr(0);
  const [y, m] = baseStr.split('-').map(Number);
  calState.mode = 'single';
  calState.viewYear = y;
  calState.viewMonth = m - 1;
  calState.selectedStr = baseStr;
  calState.selectedSet = new Set();
  calState.existingSet = new Set();
  calState.onSelect = onSelect;
  calState.onConfirmMulti = null;

  $('cal-multi-hint').classList.add('hidden');
  $('cal-confirm-multi').classList.add('hidden');
  renderCalendarGrid();
  $('calendar-modal').classList.remove('hidden');
}

function openCalendarMulti(existingDates, onConfirmMulti) {
  const now = new Date();
  calState.mode = 'multi';
  calState.viewYear = now.getFullYear();
  calState.viewMonth = now.getMonth();
  calState.selectedStr = '';
  calState.selectedSet = new Set();
  calState.existingSet = new Set(existingDates || []);
  calState.onSelect = null;
  calState.onConfirmMulti = onConfirmMulti;

  $('cal-multi-hint').classList.remove('hidden');
  $('cal-confirm-multi').classList.remove('hidden');
  updateMultiConfirmButton();
  renderCalendarGrid();
  $('calendar-modal').classList.remove('hidden');
}

function updateMultiConfirmButton() {
  const btn = $('cal-confirm-multi');
  const cnt = calState.selectedSet.size;
  btn.textContent = cnt > 0 ? `選択した ${cnt} 日をまとめて追加` : '日付をタップして選択してください';
  btn.disabled = cnt === 0;
}

function closeCalendarModal() {
  $('calendar-modal').classList.add('hidden');
}

function renderCalendarGrid() {
  const y = calState.viewYear;
  const m = calState.viewMonth;
  $('cal-month-title').textContent = `${y}年 ${m + 1}月`;

  const grid = $('cal-grid');
  grid.innerHTML = '';

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayStr(0);

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateStr = `${y}-${mm}-${dd}`;
    const dow = (firstDay + d - 1) % 7;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    btn.textContent = String(d);

    if (dow === 0) btn.classList.add('sun');
    if (dow === 6) btn.classList.add('sat');
    if (dateStr < todayStr) btn.classList.add('past');
    if (dateStr === todayStr) btn.classList.add('today');

    if (calState.mode === 'single') {
      if (dateStr === calState.selectedStr) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        if (typeof calState.onSelect === 'function') calState.onSelect(dateStr);
        closeCalendarModal();
      });
    } else {
      if (calState.existingSet.has(dateStr)) btn.classList.add('already-added');
      if (calState.selectedSet.has(dateStr)) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        if (calState.selectedSet.has(dateStr)) {
          calState.selectedSet.delete(dateStr);
          btn.classList.remove('selected');
        } else {
          calState.selectedSet.add(dateStr);
          btn.classList.add('selected');
        }
        updateMultiConfirmButton();
      });
    }
    grid.appendChild(btn);
  }
}

/* =====================================================
   時間プルダウン（1時間＋15分刻み）
===================================================== */
function parseTimeString(timeStr, defaultEndH = '') {
  const m = /^(\d{1,2}):(\d{2})\s*[〜~\-]\s*(?:(\d{1,2}):(\d{2}))?/.exec(String(timeStr || '').trim());
  if (!m) return { sh: '13', sm: '00', eh: defaultEndH, em: '00' };
  const pad = (v) => String(v).padStart(2, '0');
  const clampMin = (v) => (['00', '15', '30', '45'].includes(v) ? v : '00');
  return {
    sh: pad(m[1]),
    sm: clampMin(m[2]),
    eh: m[3] ? pad(m[3]) : '',
    em: m[4] ? clampMin(m[4]) : '00'
  };
}

function buildHourOptions(selectedHour, includeNone = false) {
  let html = '';
  if (includeNone) {
    html += `<option value="" ${selectedHour === '' ? 'selected' : ''}>終了なし</option>`;
  }
  for (let h = 0; h < 24; h++) {
    const val = String(h).padStart(2, '0');
    html += `<option value="${val}" ${selectedHour === val ? 'selected' : ''}>${val}時</option>`;
  }
  return html;
}

function buildMinOptions(selectedMin) {
  return ['00', '15', '30', '45'].map(m =>
    `<option value="${m}" ${selectedMin === m ? 'selected' : ''}>${m}分</option>`
  ).join('');
}

function buildTimeSelectHtml(sh = '13', sm = '00', eh = '19', em = '00') {
  const endDisabled = eh === '' ? 'disabled' : '';
  return `
    <div class="time-select-row">
      <div class="time-pair">
        <select class="sel-start-h" aria-label="開始時">${buildHourOptions(sh, false)}</select>
        <span class="time-colon">:</span>
        <select class="sel-start-m" aria-label="開始分">${buildMinOptions(sm)}</select>
      </div>
      <span class="time-tilde">〜</span>
      <div class="time-pair">
        <select class="sel-end-h" aria-label="終了時">${buildHourOptions(eh, true)}</select>
        <span class="time-colon">:</span>
        <select class="sel-end-m" aria-label="終了分" ${endDisabled}>${buildMinOptions(em)}</select>
      </div>
    </div>
  `;
}

function bindTimeSelectEvents(rowEl) {
  const endH = rowEl.querySelector('.sel-end-h');
  const endM = rowEl.querySelector('.sel-end-m');
  endH.addEventListener('change', () => { endM.disabled = endH.value === ''; });
}

function getLastRowTime(container, defaultEndH = '19') {
  const lastRow = container.lastElementChild;
  if (!lastRow) return { sh: '13', sm: '00', eh: defaultEndH, em: '00' };
  return {
    sh: lastRow.querySelector('.sel-start-h')?.value || '13',
    sm: lastRow.querySelector('.sel-start-m')?.value || '00',
    eh: lastRow.querySelector('.sel-end-h')?.value ?? defaultEndH,
    em: lastRow.querySelector('.sel-end-m')?.value || '00'
  };
}

function readTimeFromRow(rowEl) {
  const sh = rowEl.querySelector('.sel-start-h').value;
  const sm = rowEl.querySelector('.sel-start-m').value;
  const eh = rowEl.querySelector('.sel-end-h').value;
  const em = rowEl.querySelector('.sel-end-m').value;
  const startStr = `${sh}:${sm}`;
  return eh ? `${startStr}〜${eh}:${em}` : `${startStr}〜`;
}

/* =====================================================
   ローカルストレージ操作（幹事履歴 ＆ 招待履歴）
===================================================== */
function loadLocalMyEvents() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_MY_EVENTS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveLocalMyEvents(list) {
  localStorage.setItem(STORAGE_MY_EVENTS, JSON.stringify(list.slice(0, 50)));
}

function addMyEventHistory(item) {
  const list = loadLocalMyEvents().filter(e => e.id !== item.id);
  list.unshift({
    id: item.id,
    admin_key: item.admin_key || '',
    mode: item.mode,
    title: item.title,
    location: item.location,
    fee: item.fee || '',
    capacity: item.capacity,
    dates: item.dates,
    created_at: item.created_at || new Date().toISOString()
  });
  saveLocalMyEvents(list);
}

function removeMyEventHistory(eventId) {
  saveLocalMyEvents(loadLocalMyEvents().filter(e => e.id !== eventId));
  state.dashboardEvents = state.dashboardEvents.filter(e => e.id !== eventId);
}

function loadInvitedEventIds() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_INVITED_EVENTS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveInvitedEventIds(ids) {
  localStorage.setItem(STORAGE_INVITED_EVENTS, JSON.stringify(ids.slice(0, 50)));
}

function addInvitedEventHistory(eventId) {
  if (!eventId) return;
  const list = loadInvitedEventIds().filter(id => id !== eventId);
  list.unshift(eventId);
  saveInvitedEventIds(list);
}

function removeInvitedEventHistory(eventId) {
  saveInvitedEventIds(loadInvitedEventIds().filter(id => id !== eventId));
  state.invitedEvents = state.invitedEvents.filter(e => e.id !== eventId);
}

function loadMyResponseMap() {
  try {
    const obj = JSON.parse(localStorage.getItem(STORAGE_MY_RESPONSES) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function getMyResponseId(eventId) {
  return loadMyResponseMap()[eventId] || '';
}

function setMyResponseId(eventId, responseId) {
  try {
    const map = loadMyResponseMap();
    map[eventId] = responseId;
    localStorage.setItem(STORAGE_MY_RESPONSES, JSON.stringify(map));
  } catch {}
}

/* =====================================================
   GAS API 通信
===================================================== */
async function parseGasResponse(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    const snippet = raw.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`GASからJSON以外の応答が返りました（アクセス権が「全員」でない可能性があります）: ${snippet}`);
  }
}

async function apiGet(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GAS_API_URL}?${qs}`, { method: 'GET', redirect: 'follow' });
  return await parseGasResponse(res);
}

async function apiPost(payload) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(payload)
  });
  return await parseGasResponse(res);
}

/* =====================================================
   LIFF 初期化 & クエリ解析
===================================================== */
async function initLiffIfAvailable() {
  if (!isLiffConfigured() || typeof liff === 'undefined') return;
  try {
    await liff.init({ liffId: LIFF_ID });
    state.liffReady = true;
    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      state.lineProfile = { userId: profile.userId, displayName: profile.displayName };
    }
  } catch (e) {
    console.warn('LIFF初期化スキップ（通常ブラウザ動作）:', e);
  }
  updateLineStatusBar();
}

function updateLineStatusBar() {
  const bar = $('line-status-bar');
  const textEl = $('line-status-text');
  const loginBtn = $('btn-line-login');
  if (!bar) return;

  if (!isLiffConfigured() || !state.liffReady) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  if (state.lineProfile) {
    textEl.textContent = `LINE連携中：${state.lineProfile.displayName} さん（イベント同期・自動通知ON）`;
    loginBtn.classList.add('hidden');
  } else {
    textEl.textContent = 'LINEログインすると作成・招待イベントの自動同期が使えます';
    loginBtn.classList.remove('hidden');
  }
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  let id = params.get('id') || '';
  let key = params.get('key') || '';
  let preview = params.get('preview') === '1';
  let view = params.get('view') || '';

  if (!id && params.get('liff.state')) {
    const rawState = params.get('liff.state');
    const qIdx = rawState.indexOf('?');
    if (qIdx !== -1) {
      const sub = new URLSearchParams(rawState.slice(qIdx + 1));
      id = sub.get('id') || '';
      key = sub.get('key') || key;
      preview = preview || sub.get('preview') === '1';
      view = sub.get('view') || view;
    }
  }
  return { id, key, preview, view };
}

/* =====================================================
   画面切替・初期化
===================================================== */
function hideAllViews() {
  ['view-home', 'view-create', 'view-guest', 'view-admin', 'view-error'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
}

function setHeaderButtons(mode) {
  const homeBtn = $('btn-go-home');
  const createBtn = $('btn-go-create');
  if (homeBtn) homeBtn.classList.toggle('hidden', mode === 'home');
  if (createBtn) createBtn.classList.toggle('hidden', mode === 'create');
}

function showErrorView(msg) {
  hideAllViews();
  setHeaderButtons('error');
  const errEl = $('error-message');
  const viewEl = $('view-error');
  if (errEl) errEl.textContent = msg;
  if (viewEl) viewEl.classList.remove('hidden');
}

async function init() {
  try {
    bindStaticEvents();
    showLoading('読み込み中...');
    await initLiffIfAvailable();
    hideLoading();

    const { id, key, preview, view } = parseUrlParams();
    if (id) {
      state.currentEventId = id;
      state.currentAdminKey = key;
      state.forcePreview = preview;
      await loadEventAndRender();
    } else if (view === 'create') {
      openCreateView(false);
    } else {
      await openHomeView(false);
    }
  } catch (err) {
    hideLoading();
    console.error('初期化エラー:', err);
    showErrorView(`画面の初期化に失敗しました。\n詳細: ${err.message}\n\n※ブラウザの強制再読み込み（Ctrl+Shift+R）をお試しください。`);
  }
}

function bindStaticEvents() {
  on('btn-go-home', 'click', () => { window.location.href = getBaseUrl(); });
  on('btn-go-create', 'click', () => {
    if (state.currentEventId) {
      window.location.href = `${getBaseUrl()}?view=create`;
    } else {
      openCreateView(true);
    }
  });

  on('btn-home-refresh', 'click', () => loadDashboard());
  on('btn-import-admin-url', 'click', handleImportAdminUrl);

  document.querySelectorAll('#dashboard-filter-bar .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.filter;
      document.querySelectorAll('#dashboard-filter-bar .filter-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      renderDashboardAll();
    });
  });

  on('btn-create-back-home', 'click', () => openHomeView(true));
  on('btn-result-go-home', 'click', () => openHomeView(true));
  on('btn-admin-back-home', 'click', () => { window.location.href = getBaseUrl(); });
  on('btn-guest-go-home', 'click', () => { window.location.href = getBaseUrl(); });

  // カレンダーモーダル
  on('cal-prev', 'click', () => {
    calState.viewMonth--;
    if (calState.viewMonth < 0) { calState.viewMonth = 11; calState.viewYear--; }
    renderCalendarGrid();
  });
  on('cal-next', 'click', () => {
    calState.viewMonth++;
    if (calState.viewMonth > 11) { calState.viewMonth = 0; calState.viewYear++; }
    renderCalendarGrid();
  });
  on('cal-today', 'click', () => {
    const now = new Date();
    calState.viewYear = now.getFullYear();
    calState.viewMonth = now.getMonth();
    renderCalendarGrid();
  });
  on('cal-confirm-multi', 'click', () => {
    if (typeof calState.onConfirmMulti === 'function') {
      calState.onConfirmMulti(Array.from(calState.selectedSet).sort());
    }
    closeCalendarModal();
  });
  on('cal-close', 'click', closeCalendarModal);
  on('calendar-modal', 'click', (e) => {
    if (e.target === $('calendar-modal')) closeCalendarModal();
  });

  on('btn-line-login', 'click', () => {
    if (state.liffReady && typeof liff !== 'undefined') {
      liff.login({ redirectUri: window.location.href });
    }
  });

  // 新規作成フォーム
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setCreateMode(btn.dataset.mode));
  });

  document.querySelectorAll('.cap-chip').forEach(chip => {
    chip.addEventListener('click', () => { $('ev-capacity').value = chip.dataset.cap; });
  });

  on('btn-add-single-row', 'click', () => {
    const t = getLastRowTime($('single-rows'), '19');
    addSingleDateRow('', t.sh, t.sm, t.eh, t.em);
  });
  on('btn-multi-pick-single', 'click', () => openMultiPickForContainer('single'));

  on('btn-add-multi-row', 'click', () => {
    const t = getLastRowTime($('multi-rows'), '');
    addMultiDateRow('', t.sh, t.sm, t.eh, t.em);
  });
  on('btn-multi-pick-multi', 'click', () => openMultiPickForContainer('multi'));

  on('create-form', 'submit', handleCreateSubmit);
  on('btn-batch-line-share', 'click', handleBatchLineShare);

  // ゲスト画面
  on('btn-guest-refresh', 'click', () => loadEventAndRender());
  on('guest-form', 'submit', handleGuestSubmit);

  // 幹事詳細画面
  on('btn-admin-refresh', 'click', () => loadEventAndRender());
  on('btn-admin-line-share', 'click', handleAdminInviteSend);
  on('btn-copy-guest-url', 'click', () => copyToClipboard(buildGuestUrl(state.currentEventId), '招待用URLをコピーしました'));
  on('btn-copy-admin-url', 'click', () => copyToClipboard(buildAdminUrl(state.currentEventId, state.currentAdminKey), '幹事用URLをコピーしました'));
  on('btn-open-guest-preview', 'click', () => window.open(buildPreviewUrl(state.currentEventId), '_blank', 'noopener'));

  // 開催確定・数日前の再確認タブ
  document.querySelectorAll('.notice-tab').forEach(btn => {
    btn.addEventListener('click', () => setNoticeType(btn.dataset.noticeType));
  });

  on('confirm-date-select', 'change', () => {
    state.confirmCustomEdited = false;
    refreshNoticeMessageText(true);
  });

  on('confirm-message-text', 'input', () => { state.confirmCustomEdited = true; });

  on('btn-confirm-preview-toggle', 'click', () => {
    const wrap = $('confirm-preview-wrap');
    const isHidden = wrap.classList.toggle('hidden');
    $('btn-confirm-preview-toggle').textContent = isHidden ? '文面を確認・編集' : 'プレビューを閉じる';
    if (!isHidden) refreshNoticeMessageText();
  });

  on('btn-confirm-reset', 'click', () => {
    state.confirmCustomEdited = false;
    refreshNoticeMessageText(true);
    showToast('例文に戻しました');
  });

  on('btn-confirm-line-share', 'click', () => {
    const msg = getCurrentNoticeMessage();
    if (!msg) return;
    const flexMsg = !state.confirmCustomEdited ? buildNoticeFlexMessage(getNoticeContext()) : null;
    openLineShare(msg, flexMsg);
  });

  on('btn-confirm-copy', 'click', () => {
    const msg = getCurrentNoticeMessage();
    if (msg) copyToClipboard(msg, '案内文をコピーしました');
  });

  // 詳細画面の日時編集
  on('btn-admin-add-date', 'click', () => {
    const container = $('admin-edit-dates-rows');
    const t = getLastRowTime(container, '');
    addAdminEditDateRow({ id: '', date: getTodayStr(container.children.length + 1), time: '' }, true, t);
  });
  on('btn-admin-multi-pick', 'click', () => {
    const container = $('admin-edit-dates-rows');
    const existingDates = Array.from(container.querySelectorAll('.inp-date')).map(el => el.value);
    const existingSet = new Set(existingDates);
    const t = getLastRowTime(container, '');
    openCalendarMulti(existingDates, (pickedDates) => {
      let added = 0;
      pickedDates.forEach(dateStr => {
        if (existingSet.has(dateStr)) return;
        addAdminEditDateRow({ id: '', date: dateStr, time: '' }, true, t);
        existingSet.add(dateStr);
        added++;
      });
      showToast(added > 0 ? `${added}日分の候補を追加しました` : '選択した日付は既に追加済みです');
    });
  });

  on('toggle-manual-close', 'change', handleManualCloseToggle);
  on('btn-admin-save-settings', 'click', handleAdminSaveSettings);
  on('btn-admin-delete-event', 'click', () => {
    handleDeleteEventByIds(state.currentEventId, state.currentAdminKey, state.eventData?.event?.title || '', true);
  });
}

function setCreateMode(mode) {
  state.createMode = mode === 'multi' ? 'multi' : 'single';
  document.querySelectorAll('.mode-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.createMode);
  });
  $('single-dates-area').classList.toggle('hidden', state.createMode !== 'single');
  $('multi-dates-area').classList.toggle('hidden', state.createMode !== 'multi');
}

/* =====================================================
   ビュー0：トップ画面（幹事イベント ＋ 招待イベント一覧）
===================================================== */
async function openHomeView(updateHistory = false) {
  state.currentEventId = null;
  state.currentAdminKey = null;
  if (updateHistory) window.history.replaceState({}, '', getBaseUrl());
  hideAllViews();
  setHeaderButtons('home');
  $('view-home').classList.remove('hidden');
  await loadDashboard();
}

async function handleImportAdminUrl() {
  const raw = ($('inp-import-admin-url')?.value || '').trim();
  if (!raw) { showToast('幹事用URLを貼り付けてください'); return; }

  let id = '';
  let key = '';
  try {
    const u = new URL(raw);
    id = u.searchParams.get('id') || '';
    key = u.searchParams.get('key') || '';
  } catch {
    const qIdx = raw.indexOf('?');
    if (qIdx !== -1) {
      const sub = new URLSearchParams(raw.slice(qIdx + 1));
      id = sub.get('id') || '';
      key = sub.get('key') || '';
    }
  }

  if (!id || !key) {
    showToast('URLに id と key が含まれていません（幹事用URLを貼ってください）');
    return;
  }

  showLoading('幹事URLを確認中...');
  try {
    const res = await apiGet({ action: 'get_event', id, key });
    if (!res.ok || !res.is_admin) {
      alert('このURLでは幹事権限を確認できませんでした（削除済みかURLが誤っています）。');
      return;
    }
    addMyEventHistory({ ...res.event, admin_key: key });
    $('inp-import-admin-url').value = '';
    showToast(`「${res.event.title}」を一覧に追加しました`);
    await loadDashboard();
  } catch (err) {
    alert('取り込みエラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function fetchDashboardWithFallback(bodyObj) {
  try {
    const res = await apiPost(bodyObj);
    if (res && res.ok) return res;
    throw new Error(res?.error || 'POST取得失敗');
  } catch (postErr) {
    try {
      const compactPayload = JSON.stringify({
        line_uid: bodyObj.line_uid,
        local_items: (bodyObj.local_items || []).slice(0, 25),
        invited_ids: (bodyObj.invited_ids || []).slice(0, 25),
        my_response_map: bodyObj.my_response_map || {}
      });
      const getRes = await apiGet({
        action: 'list_admin_dashboard',
        payload: compactPayload
      });
      if (getRes && getRes.ok) return getRes;
      throw new Error(getRes?.error || 'GET取得失敗');
    } catch (getErr) {
      throw new Error(`POST: ${postErr.message} / GET: ${getErr.message}`);
    }
  }
}

async function loadDashboard() {
  const errBanner = $('dashboard-error-banner');
  const errText = $('dashboard-error-text');
  if (errBanner) errBanner.classList.add('hidden');

  const localEvents = loadLocalMyEvents();
  const localItems = localEvents.map(e => ({ id: e.id, admin_key: e.admin_key }));
  const invitedIds = loadInvitedEventIds();
  const myResponseMap = loadMyResponseMap();

  if (!state.lineProfile && localItems.length === 0 && invitedIds.length === 0 && Object.keys(myResponseMap).length === 0) {
    state.dashboardEvents = [];
    state.invitedEvents = [];
    renderDashboardAll();
    return;
  }

  showLoading('イベント一覧を取得中...');
  try {
    const res = await fetchDashboardWithFallback({
      action: 'list_admin_dashboard',
      line_uid: state.lineProfile?.userId || '',
      local_items: localItems,
      invited_ids: invitedIds,
      my_response_map: myResponseMap
    });

    if (Array.isArray(res.missing_ids) && res.missing_ids.length > 0) {
      const missingSet = new Set(res.missing_ids);
      saveLocalMyEvents(localEvents.filter(e => !missingSet.has(e.id)));
    }
    if (Array.isArray(res.missing_invited_ids) && res.missing_invited_ids.length > 0) {
      const missingInvSet = new Set(res.missing_invited_ids);
      saveInvitedEventIds(invitedIds.filter(id => !missingInvSet.has(id)));
    }

    state.dashboardEvents = Array.isArray(res.events) ? res.events : [];
    state.invitedEvents = Array.isArray(res.invited_events) ? res.invited_events : [];
    renderDashboardAll();
  } catch (err) {
    if (errBanner && errText) {
      errText.textContent = `詳細：${err.message}`;
      errBanner.classList.remove('hidden');
    }
    renderDashboardAll();
  } finally {
    hideLoading();
  }
}

function updateFilterCounts() {
  const allCombined = [...state.dashboardEvents, ...state.invitedEvents];
  const counts = {
    all: allCombined.length,
    open: allCombined.filter(ev => matchesFilter(ev, 'open')).length,
    full: allCombined.filter(ev => matchesFilter(ev, 'full')).length,
    closed: allCombined.filter(ev => matchesFilter(ev, 'closed')).length
  };
  const labels = { all: 'すべて', open: '募集中', full: '満員', closed: '締切中' };
  document.querySelectorAll('#dashboard-filter-bar .filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    btn.textContent = `${labels[f]} (${counts[f]})`;
  });
}

function renderDashboardAll() {
  updateFilterCounts();
  renderInvitedDashboardList();
  renderAdminDashboardList();
}

function getStatusBadgeHtml(ev) {
  if (ev.is_closed) return '<span class="badge badge-closed">締切中</span>';
  if (ev.mode === 'single') {
    return isEventFull(ev)
      ? '<span class="badge badge-full">満員</span>'
      : '<span class="badge badge-open">募集中</span>';
  }
  return isEventFull(ev)
    ? '<span class="badge badge-full">満員日程あり</span>'
    : '<span class="badge badge-open">日程調整中</span>';
}

function renderInvitedDashboardList() {
  const card = $('home-invited-card');
  const badge = $('invited-count-badge');
  const wrap = $('invited-table-wrap');
  const filterEmpty = $('invited-filter-empty');
  const tbody = $('invited-list');

  if (!state.invitedEvents || state.invitedEvents.length === 0) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const filtered = state.invitedEvents.filter(ev => matchesFilter(ev, state.activeFilter));
  badge.textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    wrap.classList.add('hidden');
    filterEmpty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  filterEmpty.classList.add('hidden');
  tbody.innerHTML = '';

  const markMap = {
    ok: { text: '◯ 参加', cls: 'ok' },
    maybe: { text: '△ 保留', cls: 'maybe' },
    ng: { text: '✕ 不参加', cls: 'ng' }
  };

  filtered.forEach(ev => {
    const guestUrl = `${getBaseUrl()}?id=${encodeURIComponent(ev.id)}`;
    const tr = document.createElement('tr');
    const dates = Array.isArray(ev.dates) ? ev.dates : [];
    const dateLine = ev.mode === 'single' && dates[0]
      ? formatDateLabel(dates[0].date, dates[0].time)
      : `候補日 ${dates.length}日程`;

    const infoHtml = `
      <div class="hero-badges" style="margin-bottom:4px;">
        ${getStatusBadgeHtml(ev)}
        ${ev.admin_name ? `<span class="badge">幹事：${escapeHtml(ev.admin_name)}</span>` : ''}
      </div>
      <div class="dash-ev-title">${escapeHtml(ev.title)}</div>
      <div class="dash-ev-meta">
        <span>日時：${escapeHtml(dateLine)}</span>
        <span>場所：${escapeHtml(ev.location || '未定')}</span>
        ${ev.fee ? `<span>料金：${escapeHtml(ev.fee)}</span>` : ''}
      </div>
    `;

    let countHtml = '';
    let myAnsHtml = '';

    if (ev.mode === 'single' && dates[0]) {
      const dId = dates[0].id;
      const c = ev.counts?.[dId] || { ok: 0, maybe: 0, ng: 0 };
      const rem = Math.max(0, ev.capacity - c.ok);
      countHtml = `
        <div class="dash-count-main">参加 ${c.ok} / ${ev.capacity}名</div>
        <div class="dash-count-sub">
          <span>${rem === 0 ? '満員' : '残り' + rem + '枠'}</span>
          ${c.maybe > 0 ? `<span>保留 ${c.maybe}</span>` : ''}
        </div>
      `;
      const m = markMap[ev.my_answers?.[dId]];
      myAnsHtml = m ? `<span class="member-chip ${m.cls}">${m.text}</span>` : '<span class="member-chip wait">未回答</span>';
    } else {
      countHtml = `
        <div class="dash-count-main">回答 ${ev.total_respondents}名</div>
        <div class="dash-count-sub"><span>定員 ${ev.capacity}名</span></div>
      `;
      myAnsHtml = dates.map(d => {
        const c = ev.counts?.[d.id] || { ok: 0, maybe: 0 };
        const m = markMap[ev.my_answers?.[d.id]];
        const chipHtml = m ? `<span class="member-chip ${m.cls}">${m.text}</span>` : '<span class="member-chip wait">未回答</span>';
        return `
          <div class="dash-multi-row">
            <div class="dash-multi-head">
              <span>${escapeHtml(formatDateLabel(d.date, d.time))}</span>
              <span>◯${c.ok}/${ev.capacity}名</span>
            </div>
            <div>${chipHtml}</div>
          </div>
        `;
      }).join('');
    }

    tr.innerHTML = `
      <td class="col-info">${infoHtml}</td>
      <td class="col-count">${countHtml}</td>
      <td class="col-members">${myAnsHtml}</td>
      <td class="col-action">
        <div class="dash-action-cell">
          <a href="${guestUrl}" class="btn btn-primary btn-sm">${ev.my_answers ? '確認・変更' : '回答する'}</a>
          <button type="button" class="btn btn-secondary btn-sm btn-inv-hide">非表示</button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-inv-hide').addEventListener('click', () => {
      removeInvitedEventHistory(ev.id);
      renderDashboardAll();
      showToast('招待一覧から非表示にしました');
    });

    tbody.appendChild(tr);
  });
}

function renderAdminDashboardList() {
  const allList = state.dashboardEvents;
  const badge = $('admin-count-badge');
  const emptyBox = $('dashboard-empty');
  const filterEmpty = $('dashboard-filter-empty');
  const tableWrap = $('dashboard-table-wrap');
  const tbody = $('dashboard-list');

  if (!allList || allList.length === 0) {
    badge.textContent = '0件';
    emptyBox.classList.remove('hidden');
    filterEmpty.classList.add('hidden');
    tableWrap.classList.add('hidden');
    tbody.innerHTML = '';
    return;
  }

  emptyBox.classList.add('hidden');
  const filtered = allList.filter(ev => matchesFilter(ev, state.activeFilter));
  badge.textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    filterEmpty.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    tbody.innerHTML = '';
    return;
  }

  filterEmpty.classList.add('hidden');
  tableWrap.classList.remove('hidden');
  tbody.innerHTML = '';

  filtered.forEach(ev => {
    const adminUrl = buildAdminUrl(ev.id, ev.admin_key);
    const tr = document.createElement('tr');
    const dates = Array.isArray(ev.dates) ? ev.dates : [];
    const dateLine = ev.mode === 'single' && dates[0]
      ? formatDateLabel(dates[0].date, dates[0].time)
      : `候補日 ${dates.length}日程`;

    const infoHtml = `
      <div class="hero-badges" style="margin-bottom:4px;">
        ${getStatusBadgeHtml(ev)}
        ${ev.invited_count > 0 ? '<span class="badge">招待送信済</span>' : ''}
      </div>
      <div class="dash-ev-title">${escapeHtml(ev.title)}</div>
      <div class="dash-ev-meta">
        <span>日時：${escapeHtml(dateLine)}</span>
        <span>場所：${escapeHtml(ev.location || '未定')}</span>
        ${ev.fee ? `<span>料金：${escapeHtml(ev.fee)}</span>` : ''}
      </div>
    `;

    let countHtml = '';
    let membersHtml = '';

    if (ev.mode === 'single' && dates[0]) {
      const dId = dates[0].id;
      const c = ev.counts?.[dId] || { ok: 0, maybe: 0, ng: 0 };
      const m = ev.date_members?.[dId] || { ok: [], maybe: [], ng: [] };
      const rem = Math.max(0, ev.capacity - c.ok);

      countHtml = `
        <div class="dash-count-main">参加 ${c.ok} / ${ev.capacity}名</div>
        <div class="dash-count-sub">
          <span>${rem === 0 ? '満員' : '残り' + rem + '枠'}</span>
          ${c.maybe > 0 ? `<span>保留 ${c.maybe}</span>` : ''}
          ${c.ng > 0 ? `<span>不参加 ${c.ng}</span>` : ''}
        </div>
      `;

      const chips = [];
      m.ok.forEach(name => chips.push(`<span class="member-chip ok">◯ ${escapeHtml(name)}</span>`));
      m.maybe.forEach(name => chips.push(`<span class="member-chip maybe">△ ${escapeHtml(name)}</span>`));
      membersHtml = chips.length > 0
        ? `<div class="member-chip-list">${chips.join('')}</div>`
        : '<span class="member-none">参加者はまだいません</span>';
    } else {
      const bestOk = dates.reduce((max, d) => Math.max(max, ev.counts?.[d.id]?.ok || 0), 0);
      countHtml = `
        <div class="dash-count-main">回答 ${ev.total_respondents}名</div>
        <div class="dash-count-sub"><span>最多◯ ${bestOk}/${ev.capacity}名</span></div>
      `;

      membersHtml = dates.map(d => {
        const c = ev.counts?.[d.id] || { ok: 0, maybe: 0 };
        const m = ev.date_members?.[d.id] || { ok: [], maybe: [] };
        const chips = [];
        m.ok.forEach(name => chips.push(`<span class="member-chip ok">◯ ${escapeHtml(name)}</span>`));
        m.maybe.forEach(name => chips.push(`<span class="member-chip maybe">△ ${escapeHtml(name)}</span>`));
        return `
          <div class="dash-multi-row">
            <div class="dash-multi-head">
              <span>${escapeHtml(formatDateLabel(d.date, d.time))}</span>
              <span>◯${c.ok}/${ev.capacity}名${c.maybe > 0 ? '・△' + c.maybe : ''}</span>
            </div>
            <div class="member-chip-list">
              ${chips.length > 0 ? chips.join('') : '<span class="member-none">参加者なし</span>'}
            </div>
          </div>
        `;
      }).join('');
    }

    tr.innerHTML = `
      <td class="col-info">${infoHtml}</td>
      <td class="col-count">${countHtml}</td>
      <td class="col-members">${membersHtml}</td>
      <td class="col-action">
        <div class="dash-action-cell">
          <a href="${adminUrl}" class="btn btn-primary btn-sm">詳細</a>
          <button type="button" class="btn btn-danger-outline btn-sm btn-dash-del">削除</button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-dash-del').addEventListener('click', () => {
      handleDeleteEventByIds(ev.id, ev.admin_key, ev.title, false);
    });

    tbody.appendChild(tr);
  });
}

/* =====================================================
   ビュー1：イベント新規作成画面
===================================================== */
function openCreateView(updateHistory = false) {
  state.currentEventId = null;
  state.currentAdminKey = null;
  if (updateHistory) window.history.replaceState({}, '', `${getBaseUrl()}?view=create`);

  hideAllViews();
  setHeaderButtons('create');
  $('view-create').classList.remove('hidden');
  $('create-result').classList.add('hidden');
  $('create-form').reset();
  $('ev-capacity').value = '4';
  $('ev-auto-close').checked = true;
  setCreateMode('single');

  renderLocationHistoryChips();

  $('single-rows').innerHTML = '';
  $('multi-rows').innerHTML = '';
  addSingleDateRow(getTodayStr(1), '13', '00', '19', '00');
  addMultiDateRow(getTodayStr(1), '13', '00', '', '00');
  addMultiDateRow(getTodayStr(2), '13', '00', '', '00');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMultiPickForContainer(mode) {
  const container = mode === 'single' ? $('single-rows') : $('multi-rows');
  const existingDates = Array.from(container.querySelectorAll('.inp-date')).map(el => el.value);
  const existingSet = new Set(existingDates);
  const timeDefaults = getLastRowTime(container, mode === 'single' ? '19' : '');

  openCalendarMulti(existingDates, (pickedDates) => {
    let added = 0;
    pickedDates.forEach(dateStr => {
      if (existingSet.has(dateStr)) return;
      if (mode === 'single') {
        addSingleDateRow(dateStr, timeDefaults.sh, timeDefaults.sm, timeDefaults.eh, timeDefaults.em);
      } else {
        addMultiDateRow(dateStr, timeDefaults.sh, timeDefaults.sm, timeDefaults.eh, timeDefaults.em);
      }
      existingSet.add(dateStr);
      added++;
    });
    showToast(added > 0 ? `${added}日分の日程を追加しました` : '選択した日付は既に追加済みです');
  });
}

function addSingleDateRow(defaultDate = '', sh = '13', sm = '00', eh = '19', em = '00') {
  const container = $('single-rows');
  const dateVal = defaultDate || getTodayStr(container.children.length + 1);
  const idx = container.children.length + 1;

  const div = document.createElement('div');
  div.className = 'date-row-card';
  div.innerHTML = `
    <div class="date-row-head">
      <span class="row-num">日程 #${idx}</span>
      <button type="button" class="btn-remove-row">削除</button>
    </div>
    <input type="hidden" class="inp-date" value="${escapeHtml(dateVal)}" />
    <button type="button" class="date-picker-btn">
      <span class="date-picker-text">${escapeHtml(formatDateButtonLabel(dateVal))}</span>
      <span class="cal-icon">カレンダー変更</span>
    </button>
    ${buildTimeSelectHtml(sh, sm, eh, em)}
    <div class="date-row-loc">
      <input type="text" class="inp-row-location" placeholder="場所をこの日だけ変更する場合に入力（空欄なら上の場所を適用）" />
    </div>
  `;

  bindDatePickerToRow(div);
  bindTimeSelectEvents(div);
  div.querySelector('.btn-remove-row').addEventListener('click', () => {
    if (container.children.length <= 1) { showToast('日程は最低1件必要です'); return; }
    div.remove();
    renumberRows(container, '日程');
  });

  container.appendChild(div);
  renumberRows(container, '日程');
}

function addMultiDateRow(defaultDate = '', sh = '13', sm = '00', eh = '', em = '00') {
  const container = $('multi-rows');
  const dateVal = defaultDate || getTodayStr(container.children.length + 1);
  const idx = container.children.length + 1;

  const div = document.createElement('div');
  div.className = 'date-row-card';
  div.innerHTML = `
    <div class="date-row-head">
      <span class="row-num">候補 #${idx}</span>
      <button type="button" class="btn-remove-row">削除</button>
    </div>
    <input type="hidden" class="inp-date" value="${escapeHtml(dateVal)}" />
    <button type="button" class="date-picker-btn">
      <span class="date-picker-text">${escapeHtml(formatDateButtonLabel(dateVal))}</span>
      <span class="cal-icon">カレンダー変更</span>
    </button>
    ${buildTimeSelectHtml(sh, sm, eh, em)}
  `;

  bindDatePickerToRow(div);
  bindTimeSelectEvents(div);
  div.querySelector('.btn-remove-row').addEventListener('click', () => {
    if (container.children.length <= 1) { showToast('候補日は最低1件必要です'); return; }
    div.remove();
    renumberRows(container, '候補');
  });

  container.appendChild(div);
  renumberRows(container, '候補');
}

function bindDatePickerToRow(rowEl) {
  const hiddenInp = rowEl.querySelector('.inp-date');
  const btn = rowEl.querySelector('.date-picker-btn');
  const textSpan = rowEl.querySelector('.date-picker-text');
  btn.addEventListener('click', () => {
    openCalendarSingle(hiddenInp.value, (pickedStr) => {
      hiddenInp.value = pickedStr;
      textSpan.textContent = formatDateButtonLabel(pickedStr);
    });
  });
}

function renumberRows(container, prefix) {
  Array.from(container.children).forEach((row, i) => {
    const label = row.querySelector('.row-num');
    if (label) label.textContent = `${prefix} #${i + 1}`;
  });
}

async function handleCreateSubmit(e) {
  e.preventDefault();
  const baseTitle = $('ev-title').value.trim();
  const baseLocation = $('ev-location').value.trim();
  const fee = ($('ev-fee')?.value || '').trim();
  const capacity = Number($('ev-capacity').value) || 4;
  const autoClose = $('ev-auto-close').checked;
  const notifyMode = $('ev-notify-mode') ? $('ev-notify-mode').value : 'all';
  const note = $('ev-note').value.trim();

  if (!baseTitle) { showToast('イベント名を入力してください'); return; }

  const eventsPayload = [];
  const locationsToSave = [];
  if (baseLocation) locationsToSave.push(baseLocation);

  if (state.createMode === 'single') {
    const rows = Array.from($('single-rows').children);
    rows.forEach(row => {
      const date = row.querySelector('.inp-date').value.trim();
      const time = readTimeFromRow(row);
      const rowLoc = row.querySelector('.inp-row-location').value.trim();
      if (!date) return;
      if (rowLoc) locationsToSave.push(rowLoc);
      const titleSuffix = rows.length > 1 ? ` (${formatDateOnly(date)})` : '';
      eventsPayload.push({
        mode: 'single',
        title: baseTitle + titleSuffix,
        location: rowLoc || baseLocation,
        fee,
        capacity,
        note,
        auto_close: autoClose,
        notify_mode: notifyMode,
        dates: [{ date, time }]
      });
    });
  } else {
    const rows = Array.from($('multi-rows').children);
    const dates = rows.map(row => ({
      date: row.querySelector('.inp-date').value.trim(),
      time: readTimeFromRow(row)
    })).filter(d => d.date);

    if (dates.length === 0) { showToast('候補日を1件以上選択してください'); return; }
    eventsPayload.push({
      mode: 'multi',
      title: baseTitle,
      location: baseLocation,
      fee,
      capacity,
      note,
      auto_close: autoClose,
      notify_mode: notifyMode,
      dates
    });
  }

  if (eventsPayload.length === 0) { showToast('有効な日程を選択してください'); return; }

  showLoading('イベントを作成中...');
  try {
    const res = await apiPost({
      action: 'create_events',
      admin_line_id: state.lineProfile?.userId || '',
      admin_name: state.lineProfile?.displayName || '',
      events: eventsPayload
    });
    if (!res.ok) throw new Error(res.error || '作成に失敗しました');

    locationsToSave.forEach(loc => saveLocationToHistory(loc));
    state.lastCreated = (res.created || []).map(ev => ({ ...ev, _sentLog: [] }));
    state.lastCreated.forEach(ev => addMyEventHistory(ev));

    renderCreatedResults(state.lastCreated);
    showToast(`${state.lastCreated.length}件のイベントを作成しました`);
    $('create-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    alert('作成エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

function recordInviteLogBackground(eventId, adminKey, historyArr) {
  apiPost({
    action: 'admin_update',
    event_id: eventId,
    admin_key: adminKey || '',
    line_user_id: state.lineProfile?.userId || '',
    updates: { invited_memo: historyArr }
  }).catch(err => console.warn('送信履歴保存スキップ:', err));
}

function renderCreatedResults(createdList) {
  const wrap = $('create-result');
  const listEl = $('created-list');
  const batchWrap = $('batch-line-wrap');

  wrap.classList.remove('hidden');
  batchWrap.classList.toggle('hidden', createdList.length <= 1);

  listEl.innerHTML = '';
  createdList.forEach(ev => {
    const guestUrl = buildGuestUrl(ev.id);
    const adminUrl = buildAdminUrl(ev.id, ev.admin_key);
    const dateDesc = ev.mode === 'single' && ev.dates?.[0]
      ? formatDateLabel(ev.dates[0].date, ev.dates[0].time)
      : `候補日 ${(ev.dates || []).length}件`;

    const card = document.createElement('div');
    card.className = 'created-item';
    card.innerHTML = `
      <div class="created-item-title">${escapeHtml(ev.title)}</div>
      <div class="created-item-sub">
        ${escapeHtml(dateDesc)}${ev.location ? ' ／ ' + escapeHtml(ev.location) : ''}${ev.fee ? ' ／ ' + escapeHtml(ev.fee) : ''} ／ 定員${ev.capacity}名
      </div>
      <div class="created-actions">
        <a href="${adminUrl}" class="btn btn-primary btn-sm">詳細を開く</a>
        <button type="button" class="btn btn-line btn-sm btn-send-line">LINEで招待を送る</button>
        <button type="button" class="btn btn-secondary btn-sm btn-copy-guest">招待URLコピー</button>
      </div>
    `;
    card.querySelector('.btn-send-line').addEventListener('click', () => {
      if (ev._sentLog.length > 0) {
        const lastTime = formatShortTimestamp(ev._sentLog[0].sent_at);
        const ok = confirm(`このイベントはすでに招待を送信済みです（前回：${lastTime}）。\n同じ人に重複して送信していませんか？\n\n続けてLINE送信画面を開きますか？`);
        if (!ok) return;
      }
      ev._sentLog.unshift({ sent_at: new Date().toISOString() });
      recordInviteLogBackground(ev.id, ev.admin_key, ev._sentLog);
      openLineShare(buildLineMessage(ev), buildInviteFlexMessage(ev));
    });
    card.querySelector('.btn-copy-guest').addEventListener('click', () => {
      copyToClipboard(guestUrl, '招待URLをコピーしました');
    });
    listEl.appendChild(card);
  });
}

function handleBatchLineShare() {
  if (!state.lastCreated.length) return;
  const anySent = state.lastCreated.some(ev => ev._sentLog && ev._sentLog.length > 0);
  if (anySent) {
    const ok = confirm('すでに招待を送信済みの日程が含まれています。\n同じ人に重複して送信していませんか？\n\n続けてLINE送信画面を開きますか？');
    if (!ok) return;
  }

  const nowIso = new Date().toISOString();
  const lines = ['【麻雀セット日程のお誘い】', '都合の合う日程から回答お願いします！', ''];
  state.lastCreated.forEach(ev => {
    ev._sentLog.unshift({ sent_at: nowIso });
    recordInviteLogBackground(ev.id, ev.admin_key, ev._sentLog);
    const dt = ev.dates?.[0] ? formatDateLabel(ev.dates[0].date, ev.dates[0].time) : '';
    lines.push(`■ ${ev.title}`);
    if (dt) lines.push(`日時：${dt}`);
    if (ev.location) lines.push(`場所：${ev.location}`);
    if (ev.fee) lines.push(`セット料金：${ev.fee}`);
    lines.push(buildGuestUrl(ev.id));
    lines.push('');
  });
  const flexCarousel = buildBatchInviteFlexMessage(state.lastCreated);
  openLineShare(lines.join('\n'), flexCarousel);
}

async function handleDeleteEventByIds(eventId, adminKey, title, redirectAfter) {
  const label = title ? `「${title}」` : 'このイベント';
  if (!confirm(`${label}とすべての回答データをスプレッドシートから完全に削除します。よろしいですか？`)) return;

  showLoading('スプレッドシートから削除中...');
  try {
    const res = await apiPost({
      action: 'admin_delete_event',
      event_id: eventId,
      admin_key: adminKey || '',
      line_user_id: state.lineProfile?.userId || ''
    });
    if (!res.ok) throw new Error(res.error || '削除に失敗しました');

    removeMyEventHistory(eventId);
    showToast('スプレッドシートから完全に削除しました');

    if (redirectAfter) {
      window.location.href = getBaseUrl();
    } else {
      renderDashboardAll();
    }
  } catch (err) {
    alert('削除エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

/* =====================================================
   イベントデータ取得＆画面振り分け
===================================================== */
async function loadEventAndRender() {
  showLoading('イベント情報を読み込み中...');
  try {
    const params = { action: 'get_event', id: state.currentEventId };
    if (state.currentAdminKey) params.key = state.currentAdminKey;
    if (state.lineProfile?.userId) params.line_uid = state.lineProfile.userId;
    if (state.forcePreview) params.preview = '1';

    const myRid = getMyResponseId(state.currentEventId);
    if (myRid) params.my_rid = myRid;

    const res = await apiGet(params);
    if (!res.ok) {
      showErrorView(res.error || 'イベントの読み込みに失敗しました。');
      return;
    }

    state.eventData = res;
    if (res.is_admin) {
      if (res.admin_key) state.currentAdminKey = res.admin_key;
      state.invitedHistory = Array.isArray(res.invited_memo) ? res.invited_memo : [];
      renderAdminView(res);
    } else {
      if (!state.forcePreview) addInvitedEventHistory(res.event.id);
      renderGuestView(res);
    }
  } catch (err) {
    showErrorView('サーバーと通信できませんでした: ' + err.message);
  } finally {
    hideLoading();
  }
}

/* =====================================================
   ビュー2：招待回答画面（ゲスト用）
===================================================== */
function renderEventMeta(metaEl, noteBoxEl, ev) {
  const dates = Array.isArray(ev.dates) ? ev.dates : [];
  const items = [];
  if (ev.mode === 'single' && dates[0]) {
    items.push({ label: '日時', val: formatDateLabel(dates[0].date, dates[0].time) });
  } else {
    items.push({ label: '形式', val: `複数候補日（${dates.length}日程）` });
  }
  items.push({ label: '場所', val: ev.location || '未定（幹事へ確認）' });
  if (ev.fee) items.push({ label: 'セット料金', val: ev.fee });
  items.push({ label: '定員', val: `${ev.capacity}名` });
  if (ev.admin_name) items.push({ label: '幹事', val: ev.admin_name });

  metaEl.innerHTML = items.map(it => `
    <div class="meta-item">
      <span class="meta-label">${it.label}</span>
      <span>${escapeHtml(it.val)}</span>
    </div>
  `).join('');

  if (ev.note) {
    noteBoxEl.textContent = ev.note;
    noteBoxEl.classList.remove('hidden');
  } else {
    noteBoxEl.classList.add('hidden');
  }
}

function renderGuestView(data) {
  hideAllViews();
  setHeaderButtons('guest');
  $('view-guest').classList.remove('hidden');

  const { event: ev, counts, my_response: myRes } = data;
  const dates = Array.isArray(ev.dates) ? ev.dates : [];

  $('guest-title').textContent = ev.title;
  renderEventMeta($('guest-meta'), $('guest-note-box'), ev);

  const badges = [];
  if (state.forcePreview) badges.push('<span class="badge badge-admin">招待画面プレビュー中</span>');
  if (ev.is_closed) {
    badges.push('<span class="badge badge-closed">受付終了</span>');
  } else if (ev.mode === 'single' && dates[0]) {
    const okCnt = counts[dates[0].id]?.ok || 0;
    badges.push(okCnt >= ev.capacity
      ? '<span class="badge badge-full">満員（キャンセル待ち）</span>'
      : `<span class="badge badge-open">募集中（残り${ev.capacity - okCnt}枠）</span>`);
  } else {
    badges.push('<span class="badge badge-open">日程調整中</span>');
  }
  $('guest-badges').innerHTML = badges.join('');

  const statusArea = $('guest-status-area');
  if (ev.mode === 'single' && dates[0]) {
    const dId = dates[0].id;
    const c = counts[dId] || { ok: 0, maybe: 0, ng: 0 };
    const rem = Math.max(0, ev.capacity - c.ok);
    statusArea.innerHTML = `
      <div class="count-box-grid">
        <div class="count-box ok"><span class="count-num">${c.ok} / ${ev.capacity}</span><span class="count-lbl">参加</span></div>
        <div class="count-box maybe"><span class="count-num">${c.maybe}名</span><span class="count-lbl">保留・調整中</span></div>
        <div class="count-box rem"><span class="count-num">${rem === 0 ? '満員' : 'あと' + rem + '名'}</span><span class="count-lbl">${rem === 0 ? 'キャンセル待ち' : '残り枠'}</span></div>
      </div>
    `;
  } else {
    statusArea.innerHTML = dates.map(d => {
      const c = counts[d.id] || { ok: 0, maybe: 0, ng: 0 };
      const rem = Math.max(0, ev.capacity - c.ok);
      const badgeHtml = rem === 0 ? '<span class="badge badge-full">満員</span>' : `<span class="badge badge-open">残り${rem}枠</span>`;
      return `
        <div class="multi-status-row">
          <strong>${escapeHtml(formatDateLabel(d.date, d.time))}</strong>
          <div class="multi-status-counts">
            <span>参加 <strong>${c.ok}/${ev.capacity}</strong></span>
            <span>保留 <strong>${c.maybe}</strong></span>
            ${badgeHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  renderGuestCalendarCard(ev, myRes);

  state.guestAnswers = {};
  if (myRes) {
    $('guest-name').value = myRes.name;
    $('guest-condition-memo').value = myRes.condition_memo || '';
    state.guestAnswers = { ...(myRes.answers || {}) };
    $('guest-form-title').textContent = '回答を変更する';
    $('btn-guest-submit').textContent = '回答を更新する';
    $('guest-saved-hint').classList.remove('hidden');
  } else {
    const autoName = state.lineProfile?.displayName || localStorage.getItem(STORAGE_GUEST_NAME) || '';
    if (autoName && !$('guest-name').value) $('guest-name').value = autoName;
    $('guest-form-title').textContent = '出欠を回答する';
    $('btn-guest-submit').textContent = '回答を送信する';
    $('guest-saved-hint').classList.add('hidden');
  }

  const closedBanner = $('guest-closed-banner');
  if (ev.is_closed) {
    closedBanner.textContent = 'このイベントは幹事によって受付が締め切られています。';
    closedBanner.className = 'banner banner-closed';
    closedBanner.classList.remove('hidden');
    $('btn-guest-submit').disabled = true;
  } else {
    closedBanner.classList.add('hidden');
    $('btn-guest-submit').disabled = false;
  }

  renderGuestChoiceInputs(ev, counts, myRes);
}

function renderGuestChoiceInputs(ev, counts, myRes) {
  const container = $('guest-answer-inputs');
  container.innerHTML = '';

  (ev.dates || []).forEach(d => {
    const c = counts[d.id] || { ok: 0, maybe: 0, ng: 0 };
    const prevAns = myRes?.answers?.[d.id] || null;
    const isFullLocked = ev.auto_close && c.ok >= ev.capacity && prevAns !== 'ok';
    const currentVal = state.guestAnswers[d.id] || '';

    const block = document.createElement('div');
    block.className = ev.mode === 'multi' ? 'multi-day-item' : 'form-group';
    const headerHtml = ev.mode === 'multi'
      ? `<div class="multi-day-head"><span class="multi-day-label">${escapeHtml(formatDateLabel(d.date, d.time))}</span>${isFullLocked ? '<span class="badge badge-full">満員（キャンセル待ち可）</span>' : ''}</div>`
      : `<label>参加可否 <span class="req">必須</span>${isFullLocked ? ' <span class="badge badge-full">現在満員・保留でキャンセル待ち</span>' : ''}</label>`;

    block.innerHTML = `
      ${headerHtml}
      <div class="choice-grid" data-date-id="${escapeHtml(d.id)}">
        <button type="button" class="choice-btn ${currentVal === 'ok' ? 'selected-ok' : ''}" data-val="ok" ${ev.is_closed || isFullLocked ? 'disabled' : ''}>◯ 参加<small>${isFullLocked ? '満員' : 'いけます'}</small></button>
        <button type="button" class="choice-btn ${currentVal === 'maybe' ? 'selected-maybe' : ''}" data-val="maybe" ${ev.is_closed ? 'disabled' : ''}>△ 保留<small>${isFullLocked ? 'キャンセル待ち' : '調整中'}</small></button>
        <button type="button" class="choice-btn ${currentVal === 'ng' ? 'selected-ng' : ''}" data-val="ng" ${ev.is_closed ? 'disabled' : ''}>✕ 不参加<small>今回は見送り</small></button>
      </div>
    `;

    block.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        state.guestAnswers[d.id] = val;
        block.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected-ok', 'selected-maybe', 'selected-ng'));
        btn.classList.add(`selected-${val}`);
      });
    });

    container.appendChild(block);
  });
}

async function handleGuestSubmit(e) {
  e.preventDefault();
  if (!state.eventData) return;

  const ev = state.eventData.event;
  const name = $('guest-name').value.trim();
  const conditionMemo = $('guest-condition-memo').value.trim();

  if (!name) { showToast('名前を入力してください'); return; }
  for (const d of (ev.dates || [])) {
    if (!state.guestAnswers[d.id]) { showToast('すべての日程で ◯ / △ / ✕ を選択してください'); return; }
  }

  const hasOk = Object.values(state.guestAnswers).includes('ok');

  showLoading('回答を送信中...');
  try {
    const existingRid = getMyResponseId(ev.id);
    const res = await apiPost({
      action: 'submit_response',
      event_id: ev.id,
      name,
      answers: state.guestAnswers,
      condition_memo: conditionMemo,
      response_id: existingRid,
      line_user_id: state.lineProfile?.userId || ''
    });

    if (!res.ok) {
      alert(res.error || '送信に失敗しました');
      await loadEventAndRender();
      return;
    }

    localStorage.setItem(STORAGE_GUEST_NAME, name);
    setMyResponseId(ev.id, res.response_id);
    if (!state.forcePreview) addInvitedEventHistory(ev.id);
    showToast('回答を送信しました！');
    await loadEventAndRender();

    if (hasOk) {
      const calCard = $('guest-calendar-card');
      if (calCard && !calCard.classList.contains('hidden')) {
        calCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  } catch (err) {
    alert('送信エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

/* =====================================================
   ビュー3：イベント詳細・幹事管理画面
===================================================== */
function renderAdminView(data) {
  hideAllViews();
  setHeaderButtons('admin');
  $('view-admin').classList.remove('hidden');

  const { event: ev, counts, responses = [] } = data;
  const dates = Array.isArray(ev.dates) ? ev.dates : [];
  addMyEventHistory({ ...ev, admin_key: state.currentAdminKey });

  $('admin-title').textContent = ev.title;
  renderEventMeta($('admin-meta'), $('admin-note-box'), ev);

  const stBadge = $('admin-status-badge');
  if (ev.is_closed) {
    stBadge.textContent = '手動締切中';
    stBadge.className = 'badge badge-closed';
  } else if (ev.mode === 'single' && dates[0] && (counts[dates[0].id]?.ok || 0) >= ev.capacity) {
    stBadge.textContent = '満員到達';
    stBadge.className = 'badge badge-full';
  } else {
    stBadge.textContent = '受付中';
    stBadge.className = 'badge badge-open';
  }

  $('toggle-manual-close').checked = Boolean(ev.is_closed);
  $('admin-edit-title').value = ev.title;
  $('admin-edit-capacity').value = ev.capacity;
  $('admin-edit-location').value = ev.location;
  if ($('admin-edit-fee')) $('admin-edit-fee').value = ev.fee || '';
  $('admin-edit-auto-close').checked = Boolean(ev.auto_close);
  if ($('admin-edit-notify-mode')) $('admin-edit-notify-mode').value = ev.notify_mode || 'all';
  $('admin-edit-note').value = ev.note;

  renderInviteStatus();
  renderAdminEditDates(ev);
  renderAdminResponses(ev, counts, responses);
  setupConfirmSection(ev, counts);
}

/* =====================================================
   シンプルな重複招待警告（送信日時の自動記録）
===================================================== */
function getLastInviteSentTime() {
  if (!Array.isArray(state.invitedHistory) || state.invitedHistory.length === 0) return '';
  const latest = state.invitedHistory[0];
  return latest && latest.sent_at ? formatShortTimestamp(latest.sent_at) : '';
}

function renderInviteStatus() {
  const badge = $('invite-sent-badge');
  const infoEl = $('invite-last-sent-info');
  const count = state.invitedHistory.length;

  if (badge) {
    if (count > 0) {
      badge.textContent = `送信済（${count}回）`;
      badge.className = 'badge badge-open';
    } else {
      badge.textContent = '未送信';
      badge.className = 'badge';
    }
  }

  if (infoEl) {
    const lastTime = getLastInviteSentTime();
    if (count > 0) {
      infoEl.textContent = lastTime
        ? `前回の招待送信：${lastTime}（再送時は重複確認が表示されます）`
        : '招待送信済みです（再送時は重複確認が表示されます）';
      infoEl.classList.remove('hidden');
    } else {
      infoEl.classList.add('hidden');
    }
  }
}

function handleAdminInviteSend() {
  if (!state.eventData) return;

  if (state.invitedHistory.length > 0) {
    const lastTime = getLastInviteSentTime();
    const timeNote = lastTime ? `（前回：${lastTime}）` : '';
    const ok = confirm(
      `このイベントはすでに招待を送信済みです${timeNote}。\n同じ人に重複して送信していませんか？\n\n続けてLINE送信画面を開きますか？`
    );
    if (!ok) return;
  }

  state.invitedHistory.unshift({ sent_at: new Date().toISOString() });
  state.invitedHistory = state.invitedHistory.slice(0, 30);
  renderInviteStatus();
  recordInviteLogBackground(state.currentEventId, state.currentAdminKey, state.invitedHistory);

  const ev = state.eventData.event;
  openLineShare(buildLineMessage(ev), buildInviteFlexMessage(ev));
}

/* =====================================================
   詳細画面の日時編集
===================================================== */
function renderAdminEditDates(ev) {
  const container = $('admin-edit-dates-rows');
  const actionsWrap = $('admin-edit-dates-actions');
  const labelEl = $('admin-edit-dates-label');
  const isMulti = ev.mode === 'multi';

  labelEl.textContent = isMulti ? '候補日時の編集（追加・削除可）' : '開催日時の編集';
  actionsWrap.classList.toggle('hidden', !isMulti);
  container.innerHTML = '';

  const dates = Array.isArray(ev.dates) && ev.dates.length > 0
    ? ev.dates
    : [{ id: 'd1', date: getTodayStr(1), time: '13:00〜19:00' }];
  dates.forEach(d => addAdminEditDateRow(d, isMulti));
}

function addAdminEditDateRow(dateObj, isMulti, overrideTime = null) {
  const container = $('admin-edit-dates-rows');
  const dateVal = dateObj.date || getTodayStr(1);
  const parsed = overrideTime || parseTimeString(dateObj.time, isMulti ? '' : '19');
  const idx = container.children.length + 1;

  const div = document.createElement('div');
  div.className = 'date-row-card';
  div.dataset.dateId = dateObj.id || '';
  div.innerHTML = `
    <div class="date-row-head">
      <span class="row-num">${isMulti ? '候補 #' + idx : '開催日時'}</span>
      ${isMulti ? '<button type="button" class="btn-remove-row">削除</button>' : ''}
    </div>
    <input type="hidden" class="inp-date" value="${escapeHtml(dateVal)}" />
    <button type="button" class="date-picker-btn">
      <span class="date-picker-text">${escapeHtml(formatDateButtonLabel(dateVal))}</span>
      <span class="cal-icon">カレンダー変更</span>
    </button>
    ${buildTimeSelectHtml(parsed.sh, parsed.sm, parsed.eh, parsed.em)}
  `;

  bindDatePickerToRow(div);
  bindTimeSelectEvents(div);

  if (isMulti) {
    div.querySelector('.btn-remove-row').addEventListener('click', () => {
      if (container.children.length <= 1) { showToast('候補日は最低1件必要です'); return; }
      div.remove();
      renumberRows(container, '候補');
    });
  }

  container.appendChild(div);
  if (isMulti) renumberRows(container, '候補');
}

/* =====================================================
   出欠一覧描画（幹事限定）
===================================================== */
function renderAdminResponses(ev, counts, responses) {
  const summaryEl = $('admin-summary-area');
  const listEl = $('admin-responses-area');
  const dates = Array.isArray(ev.dates) ? ev.dates : [];

  if (ev.mode === 'single' && dates[0]) {
    const dId = dates[0].id;
    const c = counts[dId] || { ok: 0, maybe: 0, ng: 0 };
    const rem = Math.max(0, ev.capacity - c.ok);

    summaryEl.innerHTML = `
      <div class="count-box-grid">
        <div class="count-box ok"><span class="count-num">${c.ok} / ${ev.capacity}</span><span class="count-lbl">参加</span></div>
        <div class="count-box maybe"><span class="count-num">${c.maybe}名</span><span class="count-lbl">保留</span></div>
        <div class="count-box rem"><span class="count-num">${rem === 0 ? '満員' : 'あと' + rem + '名'}</span><span class="count-lbl">不参加 ${c.ng}名</span></div>
      </div>
    `;

    if (responses.length === 0) {
      listEl.innerHTML = '<p class="muted-text">まだ回答はありません。上のボタンからLINEで招待を送りましょう。</p>';
      return;
    }

    const groups = [
      { key: 'ok', label: `◯ 参加（${c.ok}名）` },
      { key: 'maybe', label: `△ 保留・キャンセル待ち（${c.maybe}名）` },
      { key: 'ng', label: `✕ 不参加（${c.ng}名）` }
    ];

    listEl.innerHTML = '';
    groups.forEach(g => {
      const items = responses.filter(r => r.answers[dId] === g.key);
      if (items.length === 0) return;

      const titleDiv = document.createElement('div');
      titleDiv.className = `resp-group-title ${g.key}`;
      titleDiv.textContent = g.label;
      listEl.appendChild(titleDiv);

      items.forEach(r => {
        const row = document.createElement('div');
        row.className = 'resp-row';
        row.innerHTML = `
          <div>
            <div class="resp-name">${escapeHtml(r.name)}</div>
            ${r.condition_memo ? `<div class="resp-memo">条件メモ：${escapeHtml(r.condition_memo)}</div>` : ''}
            <div class="resp-time">更新：${escapeHtml(formatShortTimestamp(r.updated_at))}</div>
          </div>
          <button type="button" class="btn-text-danger btn-del-resp">削除</button>
        `;
        row.querySelector('.btn-del-resp').addEventListener('click', () => handleDeleteResponse(r));
        listEl.appendChild(row);
      });
    });
  } else {
    summaryEl.innerHTML = dates.map(d => {
      const c = counts[d.id] || { ok: 0, maybe: 0, ng: 0 };
      const rem = Math.max(0, ev.capacity - c.ok);
      return `
        <div class="multi-status-row">
          <strong>${escapeHtml(formatDateLabel(d.date, d.time))}</strong>
          <div class="multi-status-counts">
            <span class="badge badge-open">◯ ${c.ok}/${ev.capacity}</span>
            <span class="badge badge-full">△ ${c.maybe}</span>
            <span class="badge">✕ ${c.ng}</span>
            <span>${rem === 0 ? '満員' : '残' + rem}</span>
          </div>
        </div>
      `;
    }).join('');

    if (responses.length === 0) {
      listEl.innerHTML = '<p class="muted-text" style="margin-top:12px;">まだ回答はありません。</p>';
      return;
    }

    const markText = { ok: '◯', maybe: '△', ng: '✕' };
    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-scroll';
    const headCols = dates.map(d => `<th>${escapeHtml(formatDateLabel(d.date, d.time))}</th>`).join('');
    const bodyRows = responses.map((r, idx) => {
      const cells = dates.map(d => {
        const ans = r.answers[d.id] || '';
        return `<td class="${ans ? 'mark-' + ans : ''}">${markText[ans] || '-'}</td>`;
      }).join('');
      return `
        <tr>
          <td><strong>${escapeHtml(r.name)}</strong><div class="resp-time">${escapeHtml(formatShortTimestamp(r.updated_at))}</div></td>
          ${cells}
          <td style="text-align:left;min-width:120px;">${escapeHtml(r.condition_memo || '-')}</td>
          <td><button type="button" class="btn-text-danger btn-del-matrix" data-idx="${idx}">削除</button></td>
        </tr>
      `;
    }).join('');

    tableWrap.innerHTML = `
      <table class="matrix-table">
        <thead><tr><th>名前</th>${headCols}<th>条件メモ</th><th>操作</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;

    tableWrap.querySelectorAll('.btn-del-matrix').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = responses[Number(btn.dataset.idx)];
        if (target) handleDeleteResponse(target);
      });
    });

    listEl.innerHTML = '';
    listEl.appendChild(tableWrap);
  }
}

async function handleDeleteResponse(resp) {
  if (!confirm(`「${resp.name}」さんの回答を削除しますか？`)) return;
  showLoading('回答を削除中...');
  try {
    const res = await apiPost({
      action: 'admin_delete_response',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      line_user_id: state.lineProfile?.userId || '',
      response_id: resp.response_id
    });
    if (!res.ok) throw new Error(res.error || '削除に失敗しました');
    showToast('回答を削除しました');
    await loadEventAndRender();
  } catch (err) {
    alert(err.message);
  } finally {
    hideLoading();
  }
}

/* =====================================================
   イベント編集保存（日時・候補日・セット料金含む）＆締切スイッチ
===================================================== */
async function handleManualCloseToggle() {
  const isClosed = $('toggle-manual-close').checked;
  showLoading('受付状態を更新中...');
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      line_user_id: state.lineProfile?.userId || '',
      updates: { is_closed: isClosed }
    });
    if (!res.ok) throw new Error(res.error);
    showToast(isClosed ? '受付を締め切りました' : '受付を再開しました');
    await loadEventAndRender();
  } catch (err) {
    alert(err.message);
  } finally {
    hideLoading();
  }
}

async function handleAdminSaveSettings() {
  const title = $('admin-edit-title').value.trim();
  const capacity = Number($('admin-edit-capacity').value) || 4;
  const location = $('admin-edit-location').value.trim();
  const fee = ($('admin-edit-fee')?.value || '').trim();
  const autoClose = $('admin-edit-auto-close').checked;
  const notifyMode = $('admin-edit-notify-mode') ? $('admin-edit-notify-mode').value : 'all';
  const note = $('admin-edit-note').value.trim();

  if (!title) { showToast('イベント名を入力してください'); return; }

  const dateRows = Array.from($('admin-edit-dates-rows').children);
  const editedDates = dateRows.map(row => ({
    id: row.dataset.dateId || '',
    date: row.querySelector('.inp-date').value.trim(),
    time: readTimeFromRow(row)
  })).filter(d => d.date);

  if (editedDates.length === 0) {
    showToast('有効な日程を1件以上設定してください');
    return;
  }

  showLoading('編集内容を保存中...');
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      line_user_id: state.lineProfile?.userId || '',
      updates: {
        title,
        capacity,
        location,
        fee,
        auto_close: autoClose,
        notify_mode: notifyMode,
        note,
        dates: editedDates
      }
    });
    if (!res.ok) throw new Error(res.error);
    if (location) saveLocationToHistory(location);
    showToast('編集内容を保存しました');
    await loadEventAndRender();
  } catch (err) {
    alert('保存エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);