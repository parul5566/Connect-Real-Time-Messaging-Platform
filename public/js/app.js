import API from './api.js';
import { connectSocket, getSocket, disconnectSocket } from './socket.js';
import { esc, avatarHTML, timeAgo, toast, debounce, icon, iconBtn, modal, closeModal, menu, closeMenu, confirmAction } from './helpers.js';
import * as Chats from './views/chats.js';
import * as Calls from './views/calls.js';
import * as Settings from './views/settings.js';

export const state = {
  tab: 'chats',
  conversations: [],
  selected: null,
  selectedChannel: null,
  selectedCommunity: null,
  filter: 'All',
  query: '',
  replyTo: null,
  typingUsers: new Set(),
  onlineUsers: new Set(),
  authPhone: null,
  pendingVerify: null
};

export const $ = s => document.querySelector(s);

// ---------- Rail ----------
export function renderRail() {
  const unread = state.conversations.reduce((n, c) => n + (c.muted ? 0 : (c.unread || 0)), 0);
  const tabs = [
    ['chats', 'chat', 'Chats'],
    ['updates', 'updates', 'Updates'],
    ['channels', 'megaphone', 'Channels'],
    ['communities', 'community', 'Communities'],
    ['calls', 'call', 'Calls']
  ];
  $('#rail').innerHTML = `<div class="brand">${icon('chat')}</div>`
    + tabs.map(([t, i, l]) => `<button class="navitem ${state.tab === t ? 'active' : ''}" data-nav="${t}" aria-label="${l}" title="${l}">${icon(i)}<span class="label">${l}</span>${t === 'chats' && unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`).join('')
    + `<button class="navitem ai-nav ${state.tab === 'ai' ? 'active' : ''}" data-nav="ai" aria-label="AI Studio" title="AI Studio">${icon('spark')}<span class="label">AI Studio</span></button>`
    + `<div class="spacer"></div>`
    + `<button class="navitem desktoponly" data-act="theme" aria-label="Toggle theme">${icon(document.body.classList.contains('dark') ? 'sun' : 'moon')}</button>`
    + `<button class="navitem ${state.tab === 'settings' ? 'active' : ''}" data-nav="settings" aria-label="Settings">${icon('settings')}<span class="label">Settings</span></button>`;
  $('#rail').querySelectorAll('[data-nav]').forEach(b => b.onclick = () => navigate(b.dataset.nav));
  $('#rail').querySelector('[data-act="theme"]').onclick = () => {
    document.body.classList.toggle('dark');
    Settings.applyLook();
  };
}

// ---------- Navigation ----------
export function navigate(tab) {
  closeModal(); closeMenu();
  state.tab = tab;
  $('#app').classList.remove('detail');
  renderRail();
  renderSide();
  const views = {
    chats: () => Chats.open(state.selected) /* noop — main shows empty state */ && renderMain(),
    updates: () => import('./views/updates.js').then(m => m.render()),
    channels: () => import('./views/channels.js').then(m => m.render()),
    communities: () => import('./views/communities.js').then(m => m.render()),
    calls: () => Calls.render(),
    settings: () => Settings.render(),
    ai: () => import('./views/ai.js').then(m => m.render())
  };
  (views[tab] || views.chats)();
}

function renderMain() {
  $('#main').innerHTML = `<div class="page"><div class="pageinner emptystate">
    ${icon('chat')}<h2>Connect — messaging that keeps up</h2>
    <p class="muted">Select a chat on the left, or start a new conversation.</p>
  </div></div>`;
}

export function renderSide() {
  switch (state.tab) {
    case 'chats': return Chats.renderSide();
    case 'updates': return import('./views/updates.js').then(m => m.renderSide());
    case 'channels': return import('./views/channels.js').then(m => m.renderSide());
    case 'communities': return import('./views/communities.js').then(m => m.renderSide());
    default: return $('#side').innerHTML = '';
  }
}

export function reveal() { $('#app').classList.add('detail'); }

export function back() {
  $('#app').classList.remove('detail');
  state.selected = null;
  state.selectedChannel = null;
  state.selectedCommunity = null;
  renderSide();
  navigate(state.tab);
}

// ---------- Refresh ----------
export async function refreshConversations() {
  try {
    state.conversations = await API.get('/api/conversations');
    renderRail();
    if (state.tab === 'chats' && !state.selected) renderSide();
    if (state.tab === 'chats' && state.selected) Chats.renderSide();
  } catch (e) { console.error(e); }
}

// ---------- Auth / boot ----------
export async function start() {
  if (!API.token) return showAuth();
  try {
    const me = await API.get('/api/users/me');
    API.user = me;
    await import('./views/settings.js').then(async m => {
      await m.hydrate();
    });
    enterApp();
  } catch {
    API.logout();
    showAuth();
  }
}

export function enterApp() {
  connectSocket({
    'message:new': m => Chats.onIncoming(m),
    'message:update': m => Chats.onMessageUpdate(m),
    'presence': ({ userId, online }) => {
      if (online) state.onlineUsers.add(userId); else state.onlineUsers.delete(userId);
      Chats.updatePresence(userId, online);
    },
    'typing': d => Chats.onTyping({ ...d, typing: true }),
    'typing:stop': d => Chats.onTyping({ ...d, typing: false }),
    'conversation:update': () => refreshConversations(),
    'receipt:update': d => Chats.onRead(d),
    'status:new': () => { if (state.tab === 'updates') import('./views/updates.js').then(m => { m.render(); m.renderSide(); }); },
    'channel:post': () => { if (state.tab === 'channels') import('./views/channels.js').then(m => { m.render(); m.renderSide(); }); }
  });
  Calls.bind(getSocket());
  refreshConversations().then(() => {
    renderRail();
    navigate('chats');
  });
}

export function showAuth() {
  disconnectSocket();
  import('./views/auth.js').then(m => m.render());
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeMenu(); }
});

start();
