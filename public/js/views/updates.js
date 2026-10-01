import API from '../api.js';
import { esc, avatarHTML, toast, modal, closeModal, icon, iconBtn, timeAgo } from '../helpers.js';
import { state, $, renderRail, navigate } from '../app.js';
import { getSocket } from '../socket.js';

let statuses = { mine: [], others: [] };
let viewing = null; // {list, index, timer, paused, ticks}

export async function renderSide() {
  try {
    statuses = await API.get('/api/statuses');
  } catch { statuses = { mine: [], others: [] }; }
  const othersCount = statuses.others.reduce((n, g) => n + g.statuses.filter(s => !s.seen).length, 0);
  $('#side').innerHTML = `
    <div class="sidehead"><div class="between"><h1>Updates</h1>
      <div class="actions">${iconBtn('plus', '', 'Add status')}</div></div></div>
    <div class="list">
      <button class="chatrow" id="my-status">${avatarHTML(API.user, 'ring')}<div><strong>My status</strong><p class="muted">${statuses.mine.length ? `${statuses.mine.length} active` : 'Add a moment to your day'}</p></div></button>
      ${statuses.others.length ? `<div class="listlabel">Recent updates</div>` : ''}
      ${statuses.others.map((g, gi) => `
        <button class="chatrow" data-status="${gi}">${avatarHTML(g, 'ring')}<div><strong>${esc(g.name)}</strong><p class="muted">${timeAgo(g.statuses[0].created_at)}</p></div></button>`).join('')}
      ${statuses.others.length ? '' : '<div class="empty">No status updates yet. Share your own!</div>'}
    </div>`;
  $('#side').querySelector('.actions .ib').onclick = () => createModal();
  $('#side').querySelector('#my-status').onclick = () => {
    if (statuses.mine.length) viewAll([...statuses.mine.map(s => ({ ...s, own: true }))], 0);
    else createModal();
  };
  $('#side').querySelectorAll('[data-status]').forEach(b => b.onclick = () => {
    const g = statuses.others[+b.dataset.status];
    viewAll(g.statuses.map(s => ({ ...s, name: g.name, avatar_color: g.avatar_color, avatar_url: g.avatar_url, other_user: g.user_id })), 0);
  });
}

export async function render() {
  try { statuses = await API.get('/api/statuses'); } catch {}
  $('#main').innerHTML = `<header class="chathead"><div style="flex:1"><h3>Updates</h3><small class="muted">Everyday moments, shared for 24 hours</small></div>
    <div class="actions">${iconBtn('plus', '', 'Add status')}</div></header>
    <div class="page"><div class="pageinner">
      <div class="between"><h2>Status</h2><button class="secondary" id="add-status">Add status</button></div>
      <p class="muted" style="margin-top:7px">Visible to everyone on Connect for 24 hours.</p>
      <div class="tiles">
        ${statuses.others.map((g, gi) => `
          <button class="statuscard" style="background:${esc(g.statuses[0].bg_gradient || 'linear-gradient(145deg,#276f60,#214845)')}" data-view="${gi}">
            ${avatarHTML(g)}<b>${esc(g.statuses[0].body.split('\n')[0])}</b>
            <div>${esc(g.name)}<br><small>${timeAgo(g.statuses[0].created_at)}</small></div>
          </button>`).join('')}
      </div>
      ${statuses.mine.length ? `<div class="section"><h2>Your status</h2><div class="card">
        ${statuses.mine.map(s => `<div class="settingrow"><span class="content"><strong>${esc(s.body.slice(0, 80))}</strong><small>${s.view_count} view${s.view_count === 1 ? '' : 's'} · expires ${timeAgo(s.expires_at)}</small></span><button class="ib danger" data-del="${s.id}">${icon('close')}</button></div>`).join('')}
      </div></div>` : ''}
    </div></div>`;
  $('#main').querySelector('.actions .ib').onclick = () => createModal();
  $('#main').querySelector('#add-status').onclick = () => createModal();
  $('#main').querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const g = statuses.others[+b.dataset.view];
    viewAll(g.statuses.map(s => ({ ...s, name: g.name, avatar_color: g.avatar_color, avatar_url: g.avatar_url, other_user: g.user_id })), 0);
  });
  $('#main').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    await API.del(`/api/statuses/${b.dataset.del}`);
    render(); renderSide();
  });
}

function createModal() {
  modal('Add a status', `
    <form id="statusform">
      <label class="field">Your moment<textarea id="statustext" rows="4" required maxlength="700" placeholder="What's on your mind?"></textarea></label>
      <label class="field">Background
        <select id="statuscolor">
          <option value="linear-gradient(145deg,#276f60,#214845)">Forest</option>
          <option value="linear-gradient(145deg,#ad7062,#5e4167)">Sunset</option>
          <option value="linear-gradient(145deg,#496f97,#26365e)">Ocean</option>
        </select></label>
      <button class="primary full">Share status</button>
    </form>`);
  document.getElementById('layers').querySelector('#statusform').onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post('/api/statuses', { body: e.target.querySelector('#statustext').value, bg_gradient: e.target.querySelector('#statuscolor').value });
      closeModal();
      toast('Status shared — visible for 24 hours');
      render(); renderSide();
    } catch (err) { toast(err.message); }
  };
}

function viewAll(list, index) {
  stopViewing();
  const s = list[index];
  viewing = { list, index, ticks: 0, paused: false };
  // mark viewed
  if (!s.own) API.post(`/api/statuses/${s.id}/view`).catch(() => {});
  $('#main').innerHTML = `<header class="chathead">
    ${iconBtn('back', '', 'Back', 'back')}
    <div style="flex:1"><h3>Status</h3><small class="muted">${index + 1} of ${list.length}</small></div>
    ${s.own ? iconBtn('user', '', 'Viewers') : ''}
  </header>
  <div class="statusscene" id="statusscene" style="background:${esc(s.bg_gradient)}">
    <div class="statusprogress">${list.map((_, k) => `<i data-bar="${k}" class="${k < index ? 'done' : k === index ? 'active' : ''}"></i>`).join('')}</div>
    <div class="statusauthor row">${avatarHTML(s)}<div><strong>${esc(s.own ? 'You' : s.name)}</strong><br><small style="color:#fffb">${timeAgo(s.created_at)}</small></div></div>
    <h2>${esc(s.body).replace(/\n/g, '<br>')}</h2>
    <div style="margin-top:30px;display:flex;gap:12px">
      ${iconBtn('back', '', 'Previous')}
      ${iconBtn('chevron', '', 'Next')}
    </div>
    ${s.own ? '' : `<form class="statusreply" id="statusreply"><input required placeholder="Reply to this status…" aria-label="Reply"><button class="ib send" aria-label="Send">${icon('send')}</button></form>`}
  </div>`;
  $('#main').querySelector('.chathead .back').onclick = () => { stopViewing(); navigate('updates'); };
  $('#main').querySelector('[aria-label="Previous"]').onclick = () => viewAll(list, (index - 1 + list.length) % list.length);
  $('#main').querySelector('[aria-label="Next"]').onclick = () => next(list, index);
  $('#main').querySelector('[aria-label="Viewers"]')?.addEventListener('click', () => viewViewers(s.id));
  const scene = $('#statusscene');
  scene.onpointerdown = () => { if (viewing) viewing.paused = true; };
  scene.onpointerup = () => { if (viewing) viewing.paused = false; };
  const rf = $('#statusreply');
  if (rf) rf.onsubmit = async e => {
    e.preventDefault();
    const text = rf.querySelector('input').value;
    try {
      const r = await API.post('/api/conversations', { type: 'direct', userId: s.other_user });
      await API.post('/api/messages', { conversation_id: r.id, type: 'text', body: `↩ Status reply: ${text}` });
      toast('Reply sent');
      rf.reset();
    } catch (err) { toast(err.message); }
  };
  // auto-advance 6s
  viewing.timer = setInterval(() => {
    if (!viewing || viewing.paused) return;
    viewing.ticks += 0.1;
    const bar = document.querySelector(`[data-bar="${index}"]`);
    if (bar && !bar.classList.contains('done')) bar.style.background = `rgba(255,255,255,${Math.min(0.4 + viewing.ticks / 6 * 0.6, 1)})`;
    if (viewing.ticks >= 6) next(list, index);
  }, 100);
}

function next(list, index) {
  stopViewing();
  if (index < list.length - 1) viewAll(list, index + 1);
  else { navigate('updates'); renderSide(); }
}

function stopViewing() {
  if (viewing?.timer) clearInterval(viewing.timer);
  viewing = null;
}

async function viewViewers(statusId) {
  const views = await API.get(`/api/statuses/${statusId}/views`);
  modal('Status viewers', views.length ? views.map(v => `
    <div class="settingrow">${avatarHTML(v)}<span class="content"><strong>${esc(v.name)}</strong></span><small>${timeAgo(v.viewed_at)}</small></div>`).join('')
    : '<div class="empty">No views yet</div>');
}
