/* Connect — core client: API + socket + state + helpers */
window.Connect = (function () {
  const state = {
    token: localStorage.getItem('connect_token') || null,
    me: null,
    conversations: [],
    activeConv: null,
    messages: {},           // convId -> [messages]
    online: new Set(),
    typing: new Map(),      // convId -> Map(userId -> timeout)
    reply: null,
    editing: null,
    settings: {},
    blocked: [],
    routes: { tab: 'chats' }
  };

  // ---------- helpers ----------
  const E = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
  function avatarHTML(u, cls = '') {
    if (!u) return '';
    const img = u.avatar_url ? `<img src="${E(u.avatar_url)}" alt="">` : E(u.avatar_color ? initials(u.name) : initials(u.name));
    return `<div class="avatar ${cls}" style="--avatar:${E(u.avatar_color || '#b9d9d0')}">${img}</div>`;
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return hhmm;
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function clock(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, ms = 3200) {
    $('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.role = 'status'; el.textContent = msg;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const res = await fetch('/api' + path, {
      ...opts,
      headers,
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- theme ----------
  function applyTheme() {
    const t = state.settings.theme || localStorage.getItem('connect_theme');
    document.body.classList.toggle('dark', t === 'dark');
  }
  function setTheme(dark) {
    state.settings.theme = dark ? 'dark' : 'light';
    localStorage.setItem('connect_theme', dark ? 'dark' : 'light');
    applyTheme();
  }
  function applyPrefs() {
    applyTheme();
    if (state.settings.wallpaper) document.documentElement.style.setProperty('--wall', state.settings.wallpaper);
    if (state.settings.font_size) {
      let s = $('#fontsize-style');
      if (!s) { s = document.createElement('style'); s.id = 'fontsize-style'; document.head.append(s); }
      s.textContent = `.msgtext{font-size:${state.settings.font_size}px}`;
    }
  }
  async function saveSettings(patch) {
    Object.assign(state.settings, patch);
    localStorage.setItem('connect_settings', JSON.stringify(state.settings));
    applyPrefs();
    try { await api('/users/me/settings', { method: 'PUT', body: state.settings }); } catch { }
  }

  // ---------- socket ----------
  let socket = null;
  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { token: state.token } });
    socket.on('connect', () => { flushOutbox(); loadConversations(); });
    socket.on('presence', ({ userId, online, at }) => {
      if (online) state.online.add(userId); else state.online.delete(userId);
      document.dispatchEvent(new CustomEvent('presence', { detail: { userId, online, at } }));
    });
    socket.on('typing', ({ userId, conversationId, typing }) => {
      if (!state.typing.has(conversationId)) state.typing.set(conversationId, new Map());
      const m = state.typing.get(conversationId);
      clearTimeout(m.get(userId));
      if (typing) {
        m.set(userId, setTimeout(() => m.delete(userId), 4000));
      }
      document.dispatchEvent(new CustomEvent('typing', { detail: { userId, conversationId, typing } }));
    });
    socket.on('message:new', (msg) => {
      const arr = state.messages[msg.conversation_id] || (state.messages[msg.conversation_id] = []);
      if (!arr.some(x => x.id === msg.id)) arr.push(msg);
      if (state.reply && msg.reply_to_id === state.reply.id) { /* quoted ok */ }
      document.dispatchEvent(new CustomEvent('message:new', { detail: msg }));
    });
    socket.on('message:update', (u) => {
      const arr = state.messages[u.conversation_id];
      if (arr) {
        const m = arr.find(x => x.id === u.id);
        if (m) Object.assign(m, u);
      }
      document.dispatchEvent(new CustomEvent('message:update', { detail: u }));
    });
    socket.on('reaction:update', ({ id, reactions }) => {
      for (const arr of Object.values(state.messages)) {
        const m = arr.find(x => x.id === id);
        if (m) m.reactions = reactions;
      }
      document.dispatchEvent(new CustomEvent('reaction:update', { detail: { id, reactions } }));
    });
    socket.on('poll:update', ({ id, votes }) => {
      for (const arr of Object.values(state.messages)) {
        const m = arr.find(x => x.id === id);
        if (m) m.poll_votes = votes;
      }
      document.dispatchEvent(new CustomEvent('poll:update', { detail: { id, votes } }));
    });
    socket.on('receipts:update', (d) => document.dispatchEvent(new CustomEvent('receipts:update', { detail: d })));
    socket.on('conversation:update', () => loadConversations());
    socket.on('status:update', () => document.dispatchEvent(new CustomEvent('status:update')));
    socket.on('channels:update', () => document.dispatchEvent(new CustomEvent('channels:update')));
    socket.on('channel:post', (d) => document.dispatchEvent(new CustomEvent('channel:post', { detail: d })));
    // calls
    for (const ev of ['call:ring', 'call:accepted', 'call:declined', 'call:cancelled', 'call:ended', 'call:sdp', 'call:ice']) {
      socket.on(ev, (d) => document.dispatchEvent(new CustomEvent(ev, { detail: d })));
    }
  }

  // outbox for offline sends
  const outbox = [];
  function queueOutbox(payload) { outbox.push(payload); localStorage.setItem('connect_outbox', JSON.stringify(outbox)); }
  async function flushOutbox() {
    while (outbox.length) {
      const p = outbox[0];
      try { await api('/messages', { method: 'POST', body: p }); outbox.shift(); localStorage.setItem('connect_outbox', JSON.stringify(outbox)); }
      catch { break; }
    }
  }
  try { outbox.push(...JSON.parse(localStorage.getItem('connect_outbox') || '[]')); } catch { }

  function isTyping(convId, userId) {
    return state.typing.get(+convId)?.has(userId);
  }

  return { state, api, E, $, $$, initials, avatarHTML, timeAgo, clock, toast, fmtSize, fmtDur, connectSocket, socket: () => socket, setTheme, applyPrefs, saveSettings, queueOutbox, isTyping, applyTheme };
})();
