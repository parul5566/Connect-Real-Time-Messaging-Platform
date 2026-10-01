import API from '../api.js';
import { esc, toast, modal, closeModal, icon, iconBtn } from '../helpers.js';
import { state, $ } from '../app.js';

let chat = null; // null = not yet loaded from history

export async function render() {
  if (chat === null) {
    try { chat = await API.get('/api/ai/history'); } catch { chat = []; }
  }
  $('#main').innerHTML = `<header class="chathead"><div style="flex:1"><h3>AI Studio</h3><small class="muted">Private assistant, grounded in your sources</small></div>
    <div class="actions">${iconBtn('trash', '', 'Clear chat')}</div></header>
    <div class="msgs" id="aimsgs">
      ${chat.length === 0 ? `<div class="empty">
        <h2 style="margin-bottom:8px">Ask me anything</h2>
        <p>I answer using only your saved sources (add them in Settings → AI Studio sources).<br>I never browse the web.</p>
        <div class="suggestions">
          ${['Summarize my saved notes', 'Draft a polite follow-up message', 'What do my sources say about pricing?'].map(s => `<button class="chip suggestion" data-s="${esc(s)}">${esc(s)}</button>`).join('')}
        </div></div>` : chat.map(m => bubble(m)).join('')}
    </div>
    <div class="composer"><form id="aiform" class="row">
      <input required placeholder="Message AI Studio…" aria-label="Message AI Studio" autocomplete="off">
      <button class="ib send" aria-label="Send">${icon('send')}</button></form></div>`;
  const box = $('#aimsgs');
  box.scrollTop = box.scrollHeight;
  $('#aiform').onsubmit = e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    send(input.value);
    input.value = '';
  };
  $('#main').querySelectorAll('.suggestion').forEach(b => b.onclick = () => send(b.dataset.s));
  $('#main').querySelector('.actions .ib').onclick = () => {
    modal('Clear AI chat?', '<p class="muted">Your sources stay saved in Settings.</p>', async () => {
      await API.del('/api/ai/history').catch(() => {});
      chat = [];
      closeModal();
      render();
    });
  };
}

function bubble(m) {
  const out = m.role === 'user';
  return `<div class="msgrow ${out ? 'out' : 'other'}"><div class="bubble ${out ? 'out' : ''}">
    ${m.error ? '<b style="color:#f15c6d">AI unavailable</b><br>' : ''}
    ${m.blocked ? '<b>⚠️ Blocked by guardrails</b><br>' : ''}
    <p class="body">${esc(m.content)}</p>
    ${m.sources?.length ? `<small class="meta">Sources: ${m.sources.map(s => esc(s.name)).join(', ')}</small><br>` : ''}
    <small class="meta">${out ? 'You' : 'AI'} · ${esc(m.created_at || 'now')}</small>
  </div></div>`;
}

async function send(text) {
  if (!text.trim()) return;
  chat.push({ role: 'user', content: text, created_at: 'now' });
  const reply = { role: 'assistant', content: '…', created_at: 'now' };
  chat.push(reply);
  render();
  try {
    // SSE pipeline
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API.token}` },
      body: JSON.stringify({ question: text })
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = false;
    while (!done) {
      const { value, done: rd } = await reader.read();
      if (rd) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.stage === 'status') reply.content = evt.text;
        if (evt.delta) reply.content = (reply.content === '…' ? '' : reply.content) + evt.delta;
        if (evt.sources) reply.sources = evt.sources;
        if (evt.done) {
          done = true;
          if (evt.text) reply.content = evt.text;
          reply.blocked = !!evt.blocked;
          reply.error = !!evt.error;
          if (evt.sources) reply.sources = evt.sources;
          const box = document.getElementById('aimsgs');
          if (box) { box.innerHTML = chat.map(bubble).join(''); box.scrollTop = box.scrollHeight; }
        }
      }
    }
    render();
  } catch (err) {
    reply.content = err.message || 'Something went wrong.';
    reply.error = true;
    render();
  }
}
