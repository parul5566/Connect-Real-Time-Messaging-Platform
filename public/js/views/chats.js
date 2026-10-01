import API from '../api.js';
import { esc, avatarHTML, timeAgo, toast, debounce, icon, iconBtn, modal, closeModal, menu, closeMenu, confirmAction, formatBytes } from '../helpers.js';
import { state, $, navigate, renderRail, refreshConversations, reveal, back } from '../app.js';
import { getSocket } from '../socket.js';
import * as Info from './info.js';

let typingTimer = null;
let loadingOlder = false;

export async function renderSide() {
  const list = filtered();
  const counts = {
    All: state.conversations.length,
    Unread: state.conversations.filter(c => c.unread && !c.muted).length,
    Favorites: state.conversations.filter(c => c.favorite).length,
    Groups: state.conversations.filter(c => c.type === 'group').length
  };
  $('#side').innerHTML = `
    <div class="sidehead"><div class="between"><h1>Chats</h1>
      <div class="actions">${iconBtn('plus', '', 'New chat')}</div></div></div>
    <div class="search"><input placeholder="Search or start a new chat" aria-label="Search chats" id="search" value="${esc(state.query)}"></div>
    <div class="chips">
      ${Object.entries(counts).map(([k, n]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${k}${n ? ` <b>${n}</b>` : ''}</button>`).join('')}
    </div>
    <div class="list">
      ${list.length ? list.map(c => `
        <button class="chatrow ${state.selected === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-conv="${c.id}">
          ${avatarHTML(c)}<div class="metacol">
            <div class="between"><strong>${esc(c.display_name)}</strong><small class="muted">${c.last_at ? timeAgo(c.last_at) : ''}</small></div>
            <p class="muted preview">${c.typing ? `<b>${esc(c.typing)} is typing…</b>` : lastPreview(c)}</p>
          </div>
          ${c.pinned ? icon('pin') : ''}${c.muted ? icon('bell') : ''}${c.unread ? `<span class="dot">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
        </button>`).join('') : '<div class="empty">No chats yet. Start a new conversation!</div>'}
    </div>`;
  $('#side').querySelector('.actions .ib').onclick = newChatModal;
  const s = $('#side').querySelector('#search');
  s.oninput = debounce(() => { state.query = s.value; renderSide(); }, 200);
  $('#side').querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; renderSide(); });
  $('#side').querySelectorAll('[data-conv]').forEach(b => b.onclick = () => open(+b.dataset.conv));
  $('#side').querySelectorAll('[data-conv]').forEach(b => b.oncontextmenu = e => { e.preventDefault(); rowMenu(+b.dataset.conv, e); });
}

function filtered() {
  let l = state.conversations;
  if (state.filter === 'Unread') l = l.filter(c => c.unread && !c.muted);
  else if (state.filter === 'Favorites') l = l.filter(c => c.favorite);
  else if (state.filter === 'Groups') l = l.filter(c => c.type === 'group');
  const q = state.query.trim().toLowerCase();
  if (q) l = l.filter(c => c.display_name.toLowerCase().includes(q) || (c.last_body || '').toLowerCase().includes(q));
  return l.sort((a, b) => (b.pinned - a.pinned) || new Date(b.last_at || 0) - new Date(a.last_at || 0));
}

function lastPreview(c) {
  if (!c.last_body) return c.type === 'group' ? 'Group' : 'Say hi 👋';
  const iconMap = { image: '📷 Photo', video: '🎬 Video', audio: '🎙️ Voice message', file: '📄 Document', poll: '📊 Poll' };
  const prefix = c.last_sender ? `${c.last_sender === API.user.name ? 'You' : c.last_sender}: ` : '';
  return esc(prefix + (iconMap[c.last_type] || c.last_body));
}

function rowMenu(convId, e) {
  const c = state.conversations.find(x => x.id === convId);
  menu(e.clientX, e.clientY, [
    { label: c.pinned ? 'Unpin chat' : 'Pin chat', fn: async () => { await API.patch(`/api/conversations/${convId}/prefs`, { pinned: !c.pinned }); refreshConversations(); } },
    { label: c.muted ? 'Unmute' : 'Mute notifications', fn: async () => { await API.patch(`/api/conversations/${convId}/prefs`, { muted: !c.muted }); refreshConversations(); } },
    { label: c.archived ? 'Unarchive' : 'Archive', fn: async () => { await API.patch(`/api/conversations/${convId}/prefs`, { archived: !c.archived }); refreshConversations(); if (state.selected === convId) { state.selected = null; back(); } } },
    { label: c.favorite ? 'Remove favorite' : 'Add to favorites', fn: async () => { await API.patch(`/api/conversations/${convId}/prefs`, { favorite: !c.favorite }); refreshConversations(); } },
    { label: 'Mark as read', fn: async () => { await API.post(`/api/conversations/${convId}/read`); refreshConversations(); } },
    ...(c.type === 'direct' ? [] : [{ label: 'Group info', fn: () => Info.show(convId) }]),
    { label: 'Delete chat', danger: true, fn: () => confirmAction('Delete chat?', 'This clears the conversation for you.', async () => { await API.patch(`/api/conversations/${convId}/prefs`, { archived: true }); if (state.selected === convId) { state.selected = null; back(); } refreshConversations(); }) }
  ]);
}

export async function open(convId) {
  state.selected = convId;
  state.replyTo = null;
  state.editing = null;
  state.typingUsers = new Set();
  reveal();
  renderSide();
  const c = state.conversations.find(x => x.id === convId);
  if (!c) return;
  $('#main').innerHTML = `
    <header class="chathead">
      <button class="ib back onlymobile" aria-label="Back">${icon('back')}</button>
      ${avatarHTML(c, 'small')}
      <div style="flex:1;cursor:pointer" id="openinfo"><h3>${esc(c.display_name)}</h3><small class="muted" id="headmeta">${headMeta(c)}</small></div>
      <div class="actions">
        ${iconBtn('search', '', 'Search in chat')}
        ${c.type === 'direct' ? iconBtn('call', '', 'Voice call') : ''}
        ${c.type === 'direct' ? iconBtn('video', '', 'Video call') : ''}
        ${iconBtn('dots', '', 'Chat menu')}
      </div>
    </header>
    <div class="msgs" id="msgs"></div>
    <div class="replybar hide" id="replybar"></div>
    <div class="composer">
      <form id="msgform" class="row">
        ${iconBtn('plus', '', 'Attach')}
        <input autocomplete="off" placeholder="Type a message" aria-label="Type a message" id="msginput">
        <button type="button" class="ib" id="micbtn" aria-label="Record voice note">${icon('mic')}</button>
        <button class="ib send" aria-label="Send">${icon('send')}</button>
      </form>
    </div>`;
  $('#main').querySelector('.chathead .back').onclick = () => { state.selected = null; back(); };
  $('#main').querySelector('#openinfo').onclick = () => Info.show(convId);
  const acts = $('#main').querySelectorAll('.actions .ib');
  acts[0].onclick = () => searchInChat();
  if (c.type === 'direct') {
    acts[1].onclick = () => startCall(convId, false);
    acts[2].onclick = () => startCall(convId, true);
    acts[3].onclick = e => chatMenu(convId, e);
  } else acts[1].onclick = e => chatMenu(convId, e);
  bindComposer(c);
  await loadMessages(convId);
  markRead(convId);
}

function startCall(convId, video) {
  const c = state.conversations.find(x => x.id === convId);
  import('./calls.js').then(m => m.start(c.other_id, video));
}

function headMeta(c) {
  if (c.type === 'group') return `${c.members.length} members`;
  return c.other_online ? 'online' : c.other_last_seen ? `last seen ${timeAgo(c.other_last_seen)}` : 'offline';
}

export function updateHeaderMeta(c) {
  const el = document.getElementById('headmeta');
  if (el) el.textContent = headMeta(c);
}

export function updatePresence(userId, online) {
  const c = state.conversations.find(x => x.other_id === userId);
  if (c) { c.other_online = online; if (state.selected === c.id) updateHeaderMeta(c); }
}

export function chatMenu(convId, e) {
  const c = state.conversations.find(x => x.id === convId);
  menu(e.clientX, e.clientY, [
    { label: c.type === 'group' ? 'Group info' : 'Contact info', fn: () => Info.show(convId) },
    ...(c.type === 'direct' ? [{ label: 'Block contact', danger: true, fn: () => Info.show(convId) }] : []),
    { label: 'Clear messages', danger: true, fn: () => confirmAction('Clear messages?', 'All messages in this chat will be deleted for you.', async () => { await API.del(`/api/conversations/${convId}/messages`); open(convId); }) }
  ]);
}

export async function loadMessages(convId, before) {
  const box = document.getElementById('msgs');
  if (!box) return;
  const keep = box.scrollHeight;
  let msgs = await API.get(`/api/conversations/${convId}/messages${before ? `?before=${before}` : ''}`);
  msgs = msgs.reverse();
  if (before) {
    box.insertAdjacentHTML('afterbegin', msgs.map(renderMsg).join(''));
    box.scrollTop = box.scrollHeight - keep;
  } else {
    box.innerHTML = msgs.length ? msgs.map(renderMsg).join('') : '<div class="empty">No messages yet. Say hello! 👋</div>';
    box.scrollTop = box.scrollHeight;
    box.onscroll = debounce(() => {
      if (box.scrollTop < 60 && !loadingOlder && msgs.length) {
        loadingOlder = true;
        loadMessages(convId, msgs[0].id).then(() => { loadingOlder = false; });
      }
    }, 80);
  }
  bindMsgActions(convId);
}

function renderMsg(m) {
  if (m.type === 'system') return `<div class="systemmsg">${esc(m.body)}</div>`;
  const out = m.sender_id === API.user.id;
  const reactions = Object.entries(m.reactions || {});
  return `<div class="msgrow ${out ? 'out' : 'other'}" data-msg="${m.id}">
    ${!out ? `<div class="msgavatar">${avatarHTML({ name: m.sender_name, avatar_color: m.sender_color }, 'xsmall')}</div>` : ''}
    <div class="bubble ${out ? 'out' : ''} ${m.type === 'deleted' ? 'deleted' : ''}" data-id="${m.id}">
      ${!out ? `<b class="sender" style="color:${esc(m.sender_color || 'var(--accent)')}">${esc(m.sender_name || '')}</b>` : ''}
      ${m.reply_to ? `<div class="quoted"><b>${esc(m.reply_to.sender_name || '')}</b><span>${esc((m.reply_to.body || '').slice(0, 80))}</span></div>` : ''}
      ${body(m)}
      <small class="meta">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        ${m.forwarded ? '· forwarded' : ''}${m.edited ? ' · edited' : ''}</small>
      ${reactions.length ? `<div class="reactions">${reactions.map(([r, users]) => `<span class="react ${users.includes(API.user.id) ? 'mine' : ''}" data-react="${esc(r)}" data-msg-id="${m.id}">${esc(r)} ${users.length}</span>`).join('')}</div>` : ''}
    </div></div>`;
}

function body(m) {
  if (m.type === 'deleted') return '<p class="body muted"><i>This message was deleted</i></p>';
  if (m.type === 'system') return null;
  if (m.type === 'image') return `<img class="media" src="${esc(m.media_path)}" alt="${esc(m.body || 'image')}" loading="lazy">` + (m.body ? `<p class="body">${esc(m.body)}</p>` : '');
  if (m.type === 'video') return `<video class="media" src="${esc(m.media_path)}" controls preload="metadata"></video>`;
  if (m.type === 'audio') return `<audio controls src="${esc(m.media_path)}"></audio>`;
  if (m.type === 'file') return `<a class="filecard" href="${esc(m.media_path)}" target="_blank" rel="noopener">${icon('file')}<div><b>${esc(m.media_name || 'Document')}</b><small>${formatBytes(m.media_size || 0)}</small></div></a>`;
  if (m.type === 'poll') return pollHTML(m);
  return `<p class="body">${esc(m.body)}</p>`;
}

function pollHTML(m) {
  const options = m.meta?.options || [];
  const votes = m.poll_votes || {};
  const total = Object.values(votes).reduce((a, b) => a + b.length, 0);
  return `<div class="poll"><b>${esc(m.body)}</b>
    ${options.map((opt, i) => {
      const n = (votes[i] || []).length;
      const mine = m.my_vote === i;
      return `<button class="pollopt ${mine ? 'voted' : ''}" data-vote="${i}" data-msg-id="${m.id}">
        <span>${esc(opt)}</span><span>${total ? Math.round(n / total * 100) : 0}%</span>
        <i style="width:${total ? n / total * 100 : 0}%"></i></button>`;
    }).join('')}
    <small class="muted">${total} vote${total === 1 ? '' : 's'}</small></div>`;
}

function bindMsgActions(convId) {
  const box = document.getElementById('msgs');
  if (!box) return;
  box.querySelectorAll('.bubble:not(.deleted)').forEach(b => {
    b.oncontextmenu = e => { e.preventDefault(); msgMenu(convId, +b.dataset.id, e); };
    let timer;
    b.addEventListener('pointerdown', () => { timer = setTimeout(() => msgMenu(convId, +b.dataset.id, { clientX: e2(b).x, clientY: e2(b).y, preventDefault() {} }), 550); });
    b.addEventListener('pointerup', () => clearTimeout(timer));
    b.addEventListener('pointermove', () => clearTimeout(timer));
  });
  box.querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
    await API.post(`/api/messages/${b.dataset.msgId}/poll-vote`, { option_index: +b.dataset.vote });
    loadMessages(convId);
  });
  box.querySelectorAll('[data-react]').forEach(b => b.onclick = async () => {
    await API.post(`/api/messages/${b.dataset.msgId}/reaction`, { emoji: b.dataset.react });
    loadMessages(convId);
  });
  box.querySelectorAll('img.media').forEach(img => img.onclick = () => lightbox(img.src));
}

function e2(b) {
  const r = b.getBoundingClientRect();
  return { x: r.left + 20, y: r.top };
}

function msgMenu(convId, msgId, e) {
  const mine = document.querySelector(`[data-msg="${msgId}"] .bubble`)?.classList.contains('out');
  menu(e.clientX, e.clientY, [
    { label: 'Reply', fn: () => setReply(convId, msgId) },
    { label: 'React 👍', fn: () => react(convId, msgId, '👍') },
    { label: 'React ❤️', fn: () => react(convId, msgId, '❤️') },
    { label: 'React 😂', fn: () => react(convId, msgId, '😂') },
    { label: 'Forward', fn: () => forwardModal(convId, msgId) },
    { label: 'Copy text', fn: () => { navigator.clipboard?.writeText(document.querySelector(`[data-msg="${msgId}"] .body`)?.textContent || ''); toast('Copied'); } },
    ...(mine ? [{ label: 'Delete for everyone', danger: true, fn: async () => { await API.del(`/api/messages/${msgId}`); loadMessages(convId); } }] : [])
  ]);
}

async function react(convId, msgId, emoji) {
  await API.post(`/api/messages/${msgId}/react`, { emoji });
  loadMessages(convId);
}

function setReply(convId, msgId) {
  const el = document.querySelector(`[data-msg="${msgId}"] .bubble`);
  state.replyTo = msgId;
  const bar = document.getElementById('replybar');
  bar.classList.remove('hide');
  bar.innerHTML = `<div class="row"><div style="flex:1"><b>Replying to ${esc(el?.querySelector('.sender')?.textContent || 'message')}</b>
    <p class="muted">${esc(el?.querySelector('.body')?.textContent?.slice(0, 80) || '')}</p></div>
    <button class="ib" aria-label="Cancel reply">${icon('close')}</button></div>`;
  bar.querySelector('[aria-label="Cancel reply"]').onclick = () => { state.replyTo = null; bar.classList.add('hide'); };
  document.getElementById('msginput')?.focus();
}

function forwardModal(convId, msgId) {
  modal('Forward message to…', (state.conversations || []).map(c => `
    <button class="chatrow" data-fwd="${c.id}">${avatarHTML(c)}<div><strong>${esc(c.display_name)}</strong></div></button>`).join(''));
  document.getElementById('layers').querySelectorAll('[data-fwd]').forEach(b => b.onclick = async () => {
    await API.post(`/api/messages/${msgId}/forward`, { to: [+b.dataset.fwd] });
    closeModal();
    toast('Forwarded');
    if (state.selected === +b.dataset.fwd) loadMessages(+b.dataset.fwd);
  });
}

function lightbox(src) {
  const l = document.getElementById('layers');
  l.insertAdjacentHTML('beforeend', `<div class="lightbox" id="lb"><img src="${esc(src)}" alt="Full image"></div>`);
  l.querySelector('#lb').onclick = () => l.querySelector('#lb').remove();
}

export function searchInChat() {
  modal('Search in chat', `
    <form id="schform"><label class="field">Find messages containing<input id="schq" required placeholder="Search text…"></label>
    <button class="primary full">Search</button></form>`);
  document.getElementById('layers').querySelector('#schform').onsubmit = async e => {
    e.preventDefault();
    const q = e.target.querySelector('#schq').value;
    const convId = state.selected;
    const results = await API.get(`/api/conversations/${convId}/messages?q=${encodeURIComponent(q)}&limit=100`);
    closeModal();
    modal(`Results for “${esc(q)}”`, results.length ? results.map(m => `
      <div class="settingrow"><span class="content"><strong>${esc(m.sender_name || '')}</strong>
      <small>${esc((m.body || '').slice(0, 100))}</small></span><small>${timeAgo(m.created_at)}</small></div>`).join('')
      : '<div class="empty">No messages matched.</div>');
  };
}

function bindComposer(c) {
  const form = document.getElementById('msgform');
  const input = document.getElementById('msginput');
  const socket = getSocket();
  input?.addEventListener('input', () => {
    socket?.emit('typing', { conversationId: c.id, typing: true });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket?.emit('typing', { conversationId: c.id, typing: false }), 2000);
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const m = await API.post('/api/messages', {
        conversation_id: c.id, type: 'text', body: text,
        ...(state.replyTo ? { reply_to_id: state.replyTo } : {})
      });
      if (state.replyTo) { state.replyTo = null; document.getElementById('replybar')?.classList.add('hide'); }
      socket?.emit('message:read', { conversationId: c.id, lastId: m.id });
      loadMessages(c.id);
      refreshConversations();
    } catch (err) { toast(err.message); input.value = text; }
  };
  document.getElementById('micbtn').onclick = () => recordAudio(c.id);
  document.querySelector('.composer [aria-label="Attach"]').onclick = () => attachModal(c.id);
}

function attachModal(convId) {
  modal('Send…', `
    <button class="chatrow" data-att="image">${icon('image')}<div><strong>Photo</strong></div></button>
    <button class="chatrow" data-att="video">${icon('video')}<div><strong>Video</strong></div></button>
    <button class="chatrow" data-att="file">${icon('file')}<div><strong>Document</strong></div></button>
    <button class="chatrow" data-att="poll">${icon('chart')}<div><strong>Poll</strong></div></button>`);
  document.getElementById('layers').querySelectorAll('[data-att]').forEach(b => b.onclick = () => {
    const kind = b.dataset.att;
    if (kind === 'poll') { closeModal(); pollModal(convId); return; }
    closeModal();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '*/*';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      const fd = new FormData();
      fd.append('file', inp.files[0]);
      toast('Uploading…');
      try {
        const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${API.token}` }, body: fd });
        if (!r.ok) throw new Error('Upload failed');
        const up = await r.json();
        await API.post('/api/messages', {
          conversation_id: convId, type: kind === 'file' ? 'file' : kind, body: '',
          media_path: up.media_path
        });
        loadMessages(convId);
        refreshConversations();
      } catch (err) { toast(err.message); }
    };
    inp.click();
  });
}

function pollModal(convId) {
  modal('Create poll', `
    <form id="pollform">
      <label class="field">Question<input id="pollq" required maxlength="200" placeholder="Ask something…"></label>
      <label class="field">Option 1<input class="polloptin" required maxlength="60"></label>
      <label class="field">Option 2<input class="polloptin" required maxlength="60"></label>
      <label class="field">Option 3<input class="polloptin" maxlength="60"></label>
      <button class="primary full">Create poll</button>
    </form>`);
  document.getElementById('layers').querySelector('#pollform').onsubmit = async e => {
    e.preventDefault();
    const options = [...e.target.querySelectorAll('.polloptin')].map(i => i.value.trim()).filter(Boolean);
    if (options.length < 2) { toast('At least two options are required'); return; }
    try {
      await API.post('/api/messages', {
        conversation_id: convId, type: 'poll', body: e.target.querySelector('#pollq').value, options
      });
      closeModal();
      loadMessages(convId);
      refreshConversations();
    } catch (err) { toast(err.message); }
  };
}

function recordAudio(convId) {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Recording not supported in this browser'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      const fd = new FormData();
      fd.append('file', blob, 'voice-note.webm');
      try {
        const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${API.token}` }, body: fd });
        if (!r.ok) throw new Error('Upload failed');
        const up = await r.json();
        await API.post('/api/messages', { conversation_id: convId, type: 'audio', body: '', media_path: up.media_path });
        loadMessages(convId);
      } catch (err) { toast(err.message); }
    };
    rec.start();
    toast('Recording… tap again to send');
    document.getElementById('micbtn').classList.add('rec');
    document.getElementById('micbtn').onclick = () => {
      rec.stop();
      document.getElementById('micbtn').classList.remove('rec');
      document.getElementById('micbtn').onclick = () => recordAudio(convId);
    };
  }).catch(() => toast('Microphone permission denied'));
}

// ---------- Live updates from socket ----------
export function onIncoming(m) {
  const conv = state.conversations.find(c => c.id === m.conversation_id);
  if (m.type === 'system') {
    if (state.selected === m.conversation_id) {
      const box = document.getElementById('msgs');
      if (box) { box.insertAdjacentHTML('beforeend', renderMsg(m)); box.scrollTop = box.scrollHeight; }
    }
    return;
  }
  if (m.sender_id === API.user.id) return;
  if (state.selected === m.conversation_id) {
    const box = document.getElementById('msgs');
    if (box && !box.querySelector(`[data-msg="${m.id}"]`)) {
      box.insertAdjacentHTML('beforeend', renderMsg(m));
      box.scrollTop = box.scrollHeight;
      bindMsgActions(m.conversation_id);
      getSocket()?.emit('message:delivered', { conversationId: m.conversation_id });
      getSocket()?.emit('message:read', { conversationId: m.conversation_id, lastId: m.id });
      markRead(m.conversation_id);
    }
  } else if (conv) {
    conv.unread = (conv.unread || 0) + 1;
    renderSide();
  }
  refreshConversations();
}

export function onMessageUpdate(m) {
  if (state.selected === m.conversation_id) {
    const box = document.getElementById('msgs');
    if (box) {
      const el = box.querySelector(`[data-msg="${m.id}"]`);
      if (el) { el.outerHTML = renderMsg(m); bindMsgActions(m.conversation_id); }
      else if (m.type !== 'deleted') { box.insertAdjacentHTML('beforeend', renderMsg(m)); box.scrollTop = box.scrollHeight; bindMsgActions(m.conversation_id); }
    }
  }
  // reactions & polls arrive without conversation_id
  const convId = m.conversation_id || state.selected;
  refreshConversations();
}

export function onTyping({ userId, conversationId, typing }) {
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || userId === API.user.id) return;
  const member = conv.members?.find(x => x.id === userId);
  const name = member?.name || 'Someone';
  conv.typing = typing ? name : null;
  renderSide();
}

export function onRead() {
  if (state.selected) loadMessages(state.selected);
}

export async function markRead(convId) {
  try { await API.post(`/api/conversations/${convId}/read`); } catch {}
}

export async function newChatModal() {
  const users = await API.get('/api/users');
  modal('New chat', `
    <button class="chatrow" id="newgroup">${icon('community')}<div><strong>New group</strong></div></button>
    ${users.map(u => `<button class="chatrow" data-user="${u.id}">${avatarHTML(u)}<div><strong>${esc(u.name)}</strong><p class="muted">${esc(u.about || '')}</p></div></button>`).join('')}`);
  const l = document.getElementById('layers');
  l.querySelector('#newgroup').onclick = () => newGroupModal(users);
  l.querySelectorAll('[data-user]').forEach(b => b.onclick = async () => {
    const r = await API.post('/api/conversations', { type: 'direct', userId: +b.dataset.user });
    closeModal();
    await refreshConversations();
    open(r.id);
  });
}

function newGroupModal(users) {
  modal('New group', `
    <form id="groupform">
      <label class="field">Group name<input id="gname" required maxlength="60" placeholder="Name your group"></label>
      <label class="field">Members
        <select id="gmembers" multiple size="6">
          ${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
        </select></label>
      <button class="primary full">Create group</button>
    </form>`);
  document.getElementById('layers').querySelector('#groupform').onsubmit = async e => {
    e.preventDefault();
    const sel = e.target.querySelector('#gmembers');
    const memberIds = [...sel.selectedOptions].map(o => +o.value);
    if (memberIds.length < 1) { toast('Pick at least one member'); return; }
    try {
      const r = await API.post('/api/conversations', { type: 'group', name: e.target.querySelector('#gname').value, memberIds });
      closeModal();
      await refreshConversations();
      open(r.id);
    } catch (err) { toast(err.message); }
  };
}
