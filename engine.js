/**
 * 麻雀セット出欠管理システム - フロントエンドエンジン
 * GitHub Pages + Google Apps Script (Spreadsheet DB)
 */

// ★GASを「ウェブアプリ」としてデプロイしたURLをここに貼り付けてください
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-yNrj1KqUzx68Ar-NhDo9FgnetpyMoGdO_zAVdiM1yYHr-KJ0pHoqSVfAsVXailO5/exec';

const STORAGE_MY_EVENTS = 'mj_set_my_events_v1';
const STORAGE_GUEST_NAME = 'mj_set_guest_name_v1';
const STORAGE_MY_RESPONSES = 'mj_set_my_responses_v1';

const state = {
  createMode: 'single', // 'single' | 'multi'
  lastCreated: [],
  currentEventId: null,
  currentAdminKey: null,
  eventData: null,      // GET API の返却オブジェクト全体
  guestAnswers: {},     // { d1: 'ok' | 'maybe' | 'ng' }
  invitedMemo: []       // 幹事専用 声かけ済みメモ配列
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

function getBaseUrl() {
  return window.location.origin + window.location.pathname;
}

function buildGuestUrl(eventId) {
  return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}`;
}

function buildAdminUrl(eventId, adminKey) {
  return `${getBaseUrl()}?id=${encodeURIComponent(eventId)}&key=${encodeURIComponent(adminKey)}`;
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

function openLineShare(message) {
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
   ローカルストレージ操作
===================================================== */
function loadMyEvents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_MY_EVENTS) || '[]');
  } catch {
    return [];
  }
}

function saveMyEvents(list) {
  localStorage.setItem(STORAGE_MY_EVENTS, JSON.stringify(list.slice(0, 50)));
}

function addMyEventHistory(item) {
  const list = loadMyEvents().filter(e => e.id !== item.id);
  list.unshift({
    id: item.id,
    admin_key: item.admin_key,
    mode: item.mode,
    title: item.title,
    location: item.location,
    capacity: item.capacity,
    dates: item.dates,
    created_at: item.created_at || new Date().toISOString()
  });
  saveMyEvents(list);
}

function removeMyEventHistory(eventId) {
  const list = loadMyEvents().filter(e => e.id !== eventId);
  saveMyEvents(list);
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
function isApiConfigured() {
  return Boolean(GAS_API_URL && !GAS_API_URL.includes('YOUR_DEPLOY_ID'));
}

async function apiGet(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GAS_API_URL}?${qs}`, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function apiPost(payload) {
  // CORSプリフライト回避のため text/plain を使用
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
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

function init() {
  bindStaticEvents();

  if (!isApiConfigured()) {
    $('setup-warning').classList.remove('hidden');
  }

  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('id');
  const adminKey = params.get('key');

  if (!eventId) {
    initCreateView();
  } else {
    state.currentEventId = eventId;
    state.currentAdminKey = adminKey || '';
    loadEventAndRender();
  }
}

function bindStaticEvents() {
  $('btn-go-create').addEventListener('click', () => {
    window.location.href = getBaseUrl();
  });

  // 作成モード切替
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.createMode = btn.dataset.mode;
      $('single-dates-area').classList.toggle('hidden', state.createMode !== 'single');
      $('multi-dates-area').classList.toggle('hidden', state.createMode !== 'multi');
    });
  });

  // 定員クイックチップ
  document.querySelectorAll('.cap-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('ev-capacity').value = chip.dataset.cap;
    });
  });

  // 日程行追加
  $('btn-add-single-row').addEventListener('click', () => addSingleDateRow());
  $('btn-add-multi-row').addEventListener('click', () => addMultiDateRow());

  // 作成フォーム送信
  $('create-form').addEventListener('submit', handleCreateSubmit);

  // 一括LINE送信
  $('btn-batch-line-share').addEventListener('click', handleBatchLineShare);

  // 履歴クリア
  $('btn-clear-history').addEventListener('click', () => {
    if (!confirm('この端末に保存されている作成履歴をクリアしますか？（スプレッドシート上のイベント自体は消えません）')) return;
    localStorage.removeItem(STORAGE_MY_EVENTS);
    renderMyEventsHistory();
  });

  // ゲスト画面：条件メモクイックチップ
  document.querySelectorAll('.memo-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const ta = $('guest-condition-memo');
      const addText = chip.dataset.text;
      if (!ta.value.trim()) {
        ta.value = addText;
      } else if (!ta.value.includes(addText)) {
        ta.value = `${ta.value.trim()} / ${addText}`;
      }
    });
  });

  // ゲスト画面：更新・送信
  $('btn-guest-refresh').addEventListener('click', () => loadEventAndRender());
  $('guest-form').addEventListener('submit', handleGuestSubmit);

  // 幹事画面：各種操作
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
    window.open(buildGuestUrl(state.currentEventId), '_blank', 'noopener');
  });

  $('invited-memo-form').addEventListener('submit', handleAddInvitedMemo);
  $('toggle-manual-close').addEventListener('change', handleManualCloseToggle);
  $('btn-admin-save-settings').addEventListener('click', handleAdminSaveSettings);
  $('btn-admin-delete-event').addEventListener('click', handleAdminDeleteEvent);
}

/* =====================================================
   ビュー1：イベント作成画面
===================================================== */
function getTodayStr(offsetDays = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initCreateView() {
  hideAllViews();
  $('view-create').classList.remove('hidden');

  $('single-rows').innerHTML = '';
  $('multi-rows').innerHTML = '';
  addSingleDateRow(getTodayStr(1), '13:00〜19:00');
  addMultiDateRow(getTodayStr(1), '13:00〜');
  addMultiDateRow(getTodayStr(2), '13:00〜');

  renderMyEventsHistory();
}

function addSingleDateRow(defaultDate = '', defaultTime = '') {
  const container = $('single-rows');
  const idx = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'date-row-card';
  div.innerHTML = `
    <div class="date-row-head">
      <span class="row-num">日程 #${idx}</span>
      <button type="button" class="btn-remove-row">削除</button>
    </div>
    <div class="date-row-grid">
      <div>
        <input type="date" class="inp-date" value="${escapeHtml(defaultDate)}" required />
      </div>
      <div>
        <input type="text" class="inp-time" value="${escapeHtml(defaultTime)}" placeholder="時間（例：13:00〜19:00）" />
      </div>
    </div>
    <div class="date-row-loc">
      <input type="text" class="inp-row-location" placeholder="場所をこの日だけ変更する場合に入力（空欄なら上の場所を適用）" />
    </div>
  `;
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

function addMultiDateRow(defaultDate = '', defaultTime = '') {
  const container = $('multi-rows');
  const idx = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'date-row-card';
  div.innerHTML = `
    <div class="date-row-head">
      <span class="row-num">候補 #${idx}</span>
      <button type="button" class="btn-remove-row">削除</button>
    </div>
    <div class="date-row-grid">
      <div>
        <input type="date" class="inp-date" value="${escapeHtml(defaultDate)}" required />
      </div>
      <div>
        <input type="text" class="inp-time" value="${escapeHtml(defaultTime)}" placeholder="時間（例：19:00〜終電）" />
      </div>
    </div>
  `;
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

function renumberRows(container, prefix) {
  Array.from(container.children).forEach((row, i) => {
    const label = row.querySelector('.row-num');
    if (label) label.textContent = `${prefix} #${i + 1}`;
  });
}

async function handleCreateSubmit(e) {
  e.preventDefault();
  if (!isApiConfigured()) {
    showToast('engine.js に GAS_API_URL を設定してください');
    return;
  }

  const baseTitle = $('ev-title').value.trim();
  const baseLocation = $('ev-location').value.trim();
  const capacity = Number($('ev-capacity').value) || 4;
  const autoClose = $('ev-auto-close').checked;
  const note = $('ev-note').value.trim();

  if (!baseTitle) {
    showToast('イベント名を入力してください');
    return;
  }

  const eventsPayload = [];

  if (state.createMode === 'single') {
    const rows = Array.from($('single-rows').children);
    rows.forEach(row => {
      const date = row.querySelector('.inp-date').value.trim();
      const time = row.querySelector('.inp-time').value.trim();
      const rowLoc = row.querySelector('.inp-row-location').value.trim();
      if (!date && !time) return;
      const titleSuffix = rows.length > 1 ? ` (${formatDateLabel(date, '')})` : '';
      eventsPayload.push({
        mode: 'single',
        title: baseTitle + titleSuffix,
        location: rowLoc || baseLocation,
        capacity,
        note,
        auto_close: autoClose,
        dates: [{ date, time }]
      });
    });
  } else {
    const rows = Array.from($('multi-rows').children);
    const dates = rows.map(row => ({
      date: row.querySelector('.inp-date').value.trim(),
      time: row.querySelector('.inp-time').value.trim()
    })).filter(d => d.date || d.time);

    if (dates.length === 0) {
      showToast('候補日を1件以上入力してください');
      return;
    }
    eventsPayload.push({
      mode: 'multi',
      title: baseTitle,
      location: baseLocation,
      capacity,
      note,
      auto_close: autoClose,
      dates
    });
  }

  if (eventsPayload.length === 0) {
    showToast('有効な日程を入力してください');
    return;
  }

  showLoading('イベントを作成中...');
  try {
    const res = await apiPost({ action: 'create_events', events: eventsPayload });
    if (!res.ok) throw new Error(res.error || '作成に失敗しました');

    state.lastCreated = res.created || [];
    state.lastCreated.forEach(ev => addMyEventHistory(ev));

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
  const list = loadMyEvents();
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
      </div>
    `;
    div.querySelector('.btn-hist-line').addEventListener('click', () => {
      openLineShare(buildLineMessage(ev));
    });
    div.querySelector('.btn-hist-copy').addEventListener('click', () => {
      copyToClipboard(buildGuestUrl(ev.id), '招待URLをコピーしました');
    });
    container.appendChild(div);
  });
}

/* =====================================================
   イベントデータ取得＆画面振り分け
===================================================== */
async function loadEventAndRender() {
  if (!isApiConfigured()) {
    showErrorView('engine.js の先頭にある GAS_API_URL が未設定です。');
    return;
  }

  showLoading('イベント情報を読み込み中...');
  try {
    const params = { action: 'get_event', id: state.currentEventId };
    if (state.currentAdminKey) {
      params.key = state.currentAdminKey;
    } else {
      const myRid = getMyResponseId(state.currentEventId);
      if (myRid) params.my_rid = myRid;
    }

    const res = await apiGet(params);
    if (!res.ok) {
      showErrorView(res.error || 'イベントの読み込みに失敗しました。');
      return;
    }

    state.eventData = res;
    if (res.is_admin) {
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

  // バッジ判定
  const badges = [];
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

  // 人数サマリー（名前は絶対に出さない）
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

  // 既存回答または記憶した名前の復元
  state.guestAnswers = {};
  if (myRes) {
    $('guest-name').value = myRes.name;
    $('guest-condition-memo').value = myRes.condition_memo || '';
    state.guestAnswers = { ...(myRes.answers || {}) };
    $('guest-form-title').textContent = '回答を変更する';
    $('btn-guest-submit').textContent = '回答を更新する';
    $('guest-saved-hint').classList.remove('hidden');
  } else {
    const savedName = localStorage.getItem(STORAGE_GUEST_NAME) || '';
    if (savedName && !$('guest-name').value) {
      $('guest-name').value = savedName;
    }
    $('guest-form-title').textContent = '出欠を回答する';
    $('btn-guest-submit').textContent = '回答を送信する';
    $('guest-saved-hint').classList.add('hidden');
  }

  // 締切バナー
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
      response_id: existingRid
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

  // 履歴にも保存（別端末で幹事URLを開いた場合にも対応）
  addMyEventHistory({ ...ev, admin_key: state.currentAdminKey });

  $('admin-title').textContent = ev.title;
  renderEventMeta($('admin-meta'), $('admin-note-box'), ev);

  // ステータスバッジ
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

  // 設定フォーム反映
  $('toggle-manual-close').checked = Boolean(ev.is_closed);
  $('admin-edit-capacity').value = ev.capacity;
  $('admin-edit-location').value = ev.location;
  $('admin-edit-auto-close').checked = Boolean(ev.auto_close);
  $('admin-edit-note').value = ev.note;

  // 集計＋回答者詳細描画
  renderAdminResponses(ev, counts, responses);
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
    // 複数候補日モード：マトリクス表
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
      updates: { invited_memo: state.invitedMemo }
    });
    if (!res.ok) throw new Error(res.error);
    showToast('声かけメモを保存しました');
  } catch (err) {
    alert('保存エラー: ' + err.message);
  }
}

/* =====================================================
   幹事設定の保存・締切・イベント削除
===================================================== */
async function handleManualCloseToggle() {
  const isClosed = $('toggle-manual-close').checked;
  showLoading('受付状態を更新中...');
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
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
  const note = $('admin-edit-note').value.trim();

  showLoading('設定を保存中...');
  try {
    const res = await apiPost({
      action: 'admin_update',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey,
      updates: {
        capacity,
        location,
        auto_close: autoClose,
        note
      }
    });
    if (!res.ok) throw new Error(res.error);
    showToast('設定を保存しました');
    await loadEventAndRender();
  } catch (err) {
    alert('保存エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function handleAdminDeleteEvent() {
  if (!confirm('このイベントとすべての回答データを完全に削除します。よろしいですか？')) return;
  showLoading('イベントを削除中...');
  try {
    const res = await apiPost({
      action: 'admin_delete_event',
      event_id: state.currentEventId,
      admin_key: state.currentAdminKey
    });
    if (!res.ok) throw new Error(res.error);
    removeMyEventHistory(state.currentEventId);
    showToast('イベントを削除しました');
    window.location.href = getBaseUrl();
  } catch (err) {
    alert('削除エラー: ' + err.message);
  } finally {
    hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);