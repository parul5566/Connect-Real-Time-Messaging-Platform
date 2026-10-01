import API from '../api.js';
import { esc, avatarHTML, toast, modal, closeModal, menu, confirmAction, icon, iconBtn } from '../helpers.js';
import { state, $, back, refreshConversations } from '../app.js';

export function show(convId) {
  const c = state.conversations.find(x => x.id === convId);
  if (!c) return;
  const isGroup = c.type === 'group';
  const canEdit = isGroup && c.created_by === API.user.id;
  modal(isGroup ? 'Group info' : 'Contact info', `
    <div class="profiletop">
      ${avatarHTML(c, 'large')}
      <h2>${esc(c.display_name)}</h2>
      <p>${esc(isGroup ? (c.about || 'Group') : (c.other_about || ''))}</p>
    </div>
    <div class="card">
      <button class="settingrow" data-act="favorite">${icon('star')}<span class="content"><strong>${c.favorite ? 'Remove favorite' : 'Add to favorites'}</strong></span><span class="toggle ${c.favorite ? 'on' : ''}"></span></button>
      <button class="settingrow" data-act="mute">${icon('bell')}<span class="content"><strong>Mute notifications</strong></span><span class="toggle ${c.muted ? 'on' : ''}"></span></button>
    </div>
    ${isGroup ? `
      <h3 style="margin-top:20px">Participants · ${c.members.length}</h3>
      <div class="card">
        ${c.members.map(m => `
          <div class="settingrow" data-member="${m.id}">
            ${avatarHTML(m)}
            <span class="content"><strong>${esc(m.name)}${m.id === API.user.id ? ' (you)' : ''}</strong><small>${esc(m.role === 'admin' ? 'Admin' : 'Member')}</small></span>
            ${canEdit && m.id !== API.user.id ? `<button class="ib danger" data-remove="${m.id}" aria-label="Remove">${icon('close')}</button>` : ''}
          </div>`).join('')}
        <button class="settingrow" data-act="add">${icon('plus')}<span class="content"><strong>Add participant</strong></span></button>
      </div>` : ''}
    <div class="card" style="margin-top:20px">
      ${!isGroup ? `<button class="settingrow danger" data-act="block">${icon('shield')}<span class="content"><strong>${isBlockedByMe(c) ? 'Unblock contact' : 'Block contact'}</strong><small>${isBlockedByMe(c) ? 'They can message you again' : 'They will not be able to message or call you'}</small></span></button>` : ''}
      <button class="settingrow" data-act="leave">${icon('logout')}<span class="content"><strong>${isGroup ? 'Leave group' : 'Delete chat'}</strong></span></button>
    </div>`);

  const l = document.getElementById('layers');
  l.querySelector('[data-act="favorite"]')?.addEventListener('click', async () => {
    await API.patch(`/api/conversations/${c.id}/prefs`, { favorite: !c.favorite });
    closeModal(); refreshConversations(); show(c.id);
  });
  l.querySelector('[data-act="mute"]')?.addEventListener('click', async () => {
    await API.patch(`/api/conversations/${c.id}/prefs`, { muted: !c.muted });
    closeModal(); refreshConversations(); show(c.id);
  });
  l.querySelector('[data-act="add"]')?.addEventListener('click', () => addParticipant(c.id));
  l.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    try {
      await API.del(`/api/conversations/${c.id}/participants/${b.dataset.remove}`);
      closeModal(); refreshConversations(); toast('Participant removed');
    } catch (err) { toast(err.message); }
  });
  l.querySelector('[data-act="block"]')?.addEventListener('click', async () => {
    const blocked = isBlockedByMe(c);
    if (blocked) await API.post(`/api/users/me/unblock/${c.other_id}`);
    else await API.post(`/api/users/me/block/${c.other_id}`);
    closeModal();
    toast(blocked ? 'Unblocked' : 'Contact blocked');
  });
  l.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
    confirmAction(isGroup ? 'Leave group?' : 'Leave chat?', isGroup ? 'You will stop receiving messages from this group.' : 'This hides the chat for you.',
      async () => {
        if (isGroup) await API.del(`/api/conversations/${c.id}/leave`);
        await API.patch(`/api/conversations/${c.id}/prefs`, { archived: true });
        closeModal();
        state.selected = null;
        refreshConversations().then(back);
      });
  });
}

function isBlockedByMe(c) {
  return (API.user?.blocked_users || []).includes(c.other_id);
}

export async function addParticipant(convId) {
  const users = await API.get('/api/users');
  const c = state.conversations.find(x => x.id === convId);
  const existing = new Set(c?.members?.map(m => m.id) || []);
  modal('Add participant', users.filter(u => !existing.has(u.id)).map(u => `
    <button class="chatrow" data-add="${u.id}">${avatarHTML(u)}<div><strong>${esc(u.name)}</strong><p class="muted">${esc(u.about || '')}</p></div></button>`).join('') || '<div class="empty">Everyone is already here</div>');
  document.getElementById('layers').querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
    await API.post(`/api/conversations/${convId}/participants`, { userIds: [+b.dataset.add] });
    closeModal();
    refreshConversations();
    toast('Participant added');
  });
}
