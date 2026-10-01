import API from '../api.js';
import { esc, avatarHTML, toast, modal, closeModal, icon, iconBtn, timeAgo } from '../helpers.js';
import { state, $, navigate } from '../app.js';

let channels = [];

export async function renderSide() {
  try {
    channels = await API.get('/api/channels');
  } catch { channels = []; }
  $('#side').innerHTML = `
    <div class="sidehead"><div class="between"><h1>Channels</h1>
      <div class="actions">${iconBtn('plus', '', 'New channel')}</div></div></div>
    <div class="list">
      ${channels.map(c => `
        <button class="chatrow ${c.unread_count ? 'unread' : ''}" data-ch="${c.id}">
          ${avatarHTML(c)}<div><strong>${esc(c.name)}</strong><p class="muted">${c.followers} followers${c.following ? ' · following' : ''}</p></div>
        </button>`).join('')}
      ${channels.length ? '' : '<div class="empty">Follow a channel to see updates here.</div>'}
    </div>`;
  $('#side').querySelector('.actions .ib').onclick = () => createModal();
  $('#side').querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
    state.selectedChannel = +b.dataset.ch;
    render();
  });
}

export async function render() {
  try { channels = await API.get('/api/channels'); } catch {}
  const c = channels.find(x => x.id === state.selectedChannel) || null;
  let posts = [];
  if (c) { try { posts = (await API.get(`/api/channels/${c.id}/posts`)).reverse(); } catch {} }
  $('#main').innerHTML = `
    ${c ? `<header class="chathead">
      <button class="ib back onlymobile" aria-label="Back">${icon('back')}</button>
      ${avatarHTML(c, 'small')}<div style="flex:1"><h3>${esc(c.name)}</h3><small class="muted">${c.followers} followers</small></div>
      <div class="actions"><button class="secondary" id="followbtn">${c.following ? 'Unfollow' : 'Follow'}</button></div>
    </header>
    <div class="msgs" id="chmsgs">
      ${posts.length === 0 ? '<div class="empty">No posts yet in this channel.</div>' : posts.map(p => channelPost(p)).join('')}
    </div>
    ${c.following && c.is_owner ? `<div class="composer"><form id="chform" class="row">
      <input required placeholder="Broadcast to followers…" aria-label="Post message"><button class="ib send" aria-label="Send post">${icon('send')}</button></form></div>` : ''}`
      : `<header class="chathead"><div style="flex:1"><h3>Channels</h3><small class="muted">One-way broadcast</small></div>
         <div class="actions"><button class="secondary" id="newch">New channel</button></div></header>
        <div class="page"><div class="pageinner">
          <h2>Stay informed</h2><p class="muted" style="margin-top:7px">Channels are a one-way broadcast tool — admins post, followers read.</p>
          <div class="tiles">
            ${channels.map(x => `<button class="statuscard" style="background:linear-gradient(145deg,#496f97,#26365e)" data-open="${x.id}">${avatarHTML(x)}<b>${esc(x.name)}</b><div>${x.followers} followers<br><small>${esc(x.description || 'Channel')}</small></div></button>`).join('')}
          </div></div></div>`}`;
  $('#main').querySelector('.chathead .back')?.addEventListener('click', () => { state.selectedChannel = null; renderSide(); render(); });
  $('#main').querySelector('#newch')?.addEventListener('click', createModal);
  $('#main').querySelectorAll('[data-open]').forEach(b => b.onclick = () => { state.selectedChannel = +b.dataset.open; render(); });
  $('#main').querySelector('#followbtn')?.addEventListener('click', async () => {
    if (c.following) await API.del(`/api/channels/${c.id}/follow`);
    else await API.post(`/api/channels/${c.id}/follow`);
    render(); renderSide();
  });
  const form = $('#chform');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const input = form.querySelector('input');
    try {
      await API.post(`/api/channels/${c.id}/posts`, { body: input.value });
      input.value = '';
      render();
    } catch (err) { toast(err.message); }
  };
  const box = $('#chmsgs');
  if (box) box.scrollTop = box.scrollHeight;
}

function channelPost(p) {
  return `<div class="msgrow other"><div class="bubble">
    <p class="body">${esc(p.body)}</p>
    <small class="meta">${esc(p.author_name || 'Channel')} · ${timeAgo(p.created_at)}</small>
  </div></div>`;
}

function createModal() {
  modal('Create a channel', `
    <form id="chform">
      <label class="field">Channel name<input id="chname" required maxlength="60" placeholder="e.g. Product announcements"></label>
      <label class="field">Description<textarea id="chdesc" rows="2" maxlength="300" placeholder="What is this channel about?"></textarea></label>
      <button class="primary full">Create channel</button>
    </form>`);
  document.getElementById('layers').querySelector('#chform').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await API.post('/api/channels', { name: e.target.querySelector('#chname').value, description: e.target.querySelector('#chdesc').value });
      closeModal();
      toast('Channel created');
      state.selectedChannel = r.id;
      render(); renderSide();
    } catch (err) { toast(err.message); }
  };
}
