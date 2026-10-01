import API from '../api.js';
import { esc, toast, modal, closeModal, icon } from '../helpers.js';
import { $ } from '../app.js';

let settings = {};
let sources = [];

export async function hydrate() {
  try { settings = await API.get('/api/users/me/settings'); } catch { settings = {}; }
  applyLook();
}

export function applyLook() {
  document.documentElement.style.setProperty('--accent', settings.accent_color || '#00a884');
  document.documentElement.style.setProperty('--fs', (settings.font_size || 15) + 'px');
}

async function save(patch) {
  settings = { ...settings, ...patch };
  applyLook();
  try { await API.put('/api/users/me/settings', settings); } catch (err) { toast(err.message); }
}

export async function render() {
  await hydrate();
  try { sources = await API.get('/api/ai/sources'); } catch { sources = []; }
  $('#main').innerHTML = `<header class="chathead"><div style="flex:1"><h3>Settings</h3><small class="muted">Make Connect yours</small></div></header>
    <div class="page"><div class="pageinner">
      <div class="profiletop">
        ${avatar(API.user)}
        <h2>${esc(API.user.name)}</h2>
        <p>${esc(API.user.phone)}</p>
        <button class="secondary" id="editprofile">Edit profile</button>
      </div>
      <h2>Appearance</h2>
      <div class="card">
        <button class="settingrow" id="darkmode">${icon('moon')}<span class="content"><strong>Dark mode</strong><small>Easier on the eyes at night</small></span><span class="toggle ${settings.dark ? 'on' : ''}"></span></button>
        <div class="settingrow">${icon('palette')}<span class="content"><strong>Accent color</strong></span></div>
        <div class="swatches">
          ${['#00a884', '#4a7dab', '#ad7062', '#8a5aa8', '#c96f4a', '#5f7d3f'].map(c =>
            `<button class="swatch ${settings.accent_color === c ? 'active' : ''}" data-accent="${c}" style="background:${c}" aria-label="Accent color"></button>`).join('')}
        </div>
        <div class="settingrow">${icon('type')}<span class="content"><strong>Font size</strong></span></div>
        <input type="range" min="12" max="20" value="${settings.font_size || 15}" id="fontsize" style="width:100%">
      </div>
      <h2>Notifications & privacy</h2>
      <div class="card">
        <button class="settingrow" id="receipts">${icon('done')}<span class="content"><strong>Read receipts</strong><small>When off, you won't send or receive them</small></span><span class="toggle ${settings.read_receipts !== false ? 'on' : ''}"></span></button>
        <button class="settingrow danger" id="clearall">${icon('trash')}<span class="content"><strong>Clear all chats</strong><small>Deletes every message you have</small></span></button>
      </div>
      <h2>AI Studio knowledge sources</h2>
      <div class="card">
        ${sources.map(s => `
          <div class="settingrow"><span class="content"><strong>${esc(s.name)}</strong><small>${s.chars} chars</small></span>
          <button class="ib danger" data-delsrc="${s.id}" aria-label="Delete source">${icon('close')}</button></div>`).join('')}
        ${sources.length ? '' : '<div class="empty">No sources yet. Add notes or documents so the AI can ground its answers.</div>'}
        <button class="settingrow" id="addsrc">${icon('plus')}<span class="content"><strong>Add source</strong></span></button>
      </div>
      <h2>About</h2>
      <div class="card"><div class="settingrow"><span class="content"><strong>Connect</strong><small>Version 1.0 · Real-time messaging</small></span></div></div>
      <button class="primary" id="logoutbtn" style="margin:20px 0 40px">Log out</button>
    </div></div>`;

  $('#darkmode').onclick = async () => {
    await save({ dark: !settings.dark });
    document.body.classList.toggle('dark', !!settings.dark);
    render();
  };
  $('#receipts').onclick = async () => { await save({ read_receipts: settings.read_receipts === false }); render(); };
  $('#fontsize').onchange = e => save({ font_size: +e.target.value });
  $('#main').querySelectorAll('[data-accent]').forEach(b => b.onclick = async () => { await save({ accent_color: b.dataset.accent }); render(); });
  $('#editprofile').onclick = editProfile;
  $('#clearall').onclick = () => {
    modal('Clear all chats?', '<p class="muted">This deletes every message across all your conversations. This cannot be undone.</p>', async () => {
      await API.del('/api/me/chats').catch(() => {});
      closeModal();
      toast('All chats cleared');
    });
  };
  $('#addsrc').onclick = addSource;
  $('#main').querySelectorAll('[data-delsrc]').forEach(b => b.onclick = async () => {
    await API.del(`/api/ai/sources/${b.dataset.delsrc}`);
    toast('Source removed');
    render();
  });
  $('#logoutbtn').onclick = () => {
    modal('Log out?', '<p class="muted">You can log back in with your phone number.</p>', () => { API.logout(); location.reload(); });
  };
}

function avatar(u) {
  const color = u.avatar_color || '#b9d9d0';
  if (u.avatar_url) return `<img class="avatar large" src="${esc(u.avatar_url)}" alt="">`;
  const ini = (u.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="avatar large" style="background:${esc(color)}">${ini}</span>`;
}

function editProfile() {
  modal('Edit profile', `
    <form id="pform">
      <label class="field">Name<input id="pname" required maxlength="50" value="${esc(API.user.name)}"></label>
      <label class="field">About<textarea id="pabout" rows="2" maxlength="160">${esc(API.user.about || '')}</textarea></label>
      <button class="primary full">Save profile</button>
    </form>`);
  document.getElementById('layers').querySelector('#pform').onsubmit = async e => {
    e.preventDefault();
    try {
      API.user = await API.put('/api/users/me', { name: e.target.querySelector('#pname').value, about: e.target.querySelector('#pabout').value });
      closeModal();
      toast('Profile updated');
      render();
    } catch (err) { toast(err.message); }
  };
}

function addSource() {
  modal('Add AI source', `
    <form id="sform">
      <label class="field">Title<input id="stitle" required maxlength="120" placeholder="e.g. Company FAQ"></label>
      <label class="field">Content<textarea id="scontent" rows="6" required maxlength="50000" placeholder="Paste notes, FAQs, docs…"></textarea></label>
      <button class="primary full">Save source</button>
    </form>`);
  document.getElementById('layers').querySelector('#sform').onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post('/api/ai/sources', { name: e.target.querySelector('#stitle').value, text: e.target.querySelector('#scontent').value });
      closeModal();
      toast('Source saved');
      render();
    } catch (err) { toast(err.message); }
  };
}
