/* Connect — icons + shared UI primitives */
const paths = {
  chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z M7 9h9M7 13h6',
  updates:'M21 12a9 9 0 1 1-9-9 M17 3h4v4 M21 3l-8 8',
  community:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  call:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3l-1 3-3 1-2 3 2 3-1 3 3 3 3-1 3 2 3-2 3-1 1-4-2-2 1-3-3-3-3 1Z',
  search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus:'M12 5v14M5 12h14', more:'M12 5h.01M12 12h.01M12 19h.01',
  send:'m22 2-7 20-4-9L2 9 22 2ZM22 2 11 13',
  mic:'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  smile:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.01M16 9h.01M8 14s1 3 4 3 4-3 4-3',
  video:'m16 8 6-3v14l-6-3M3 5h13v14H3Z',
  back:'m15 18-6-6 6-6', close:'m6 6 12 12M6 18 18 6', check:'m5 12 4 4L19 6',
  lock:'M5 10h14v12H5ZM8 10V6a4 4 0 0 1 8 0v4',
  archive:'M3 3h18v5H3ZM5 8v13h14V8M10 12h4',
  moon:'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10',
  sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
  user:'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  file:'M14 2H4v20h16V8ZM14 2v6h6M8 13h8M8 17h5',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  device:'M2 3h20v14H2ZM8 21h8M12 17v4',
  chevron:'m9 5 7 7-7 7', play:'m8 4 12 8-12 8Z',
  edit:'m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5',
  link:'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3',
  logout:'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5',
  volume:'m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
  star:'m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z',
  pin:'m8 3 8 0-1 7 4 4H5l4-4-1-7ZM12 14v8',
  shield:'m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  poll:'M5 21V10M12 21V3M19 21v-7',
  spark:'m12 2 2.8 6.8L22 12l-7.2 3.2L12 22l-2.8-6.8L2 12l7.2-3.2L12 2ZM20 2v4M18 4h4',
  image:'M3 3h18v18H3ZM3 16l6-6 5 5 3-3 4 4M16 7h.01',
  trash:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6'
};
window.icon = (n) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.chat}"/></svg>`;
window.btnIcon = (n, act, label, extra = '') =>
  `<button class="ib ${extra}" data-act="${window.Connect.E(act)}" aria-label="${window.Connect.E(label)}" title="${window.Connect.E(label)}">${icon(n)}</button>`;

/* Menus */
window.openMenu = function (e, items) {
  closeMenu();
  const C = window.Connect;
  const el = document.createElement('div');
  el.className = 'menu'; el.id = 'menu';
  items.forEach(([t, fn], i) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.addEventListener('click', () => { closeMenu(); fn(); });
    el.append(b);
  });
  document.body.append(el);
  const r = e.currentTarget.getBoundingClientRect();
  el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 14) + 'px';
  el.style.top = Math.max(10, Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 15)) + 'px';
  e.stopPropagation();
};
window.closeMenu = () => document.getElementById('menu')?.remove();
document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenu(); });

/* Modals */
window.modal = function (title, html, opts = {}) {
  closeMenu();
  const C = window.Connect;
  $('#layers').innerHTML = `<div class="overlay" data-overlay><section class="modal ${opts.cls || ''}" role="dialog" aria-modal="true" aria-label="${C.E(title)}"><div class="modalhead"><h2>${title}</h2>${btnIcon('close', 'closeModal()', 'Close dialog')}</div>${html}</section></div>`;
  $('#layers [data-overlay]').addEventListener('click', e => { if (e.target.dataset.overlay !== undefined) closeModal(); });
  setTimeout(() => $('#layers input')?.focus(), 60);
};
window.closeModal = () => { $('#layers').innerHTML = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeMenu(); } });

window.confirmAction = function (title, fn, danger = false) {
  modal(title, `<p class="muted">Are you sure you want to continue?</p>
    <div class="logout-actions"><button class="secondary" data-act="closeModal()">Cancel</button>
    <button class="${danger ? 'logout-confirm' : 'primary'}" id="confirmYes">Confirm</button></div>`);
  $('#confirmYes').addEventListener('click', () => { closeModal(); fn(); });
};

window.settingRow = function (iconName, title, sub, fn, toggle = false, toggleOn = false) {
  const C = window.Connect;
  return `<button class="settingrow" ${fn ? `data-act="${C.E(fn)}"` : ''}>${icon(iconName)}<span class="content"><strong>${C.E(title)}</strong>${sub ? `<small>${C.E(sub)}</small>` : ''}</span>${toggle ? `<span class="toggle ${toggleOn ? 'on' : ''}"></span>` : icon('chevron')}</button>`;
};
