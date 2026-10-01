import API from '../api.js';
import { esc, avatarHTML, toast, modal, closeModal, icon, iconBtn, timeAgo } from '../helpers.js';
import { state, $ } from '../app.js';

let communities = [];

export async function renderSide() {
  try {
    communities = await API.get('/api/communities');
  } catch { communities = []; }
  $('#side').innerHTML = `
    <div class="sidehead"><div class="between"><h1>Communities</h1>
      <div class="actions">${iconBtn('plus', '', 'New community')}</div></div></div>
    <div class="list">
      ${communities.map(cm => `
        <button class="chatrow" data-cm="${cm.id}">${avatarHTML(cm)}<div><strong>${esc(cm.name)}</strong><p class="muted">${cm.groups.length} group${cm.groups.length === 1 ? '' : 's'}</p></div></button>`).join('')}
      ${communities.length ? '' : '<div class="empty">Bring members together in a community.</div>'}
    </div>`;
  $('#side').querySelector('.actions .ib').onclick = () => createModal();
  $('#side').querySelectorAll('[data-cm]').forEach(b => b.onclick = () => {
    state.selectedCommunity = +b.dataset.cm;
    render();
  });
}

export async function render() {
  try { communities = await API.get('/api/communities'); } catch {}
  const cm = communities.find(x => x.id === state.selectedCommunity) || null;
  $('#main').innerHTML = cm ? `
    <header class="chathead">
      <button class="ib back onlymobile" aria-label="Back">${icon('back')}</button>
      ${avatarHTML(cm, 'small')}<div style="flex:1"><h3>${esc(cm.name)}</h3><small class="muted">${esc(cm.description || 'Community')}</small></div>
    </header>
    <div class="page"><div class="pageinner">
      <div class="between"><h2>Groups</h2>${cm.is_owner ? '<button class="secondary" id="addgroup">Add group</button>' : ''}</div>
      <div class="card">
        ${cm.groups.map(g => `
          <button class="settingrow" data-open="${g.conversation_id}">${avatarHTML(g)}<span class="content"><strong>${esc(g.name)}</strong><small>${g.is_announcements ? 'Announcements' : 'Group'}</small></span>${icon('chevron')}</button>`).join('')}
        ${cm.groups.length ? '' : '<div class="empty">No groups yet.</div>'}
      </div>
    </div></div>` : `
    <header class="chathead"><div style="flex:1"><h3>Communities</h3><small class="muted">Groups, together</small></div>
      <div class="actions"><button class="secondary" id="newcm">New community</button></div></header>
    <div class="page"><div class="pageinner">
      <h2>Connect your groups</h2><p class="muted" style="margin-top:7px">Communities bring members together across related groups in one place.</p>
      <div class="tiles">
        ${communities.map(x => `<button class="statuscard" style="background:linear-gradient(145deg,#ad7062,#5e4167)" data-open="${x.id}">${avatarHTML(x)}<b>${esc(x.name)}</b><div>${x.groups.length} groups</div></button>`).join('')}
      </div></div></div>`;
  $('#main').querySelector('.chathead .back')?.addEventListener('click', () => { state.selectedCommunity = null; renderSide(); render(); });
  $('#main').querySelector('#newcm')?.addEventListener('click', createModal);
  $('#main').querySelector('#addgroup')?.addEventListener('click', () => addGroup(cm));
  $('#main').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openGroup(+b.dataset.open));
}

async function openGroup(convId) {
  state.selectedCommunity = null;
  state.selected = convId;
  const chats = await import('./chats.js');
  navigate('chats');
  chats.show(convId);
}

function createModal() {
  modal('Create a community', `
    <form id="cmform">
      <label class="field">Community name<input id="cmname" required maxlength="60" placeholder="e.g. Neighborhood"></label>
      <label class="field">Description<textarea id="cmdesc" rows="2" maxlength="300" placeholder="What brings people together here?"></textarea></label>
      <button class="primary full">Create community</button>
    </form>`);
  document.getElementById('layers').querySelector('#cmform').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await API.post('/api/communities', {
        name: e.target.querySelector('#cmname').value,
        description: e.target.querySelector('#cmdesc').value,
      });
      closeModal();
      toast('Community created');
      state.selectedCommunity = r.id;
      render(); renderSide();
    } catch (err) { toast(err.message); }
  };
}

async function addGroup(cm) {
  modal('Add a group to community', `
    <form id="gform">
      <label class="field">Group name<input id="gname" required maxlength="60" placeholder="e.g. Announcements"></label>
      <button class="primary full">Create group</button>
    </form>`);
  document.getElementById('layers').querySelector('#gform').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await API.post(`/api/communities/${cm.id}/groups`, { name: e.target.querySelector('#gname').value });
      closeModal();
      toast('Group added — all community members were added to it');
      render(); renderSide();
    } catch (err) { toast(err.message); }
  };
}
