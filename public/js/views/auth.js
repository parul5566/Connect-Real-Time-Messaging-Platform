import API from '../api.js';
import { esc, toast, icon } from '../helpers.js';
import { state, $, enterApp } from '../app.js';

export function render() {
  if (!state.authPhone) return splash();
  return verify();
}

function splash() {
  show(`
    <div class="authcard">
      <div class="logo">${icon('chat')}</div>
      <h1>Welcome to Connect</h1>
      <p class="muted">Simple. Reliable. Private messaging for everyone.</p>
      <form id="phoneform">
        <label class="field">Phone number
          <div class="row"><input id="cc" value="+1" style="width:80px" aria-label="Country code"><input id="phone" required placeholder="Phone number" aria-label="Phone number"></div>
        </label>
        <button class="primary full">Continue</button>
      </form>
      <p class="muted small" style="margin-top:14px">We'll text you a 6-digit code.</p>
    </div>`);
  $('#authoverlay').querySelector('#phoneform').onsubmit = async e => {
    e.preventDefault();
    const phone = $('#authoverlay').querySelector('#cc').value.trim() + $('#authoverlay').querySelector('#phone').value.replace(/\D/g, '');
    try {
      const r = await API.post('/api/auth/request-otp', { phone });
      state.authPhone = phone;
      state.pendingVerify = { dev: r.devCode };
      render();
    } catch (err) { toast(err.message); }
  };
}

function verify() {
  show(`
    <div class="authcard">
      <button class="ib" id="phback" aria-label="Back">${icon('back')}</button>
      <h1>Verify ${esc(state.authPhone)}</h1>
      <p class="muted">Enter the 6-digit code we sent you.</p>
      ${state.pendingVerify?.dev ? `<div class="devcode">Dev code: <b>${state.pendingVerify.dev}</b></div>` : ''}
      <form id="codeform">
        <label class="field"><input id="code" required maxlength="6" inputmode="numeric" placeholder="••••••" aria-label="Verification code"></label>
        <label class="field">Your name<input id="name" required maxlength="50" placeholder="How should we call you?" aria-label="Your name"></label>
        <button class="primary full">Verify & continue</button>
      </form>
    </div>`);
  const ov = $('#authoverlay');
  ov.querySelector('#phback').onclick = () => { state.authPhone = null; render(); };
  ov.querySelector('#codeform').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await API.post('/api/auth/verify-otp', {
        phone: state.authPhone,
        code: e.target.querySelector('#code').value,
        name: e.target.querySelector('#name').value
      });
      API.setSession(r.token, r.user);
      state.authPhone = null;
      state.pendingVerify = null;
      hide();
      toast(`Welcome, ${r.user.name}!`);
      enterApp();
    } catch (err) { toast(err.message); }
  };
}

function show(inner) {
  let ov = document.getElementById('authoverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'authoverlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="authwrap">${inner}</div>`;
  document.getElementById('app').style.display = 'none';
}

function hide() {
  document.getElementById('authoverlay')?.remove();
  document.getElementById('app').style.display = '';
}
