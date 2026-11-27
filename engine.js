/**
 * 麻雀セット出欠管理システム - フロントエンドエンジン（完全版）
 * LIFF + LINE自動通知 + 複数日連続タップカレンダー + 雀荘名履歴 + 時間プルダウン + 開催確定＆集合案内LINE送信
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-yNrj1KqUzx68Ar-NhDo9FgnetpyMoGdO_zAVdiM1yYHr-KJ0pHoqSVfAsVXailO5/exec';
const LIFF_ID = 'YOUR_LIFF_ID';

const STORAGE_MY_EVENTS = 'mj_set_my_events_v1';
const STORAGE_GUEST_NAME = 'mj_set_guest_name_v1';
const STORAGE_MY_RESPONSES = 'mj_set_my_responses_v1';
const STORAGE_LOCATIONS = 'mj_set_locations_v1';

const state = {
  createMode: 'single',
  lastCreated: [],
  currentEventId: null,
  currentAdminKey: null,
  forcePreview: false,
  eventData: null,
  guestAnswers: {},
  invitedMemo: [],
  liffReady: false,
  lineProfile: null,
  cloudMyEvents: [],
  confirmCustomEdited: false
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

function formatDateLabel(dateStr, timeStr) {
  let datePart = dateStr || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
    datePart = `${m}/${d}(${w})`;
  }
  return [datePart, timeStr].filter(Boolean).join(' ');
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
  $('loading-text').textContent = text;
  $('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  $('loading-overlay').classList.add('hidden');
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
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

async function openLineShare(message) {
  if (
    state.liffReady &&
    typeof liff !== 'undefined' &&
    liff.isApiAvailable &&
    liff.isApiAvailable('shareTargetPicker')
  ) {
    try {
      const res = await liff.shareTargetPicker([{ type: 'text', text: message }]);
      if (res) showToast('LINEでフレンドに送信しました！');
      return;
    } catch (e) {
      console.warn('ShareTargetPicker失敗、URL共有へ切替:', e);
    }
  }
  const url = `https://line.me/R/share?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener');
}

function buildLineMessage(ev) {
  const guestUrl = buildGuestUrl(ev.id);
  const lines = [`【麻雀セットのお誘い】`, `${ev.title}`];

  if (ev.mode === 'single' && ev.dates && ev.dates[0]) {
    lines.push(`日時：${formatDateLabel(ev.dates[0].date, ev.dates[0].time)}`);
  } else if (ev.dates && ev.dates.length > 0) {
    lines.push(`候補日：${ev.dates.map(d => formatDateLabel(d.date, d.time)).join(' / ')}`);
  }

  if (ev.location) lines.push(`場所：${ev.location}`);
  lines.push(`定員：${ev.capacity}名`);
  lines.push('');
  lines.push('▼出欠の回答・現在の空き人数はこちら');
  lines.push(guestUrl);
  return lines.join('\n');
}

/* =====================================================
   開催確定＆集合案内メッセージ生成
===================================================== */
function setupConfirmSection(ev, counts) {
  const dateWrap = $('confirm-date-wrap');
  const dateSelect = $('confirm-date-select');

  if (ev.mode === 'multi' && ev.dates.length > 1) {
    dateWrap.classList.remove('hidden');

    // ◯参加人数が最も多い日程を初期選択
    let bestId = ev.dates[0].id;
    let bestOk = -1;
    ev.dates.forEach(d => {
      const okCnt = counts[d.id]?.ok || 0;
      if (okCnt > bestOk) {
        bestOk = okCnt;
        bestId = d.id;
      }
    });

    dateSelect.innerHTML = ev.dates.map(d => {
      const c = counts[d.id] || { ok: 0, maybe: 0 };
      const label = `${formatDateLabel(d.date, d.time)}（◯${c.ok}名 / △${c.maybe}名）`;
      return `<option value="${escapeHtml(d.id)}" ${d.id === bestId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  } else {
    dateWrap.classList.add('hidden');
    dateSelect.innerHTML = '';
  }

  state.confirmCustomEdited = false;
  refreshConfirmMessageText();
}

function generateConfirmMessage() {
  if (!state.eventData) return '';
  const { event: ev, responses = [] } = state.eventData;

  let targetDate = ev.dates[0];
  if (ev.mode === 'multi' && ev.dates.length > 1) {
    const selectedId = $('confirm-date-select').value;
    targetDate = ev.dates.find(d => d.id === selectedId) || ev.dates[0];
  }

  const includeMaybe = $('confirm-opt-include-maybe').checked;
  const includeMemo = $('confirm-opt-include-memo').checked;
  const extraNote = $('confirm-extra-note').value.trim();

  const dId = targetDate.id;
  const okMembers = responses.filter(r => r.answers[dId] === 'ok');
  const maybeMembers = responses.filter(r => r.answers[dId] === 'maybe');

  const formatMember = (r) =>
    includeMemo && r.condition_memo ? `・${r.name}（${r.condition_memo}）` : `・${r.name}`;

  const lines = [
    '【開催確定＆集合案内】',
    ev.title,
    '',
    `■ 日時：${formatDateLabel(targetDate.date, targetDate.time)}`,
    `■ 場所：${ev.location || '未定（別途連絡）'}`,
    `■ 参加メンバー（${okMembers.length}名）`
  ];

  if (okMembers.length > 0) {
    lines.push(...okMembers.map(formatMember));
  } else {
    lines.push('・（まだ◯回答がありません）');
  }

  if (includeMaybe && maybeMembers.length > 0) {
    lines.push('', `■ 保留・調整中（${maybeMembers.length}名）`, ...maybeMembers.map(formatMember));
  }

  if (extraNote) {
    lines.push('', `■ 集合・予約メモ：${extraNote}`);
  }

  if (ev.note) {
    lines.push('', `■ イベント詳細：`, ev.note);
  }

  lines.push('', '当日はよろしくお願いします！');
  return lines.join('\n');
}

function refreshConfirmMessageText(force = false) {
  if (!force && state.confirmCustomEdited) return;
  const ta = $('confirm-message-text');
  if (ta) ta.value = generateConfirmMessage();
}

function getCurrentConfirmMessage() {
  const ta = $('confirm-message-text');
  if (state.confirmCustomEdited && ta && ta.value.trim()) {
    return ta.value;
  }
  return generateConfirmMessage();
}

/* =====================================================
   雀荘名（場所）履歴チップ機能
===================================================== */
function loadLocationHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_LOCATIONS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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
  const list = loadLocationHistory().filter(item => item !== loc);
  localStorage.setItem(STORAGE_LOCATIONS, JSON.stringify(list));
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
    chip.querySelector('.loc-chip-del').addEventListener('click', () => {
      removeLocationFromHistory(loc);
    });
    wrap.appendChild(chip);
  });
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
   時間プルダウン生成（1時間＋15分刻み）
===================================================== */
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
  endH.addEventListener('change', () => {
    endM.disabled = endH.value === '';
  });
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
   ローカルストレージ操作
===================================================== */
function loadLocalMyEvents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_MY_EVENTS) || '[]');
  } catch {
    return [];
  }
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
    capacity: item.capacity,
    dates: item.dates,
    created_at: item.created_at || new Date().toISOString()
  });
  saveLocalMyEvents(list);
}

function removeMyEventHistory(eventId) {
  saveLocalMyEvents(loadLocalMyEvents().filter(e => e.id !== eventId));
  state.cloudMyEvents = state.cloudMyEvents.filter(e => e.id !== eventId);
}

function getMyResponseId(eventId) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_MY_RESPONSES) || '{}');
    return map[eventId] || '';
  } catch {
    return '';
  }
}

function setMyResponseId(eventId, responseId) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_MY_RESPONSES) || '{}');
    map[eventId] = responseId;
    localStorage.setItem(STORAGE_MY_RESPONSES, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/* =====================================================
   GAS API 通信
===================================================== */
async function apiGet(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GAS_API_URL}?${qs}`, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function apiPost(payload) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
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
      state.lineProfile = {
        userId: profile.userId,
        displayName: profile.displayName
      };
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
    textEl.textContent = 'LINEログインすると作成イベントの自動同期・回答通知が使えます';
    loginBtn.classList.remove('hidden');
  }
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  let id = params.get('id') || '';
  let key = params.get('key') || '';
  let preview = params.get('preview') === '1';

  if (!id && params.get('liff.state')) {
    const rawState = params.get('liff.state');
    const qIdx = rawState.indexOf('?');
    if (qIdx !== -1) {
      const sub = new URLSearchParams(rawState.slice(qIdx + 1));
      id = sub.get('id') || '';
      key = sub.get('key') || key;
      preview = preview || sub.get('preview') === '1';
    }
  }
  return { id, key, preview };
}

/* =====================================================
   画面切替・初期化
===================================================== */
function hideAllViews() {
  $('view-create').classList.add('hidden');
  $('view-guest').classList.add('hidden');
  $('view-admin').classList.add('hidden');
  $('view-error').classList.add('hidden');
}

function showErrorView(msg) {
  hideAllViews();
  $('error-message').textContent = msg;
  $('view-error').classList.remove('hidden');
}

async function init() {
  bindStaticEvents();

  showLoading('読み込み中...');
  await initLiffIfAvailable();
  hideLoading();

  const { id, key, preview } = parseUrlParams();
  if (!id) {
    await initCreateView();
  } else {
    state.currentEventId = id;
    state.currentAdminKey = key;
    state.forcePreview = preview;
    await loadEventAndRender();
  }
}

function bindStaticEvents() {
  $('btn-go-create').addEventListener('click', () => {
    window.location.href = getBaseUrl();
  });

  // カレンダーモーダル操作
  $('cal-prev').addEventListener('click', () => {
    calState.viewMonth--;
    if (calState.viewMonth < 0) {
      calState.viewMonth = 11;
      calState.viewYear--;
    }
    renderCalendarGrid();
  });
  $('cal-next').addEventListener('click', () => {
    calState.viewMonth++;
    if (calState.viewMonth > 11) {
      calState.viewMonth = 0;
      calState.viewYear++;
    }
    renderCalendarGrid();
  });
  $('cal-today').addEventListener('click', () => {
    const now = new Date();
    calState.viewYear = now.getFullYear();
    calState.viewMonth = now.getMonth();
    renderCalendarGrid();
  });
  $('cal-confirm-multi').addEventListener('click', () => {
    if (typeof calState.onConfirmMulti === 'function') {
      const sorted = Array.from(calState.selectedSet).sort();
      calState.onConfirmMulti(sorted);
    }
    closeCalendarModal();
  });
  $('cal-close').addEventListener('click', closeCalendarModal);
  $('calendar-modal').addEventListener('click', (e) => {
    if (e.target === $('calendar-modal')) closeCalendarModal();
  });

  const loginBtn = $('btn-line-login');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      if (state.liffReady && typeof liff !== 'undefined') {
        liff.login({ redirectUri: window.location.href });
      }
    });
  }

  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.createMode = btn.dataset.mode;
      $('single-dates-area').classList.toggle('hidden', state.createMode !== 'single');
      $('multi-dates-area').classList.toggle('hidden', state.createMode !== 'multi');
    });
  });

  document.querySelectorAll('.cap-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('ev-capacity').value = chip.dataset.cap;
    });
  });

  $('btn-add-single-row').addEventListener('click', () => {
    const t = getLastRowTime($('single-rows'), '19');
    addSingleDateRow('', t.sh, t.sm, t.eh, t.em);
  });
  $('btn-multi-pick-single').addEventListener('click', () => openMultiPickForContainer('single'));

  $('btn-add-multi-row').addEventListener('click', () => {
    const t = getLastRowTime($('multi-rows'), '');
    addMultiDateRow('', t.sh, t.sm, t.eh, t.em);
  });
  $('btn-multi-pick-multi').addEventListener('click', () => openMultiPickForContainer('multi'));

  $('create-form').addEventListener('submit', handleCreateSubmit);
  $('btn-batch-line-share').addEventListener('click', handleBatchLineShare);

  $('btn-clear-history').addEventListener('click', () => {
    if (!confirm('この端末の表示履歴のみをクリアしますか？（イベント本体を消す場合は各カードの「完全削除」を使ってください）')) return;
    localStorage.removeItem(STORAGE_MY_EVENTS);
    renderMyEventsHistory();
  });

  $('btn-guest-refresh').addEventListener('click', () => loadEventAndRender());
  $('guest-form').addEventListener('submit', handleGuestSubmit);

  $('btn-admin-refresh').addEventListener('click', () => loadEventAndRender());
  $('btn-admin-line-share').addEventListener('click', () => {
    if (!state.eventData) return;
    openLineShare(buildLineMessage(state.eventData.event));
  });
  $('btn-copy-guest-url').addEventListener('click', () => {
    copyToClipboard(buildGuestUrl(state.currentEventId), '招待用URLをコピーしました');
  });
  $('btn-copy-admin-url').addEventListener('click', () => {
    copyToClipboard(buildAdminUrl(state.currentEventId, state.currentAdminKey), '幹事用URLをコピーしました');
  });
  $('btn-open-guest-preview').addEventListener('click', () => {
    window.open(buildPreviewUrl(state.currentEventId), '_blank', 'noopener');
  });

  // 開催確定＆集合案内イベント
  const onConfirmOptionChange = () => {
    state.confirmCustomEdited = false;
    refreshConfirmMessageText(true);
  };
  $('confirm-date-select').addEventListener('change', onConfirmOptionChange);
  $('confirm-opt-include-maybe').addEventListener('change', onConfirmOptionChange);
  $('confirm-opt-include-memo').addEventListener('change', onConfirmOptionChange);
  $('confirm-extra-note').addEventListener('input', onConfirmOptionChange);

  $('confirm-message-text').addEventListener('input', () => {
    state.confirmCustomEdited = true;
  });

  $('btn-confirm-preview-toggle').addEventListener('click', () => {
    const wrap = $('confirm-preview-wrap');
    const isHidden = wrap.classList.toggle('hidden');
    $('btn-confirm-preview-toggle').textContent = isHidden ? '文面を確認・編集' : 'プレビューを閉じる';
    if (!isHidden) refreshConfirmMessageText();
  });

  $('btn-confirm-reset').addEventListener('click', () => {
    state.confirmCustomEdited = false;
    refreshConfirmMessageText(true);
    showToast('自動生成された文面に戻しました');
  });

  $('btn-confirm-line-share').addEventListener('click', () => {
    const msg = getCurrentConfirmMessage();
    if (!msg) return;
    openLineShare(msg);
  });

  $('btn-confirm-copy').addEventListener('click', () => {
    const msg = getCurrentConfirmMessage();
    if (!msg) return;
    copyToClipboard(msg, '確定案内文をコピーしました');
  });

  $('invited-memo-form').addEventListener('submit', handleAddInvitedMemo);
  $('toggle-manual-close').addEventListener('change', handleManualCloseToggle);
  $('btn-admin-save-settings').addEventListener('click', handleAdminSaveSettings);
  $('btn-admin-delete-event').addEventListener('click', () => {
    handleDeleteEventByIds(state.currentEventId, state.currentAdminKey, state.eventData?.event?.title || '', true);
  });
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
    if (added > 0) {
      showToast(`${added}日分の日程を追加しました`);
    } else {
      showToast('選択した日付は既に追加済みです');
    }
  });
}

/* =====================================================
   ビュー1：イベント作成画面
===================================================== */
async function initCreateView() {
  hideAllViews();
  $('view-create').classList.remove('hidden');

  renderLocationHistoryChips();

  $('single-rows').innerHTML = '';
  $('multi-rows').innerHTML = '';
  addSingleDateRow(getTodayStr(1), '13', '00', '19', '00');
  addMultiDateRow(getTodayStr(1), '13', '00', '', '00');
  addMultiDateRow(getTodayStr(2), '13', '00', '', '00');

  if (state.lineProfile) {
    try {
      const res = await apiGet({
        action: 'list_my_events',
        line_uid: state.lineProfile.userId
      });
      if (res.ok && Array.isArray(res.events)) {
        state.cloudMyEvents = res.events;
      }
    } catch (e) {
      console.warn('作成済みイベント同期エラー:', e);
    }
  }

  renderMyEventsHistory();
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
    if (container.children.length <= 1) {
      showToast('日程は最低1件必要です');
      return;
    }
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
    if (container.children.length <= 1) {
      showToast('候補日は最低1件必要です');
      return;
    }
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
  const capacity = Number($('ev-capacity').value) || 4;
  const autoClose = $('ev-auto-close').checked;
  const notifyMode = $('ev-notify-mode') ? $('ev-notify-mode').value : 'all';
  const note = $('ev-note').value.trim();

  if (!baseTitle) {
    showToast('イベント名を入力してください');
    return;
  }

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
      const titleSuffix = rows.length > 1 ? ` (${formatDateLabel(date, '')})` : '';
      eventsPayload.push({
        mode: 'single',
        title: baseTitle + titleSuffix,
        location: rowLoc || baseLocation,
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

    if (dates.length === 0) {
      showToast('候補日を1件以上選択してください');
      return;
    }
    eventsPayload.push({
      mode: 'multi',
      title: baseTitle,
      location: baseLocation,
      capacity,
      note,
      auto_close: autoClose,
      notify_mode: notifyMode,
      dates
    });
  }

  if (eventsPayload.length === 0) {
    showToast('有効な日程を選択してください');
    return;
  }

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

    state.lastCreated = res.created || [];
    state.lastCreated.forEach(ev => {
      addMyEventHistory(ev);
      if (state.lineProfile) state.cloudMyEvents.unshift(ev);
    });

    renderCreatedResults(state.lastCreated);
    renderMyEventsHistory();
    showToast(`${state.lastCreated.length}件のイベントを作成しました`);
    $('create-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    alert('作成エラー: ' + err.message);
  } finally {
    hideLoading();
  }
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
    const dateDesc = ev.mode === 'single'
      ? formatDateLabel(ev.dates[0]?.date, ev.dates[0]?.time)
      : `候補日 ${ev.dates.length}件`;

    const card = document.createElement('div');
    card.className = 'created-item';
    card.innerHTML = `
      <div class="created-item-title">${escapeHtml(ev.title)}</div>
      <div class="created-item-sub">
        ${escapeHtml(dateDesc)}${ev.location ? ' ／ ' + escapeHtml(ev.location) : ''} ／ 定員${ev.capacity}名
      </div>
      <div class="created-actions">
        <button type="button" class="btn btn-line btn-sm btn-send-line">LINEで送る</button>
        <button type="button" class="btn btn-secondary btn-sm btn-copy-guest">招待URLコピー</button>
        <a href="${adminUrl}" class="btn btn-primary btn-sm">幹事画面を開く</a>
      </div>
    `;
    card.querySelector('.btn-send-line').addEventListener('click', () => {
      openLineShare(buildLineMessage(ev));
    });
    card.querySelector('.btn-copy-guest').addEventListener('click', () => {
      copyToClipboard(guestUrl, '招待URLをコピーしました');
    });
    listEl.appendChild(card);
  });
}

function handleBatchLineShare() {
  if (!state.lastCreated.length) return;
  const lines = ['【麻雀セット日程のお誘い】', '都合の合う日程から回答お願いします！', ''];
  state.lastCreated.forEach(ev => {
    const dt = ev.dates[0] ? formatDateLabel(ev.dates[0].date, ev.dates[0].time) : '';
    lines.push(`■ ${ev.title}`);
    if (dt) lines.push(`日時：${dt}`);
    if (ev.location) lines.push(`場所：${ev.location}`);
    lines.push(buildGuestUrl(ev.id));
    lines.push('');
  });
  openLineShare(lines.join('\n'));
}

function renderMyEventsHistory() {
  const mergedMap = new Map();
  state.cloudMyEvents.forEach(ev => mergedMap.set(ev.id, ev));
  loadLocalMyEvents().forEach(ev => {
    if (!mergedMap.has(ev.id)) mergedMap.set(ev.id, ev);
  });
  const list = Array.from(mergedMap.values());

  const sec = $('my-events-section');
  const container = $('my-events-list');

  if (list.length === 0) {
    sec.classList.add('hidden');
    return;
  }

  sec.classList.remove('hidden');
  container.innerHTML = '';

  list.forEach(ev => {
    const adminUrl = buildAdminUrl(ev.id, ev.admin_key);
    const dateDesc = ev.mode === 'single' && ev.dates && ev.dates[0]
      ? formatDateLabel(ev.dates[0].date, ev.dates[0].time)
      : `候補日 ${(ev.dates || []).length}件`;

    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-item-title">${escapeHtml(ev.title)}</div>
      <div class="history-item-sub">
        ${escapeHtml(dateDesc)}${ev.location ? ' ／ ' + escapeHtml(ev.location) : ''}
      </div>
      <div class="created-actions">
        <a href="${adminUrl}" class="btn btn-primary btn-sm">幹事画面へ</a>
        <button type="button" class="btn btn-line btn-sm btn-hist-line">LINEで追加送信</button>
        <button type="button" class="btn btn-secondary btn-sm btn-hist-copy">招待URL</button>
        <button type="button" class="btn btn-danger-outline btn-sm btn-hist-delete">完全削除</button>
      </div>
    `;
    div.querySelector('.btn-hist-line').addEventListener('click', () => {
      openLineShare(buildLineMessage(ev));
    });
    div.querySelector('.btn-hist-copy').addEventListener('click', () => {
      copyToClipboard(buildGuestUrl(ev.id), '招待URLをコピーしました');
    });
    div.querySelector('.btn-hist-delete').addEventListener('click', () => {
      handleDeleteEventByIds(ev.id, ev.admin_key, ev.title, false);
    });
    container.appendChild(div);
  });
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
    state.lastCreated = state.lastCreated.filter(e => e.id !== eventId);
    showToast('スプレッドシートから完全に削除しました');

    if (redirectAfter) {
      window.location.href = getBaseUrl();
    } else {
      renderMyEventsHistory();
      if (state.lastCreated.length === 0) {
        $('create-result').classList.add('hidden');
      } else {
        renderCreatedResults(state.lastCreated);
      }
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
      state.invitedMemo = Array.isArray(res.invited_memo) ? res.invited_memo : [];
      renderAdminView(res);
    } else {
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
  const items = [];
  if (ev.mode === 'single' && ev.dates[0]) {
    items.push({ label: '日時', val: formatDateLabel(ev.dates[0].date, ev.dates[0].time) });
  } else {
    items.push({ label: '形式', val: `複数候補日（${ev.dates.length}日程）` });
  }
  items.push({ label: '場所', val: ev.location || '未定（幹事へ確認）' });
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
  $('view-guest').classList.remove('hidden');

  const { event: ev, counts, my_response: myRes } = data;

  $('guest-title').textContent = ev.title;
  renderEventMeta($('guest-meta'), $('guest-note-box'), ev);

  const badges = [];
  if (state.forcePreview) badges.push('<span class="badge badge-admin">招待画面プレビュー中</span>');
  if (ev.is_closed) {
    badges.push('<span class="badge badge-closed">受付終了</span>');
  } else if (ev.mode === 'single') {
    const okCnt = counts[ev.dates[0].id]?.ok || 0;
    if (okCnt >= ev.capacity) {
      badges.push('<span class="badge badge-full">満員（キャンセル待ち）</span>');
    } else {
      badges.push(`<span class="badge badge-open">募集中（残り${ev.capacity - okCnt}枠）</span>`);
    }
  } else {
    badges.push('<span class="badge badge-open">日程調整中</span>');
  }
  $('guest-badges').innerHTML = badges.join('');

  const statusArea = $('guest-status-area');
  if (ev.mode === 'single') {
    const dId = ev.dates[0].id;
    const c = counts[dId] || { ok: 0, maybe: 0, ng: 0 };
    const rem = Math.max(0, ev.capacity - c.ok);
    statusArea.innerHTML = `
      <div class="count-box-grid">
        <div class="count-box ok">
          <span class="count-num">${c.ok} / ${ev.capacity}</span>
          <span class="count-lbl">参加</span>
        </div>
        <div class="count-box maybe">
          <span class="count-num">${c.maybe}名</span>
          <span class="count-lbl">保留・調整中</span>
        </div>
        <div class="count-box rem">
          <span class="count-num">${rem === 0 ? '満員' : 'あと' + rem + '名'}</span>
          <span class="count-lbl">${rem === 0 ? 'キャンセル待ち' : '残り枠'}</span>
        </div>
      </div>
    `;
  } else {
    statusArea.innerHTML = ev.dates.map(d => {
      const c = counts[d.id] || { ok: 0, maybe: 0, ng: 0 };
      const rem = Math.max(0, ev.capacity - c.ok);
      const badgeHtml = rem === 0
        ? '<span class="badge badge-full">満員</span>'
        : `<span class="badge badge-open">残り${rem}枠</span>`;
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

  ev.dates.forEach(d => {
    const c = counts[d.id] || { ok: 0, maybe: 0, ng: 0 };
    const prevAns = myRes?.answers?.[d.id] || null;
    const isFullLocked = ev.auto_close && c.ok >= ev.capacity && prevAns !== 'ok';
    const currentVal = state.guestAnswers[d.id] || '';

    const block = document.createElement('div');
    block.className = ev.mode === 'multi' ? 'multi-day-item' : 'form-group';

    const headerHtml = ev.mode === 'multi'
      ? `
        <div class="multi-day-head">
          <span class="multi-day-label">${escapeHtml(formatDateLabel(d.date, d.time))}</span>
          ${isFullLocked ? '<span class="badge badge-full">満員（キャンセル待ち可）</span>' : ''}
        </div>
      `
      : `<label>参加可否 <span class="req">必須</span>${isFullLocked ? ' <span class="badge badge-full">現在満員・保留でキャンセル待ち</span>' : ''}</label>`;

    block.innerHTML = `
      ${headerHtml}
      <div class="choice-grid" data-date-id="${escapeHtml(d.id)}">
        <button type="button" class="choice-btn ${currentVal === 'ok' ? 'selected-ok' : ''}" data-val="ok" ${ev.is_closed || isFullLocked ? 'disabled' : ''}>
          ◯ 参加
          <small>${isFullLocked ? '満員' : 'いけます'}</small>
        </button>
        <button type="button" class="choice-btn ${currentVal === 'maybe' ? 'selected-maybe' : ''}" data-val="maybe" ${ev.is_closed ? 'disabled' : ''}>
          △ 保留
          <small>${isFullLocked ? 'キャンセル待ち' : '調整中'}</small>
        </button>
        <button type="button" class="choice-btn ${currentVal === 'ng' ? 'selected-ng' : ''}" data-val="ng" ${ev.is_closed ? 'disabled' : ''}>
          ✕ 不参加
          <small>今回は見送り</small>
        </button>
      </div>
    `;

    block.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        state.guestAnswers[d.id] = val;
        block.querySelectorAll('.choice-btn').forEach(b => {
          b.classList.remove('selected-ok', 'selected-maybe', 'selected-ng');
        });
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

  if (!name) {
    showToast('名前を入力してください');
    return;
  }

  for (const d of ev.dates) {
    if (!state.guestAnswers[d.id]) {
      showToast('すべての日程で ◯ / △ / ✕ を選択してください');
      return;
    }
  }

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
    showToast('回答を送信しました！');
    await loadEventAndRender();
  } catch (err) {
    alert('送信エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

/* =====================================================
   ビュー3：幹事専用管理画面
===================================================== */
function renderAdminView(data) {
  hideAllViews();
  $('view-admin').classList.remove('hidden');

  const { event: ev, counts, responses = [] } = data;
  addMyEventHistory({ ...ev, admin_key: state.currentAdminKey });

  $('admin-title').textContent = ev.title;
  renderEventMeta($('admin-meta'), $('admin-note-box'), ev);

  const stBadge = $('admin-status-badge');
  if (ev.is_closed) {
    stBadge.textContent = '手動締切中';
    stBadge.className = 'badge badge-closed';
  } else if (ev.mode === 'single' && (counts[ev.dates[0].id]?.ok || 0) >= ev.capacity) {
    stBadge.textContent = '満員到達';
    stBadge.className = 'badge badge-full';
  } else {
    stBadge.textContent = '受付中';
    stBadge.className = 'badge badge-open';
  }

  $('toggle-manual-close').checked = Boolean(ev.is_closed);
  $('admin-edit-capacity').value = ev.capacity;
  $('admin-edit-location').value = ev.location;
  $('admin-edit-auto-close').checked = Boolean(ev.auto_close);
  if ($('admin-edit-notify-mode')) {
    $('admin-edit-notify-mode').value = ev.notify_mode || 'all';
  }
  $('admin-edit-note').value = ev.note;

  renderAdminResponses(ev, counts, responses);
  setupConfirmSection(ev, counts);
  renderInvitedMemoList(responses);
}

function renderAdminResponses(ev, counts, responses) {
  const summaryEl = $('admin-summary-area');
  const listEl = $('admin-responses-area');

  if (ev.mode === 'single') {
    const dId = ev.dates[0].id;
    const c = counts[dId] || { ok: 0, maybe: 0, ng: 0 };
    const rem = Math.max(0, ev.capacity - c.ok);

    summaryEl.innerHTML = `
      <div class="count-box-grid">
        <div class="count-box ok">
          <span class="count-num">${c.ok} / ${ev.capacity}</span>
          <span class="count-lbl">参加</span>
        </div>
        <div class="count-box maybe">
          <span class="count-num">${c.maybe}名</span>
          <span class="count-lbl">保留</span>
        </div>
        <div class="count-box rem">
          <span class="count-num">${rem === 0 ? '満員' : 'あと' + rem + '名'}</span>
          <span class="count-lbl">不参加 ${c.ng}名</span>
        </div>
      </div>
    `;

    if (responses.length === 0) {
      listEl.innerHTML = '<p class="muted-text">まだ回答はありません。上のボタンからLINEでフレンドを招待しましょう。</p>';
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
    summaryEl.innerHTML = ev.dates.map(d => {
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

    const headCols = ev.dates.map(d => `<th>${escapeHtml(formatDateLabel(d.date, d.time))}</th>`).join('');
    const bodyRows = responses.map((r, idx) => {
      const cells = ev.dates.map(d => {
        const ans = r.answers[d.id] || '';
        const cls = ans ? `mark-${ans}` : '';
        return `<td class="${cls}">${markText[ans] || '-'}</td>`;
      }).join('');
      return `
        <tr>
          <td>
            <strong>${escapeHtml(r.name)}</strong>
            <div class="resp-time">${escapeHtml(formatShortTimestamp(r.updated_at))}</div>
          </td>
          ${cells}
          <td style="text-align:left;min-width:120px;">${escapeHtml(r.condition_memo || '-')}</td>
          <td><button type="button" class="btn-text-danger btn-del-matrix" data-idx="${idx}">削除</button></td>
        </tr>
      `;
    }).join('');

    tableWrap.innerHTML = `
      <table class="matrix-table">
        <thead>
          <tr>
            <th>名前</th>
            ${headCols}
            <th>条件メモ</th>
            <th>操作</th>
          </tr>
        </thead>
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
   声かけ済みメモ（幹事専用）
===================================================== */
function normalizeName(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function renderInvitedMemoList(responses) {
  const container = $('invited-memo-list');
  const answeredNames = new Set(responses.map(r => normalizeName(r.name)));

  if (state.invitedMemo.length === 0) {
    container.innerHTML = '<p class="muted-text" style="margin:0;">まだ声かけメモはありません。</p>';
    return;
  }

  container.innerHTML = '';
  state.invitedMemo.forEach(item => {
    const autoMatched = answeredNames.has(normalizeName(item.name));
    const isDone = autoMatched || Boolean(item.done);

    const row = document.createElement('div');
    row.className = 'memo-row';
    row.innerHTML = `
      <div class="memo-row-left">
        <button type="button" class="memo-status-btn ${isDone ? 'memo-status-done' : 'memo-status-wait'}">
          ${autoMatched ? '回答済（自動）' : (isDone ? '確認済' : '未返事')}
        </button>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.note ? `<span class="memo-note-text">${escapeHtml(item.note)}</span>` : ''}
      </div>
      <button type="button" class="btn-text-danger btn-del-memo">削除</button>
    `;

    row.querySelector('.memo-status-btn').addEventListener('click', async () => {
      if (autoMatched) {
        showToast('回答一覧に一致するため自動で回答済になっています');
        return;
      }
      item.done = !item.done;
      await persistInvitedMemo();
    });

    row.querySelector('.btn-del-memo').addEventListener('click', async () => {
      state.invitedMemo = state.invitedMemo.filter(m => m.id !== item.id);
      await persistInvitedMemo();
    });

    container.appendChild(row);
  });
}

async function handleAddInvitedMemo(e) {
  e.preventDefault();
  const name = $('memo-friend-name').value.trim();
  const note = $('memo-friend-note').value.trim();
  if (!name) return;

  state.invitedMemo.push({
    id: 'm_' + Date.now(),
    name,
    note,
    done: false
  });
  $('memo-friend-name').value = '';
  $('memo-friend-note').value = '';
  await persistInvitedMemo();
}

async function persistInvitedMemo() {
  renderInvitedMemoList(state.eventData?.responses || []);
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      line_user_id: state.lineProfile?.userId || '',
      updates: { invited_memo: state.invitedMemo }
    });
    if (!res.ok) throw new Error(res.error);
    showToast('声かけメモを保存しました');
  } catch (err) {
    alert('保存エラー: ' + err.message);
  }
}

/* =====================================================
   幹事設定の保存・締切
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
  const capacity = Number($('admin-edit-capacity').value) || 4;
  const location = $('admin-edit-location').value.trim();
  const autoClose = $('admin-edit-auto-close').checked;
  const notifyMode = $('admin-edit-notify-mode') ? $('admin-edit-notify-mode').value : 'all';
  const note = $('admin-edit-note').value.trim();

  showLoading('設定を保存中...');
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      line_user_id: state.lineProfile?.userId || '',
      updates: {
        capacity,
        location,
        auto_close: autoClose,
        notify_mode: notifyMode,
        note
      }
    });
    if (!res.ok) throw new Error(res.error);
    if (location) saveLocationToHistory(location);
    showToast('設定を保存しました');
    await loadEventAndRender();
  } catch (err) {
    alert('保存エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);