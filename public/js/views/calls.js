import API from '../api.js';
import { esc, avatarHTML, toast, icon, iconBtn, timeAgo } from '../helpers.js';
import { state, $ } from '../app.js';
import { getSocket } from '../socket.js';

let peer = null;          // {userId, name, avatar_color, avatar_url, callId, outgoing, type}
let pc = null;
let localStream = null;
let pendingIce = [];
let callStart = null;
const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ---------- Socket bindings (called once on login) ----------
export function bind(socket) {
  socket.on('call:ring', p => incoming(p));
  socket.on('call:accepted', p => onAccepted(p));
  socket.on('call:declined', p => onDeclined(p));
  socket.on('call:cancelled', p => onCancelled(p));
  socket.on('call:ended', p => onEnded(p));
  socket.on('call:sdp', p => onSdp(p));
  socket.on('call:ice', p => onIce(p));
}

// ---------- Caller side ----------
export async function start(otherUserId, video) {
  if (peer) { toast('Already in a call'); return; }
  try {
    const r = await API.post('/api/calls', { calleeId: otherUserId, type: video ? 'video' : 'voice' });
    if (!r.calleeOnline) { toast('User is offline'); return; }
    const conv = state.conversations.find(c => c.other_id === otherUserId);
    peer = {
      userId: otherUserId,
      name: conv?.display_name || 'Contact',
      avatar_color: conv?.avatar_color,
      avatar_url: conv?.avatar_url,
      callId: r.callId,
      outgoing: true,
      type: video ? 'video' : 'voice'
    };
    const ok = await getUserMedia(video);
    if (!ok) { peer = null; return; }
    openLayer('Ringing…', false);
    callStart = Date.now();
  } catch (err) { toast(err.message); }
}

// ---------- Callee side ----------
function incoming(p) {
  if (peer) {
    getSocket()?.emit('call:cancel', { callId: p.callId, to: p.callerId });
    return;
  }
  peer = { userId: p.callerId, name: p.callerName || 'Contact', callId: p.callId, outgoing: false, type: p.type };
  openLayer(`Incoming ${p.type} call…`, true);
}

export async function accept() {
  if (!peer) return;
  const ok = await getUserMedia(peer.type === 'video');
  if (!ok) { decline(); return; }
  document.getElementById('callaccept').classList.add('hide');
  document.getElementById('calldecline').classList.add('hide');
  $('#callstatus').textContent = 'Connecting…';
  getSocket()?.emit('call:accept', { callId: peer.callId, to: peer.userId });
  callStart = Date.now();
}

export function decline() {
  if (peer) getSocket()?.emit('call:decline', { callId: peer.callId, to: peer.userId });
  cleanup();
}

// ---------- WebRTC ----------
function createPeer() {
  pc = new RTCPeerConnection(servers);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = e => {
    const rv = document.getElementById('callremote');
    if (rv && e.streams[0]) {
      rv.srcObject = e.streams[0];
      rv.classList.remove('hide');
      document.querySelector('.callcenter').style.display = 'none';
    }
  };
  pc.onicecandidate = e => {
    if (e.candidate) getSocket()?.emit('call:ice', { to: peer.userId, candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') $('#callstatus').textContent = peer.type === 'video' ? 'Video call' : 'Voice call';
  };
  return pc;
}

async function onAccepted() {
  if (!peer?.outgoing || pc) return;
  $('#callstatus').textContent = 'Connecting…';
  createPeer();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  getSocket()?.emit('call:sdp', { to: peer.userId, sdp: { type: 'offer', sdp: offer.sdp } });
  flushIce();
}

export async function onSdp(p) {
  if (!peer || p.from !== peer.userId) return;
  if (p.sdp?.type === 'offer') {
    createPeer();
    await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    getSocket()?.emit('call:sdp', { to: peer.userId, sdp: { type: 'answer', sdp: answer.sdp } });
    flushIce();
  } else if (p.sdp?.type === 'answer' && pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
    flushIce();
  }
}

export function onIce(p) {
  if (!peer || p.from !== peer.userId) return;
  if (!pc || !pc.remoteDescription) { pendingIce.push(p.candidate); return; }
  pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
}

function flushIce() {
  const list = pendingIce;
  pendingIce = [];
  list.forEach(c => pc?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
}

function onDeclined() { if (peer && !peer.outgoing === false) {} endCallUI('Call declined'); }
function onCancelled() { if (peer && !peer.outgoing) endCallUI('Call cancelled'); }
function onEnded() { endCallUI('Call ended'); }

// ---------- UI helpers ----------
function openLayer(status, isIncoming) {
  $('#calllayer').classList.add('open');
  document.querySelector('.callcenter').style.display = 'flex';
  $('#callname').textContent = peer.name;
  $('#callstatus').textContent = status;
  $('#callavatar').innerHTML = avatarHTML(peer, 'large');
  document.getElementById('callaccept').classList.toggle('hide', !isIncoming);
  document.getElementById('calldecline').classList.toggle('hide', !isIncoming);
}

function endCallUI(reason) {
  if (peer?.callId) {
    const duration = callStart ? Math.round((Date.now() - callStart) / 1000) : 0;
    API.post(`/api/calls/${peer.callId}/outcome`, { status: 'completed', duration_secs: duration }).catch(() => {});
  }
  toast(reason || 'Call ended');
  cleanup();
  if (state.tab === 'calls') render();
}

function cleanup() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  peer = null;
  pendingIce = [];
  callStart = null;
  $('#calllayer').classList.remove('open');
  document.getElementById('callaccept').classList.add('hide');
  document.getElementById('calldecline').classList.add('hide');
  const lv = document.getElementById('calllocal');
  if (lv) { lv.classList.add('hide'); lv.srcObject = null; }
  const rv = document.getElementById('callremote');
  if (rv) { rv.classList.add('hide'); rv.srcObject = null; }
}

async function getUserMedia(video) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const lv = document.getElementById('calllocal');
    if (video && lv) { lv.srcObject = localStream; lv.classList.remove('hide'); }
    return true;
  } catch {
    toast('Microphone/camera permission denied');
    return false;
  }
}

function toggleMic() {
  if (!localStream) return;
  const on = localStream.getAudioTracks().some(t => t.enabled);
  localStream.getAudioTracks().forEach(t => { t.enabled = !on; });
  document.getElementById('callmic').classList.toggle('off', on);
}

function toggleCam() {
  if (!localStream) return;
  const on = localStream.getVideoTracks().some(t => t.enabled);
  localStream.getVideoTracks().forEach(t => { t.enabled = !on; });
  document.getElementById('callcam').classList.toggle('off', on);
}

// ---------- Calls tab ----------
export function render() {
  $('#main').innerHTML = `<header class="chathead"><div style="flex:1"><h3>Calls</h3><small class="muted">Recent calls</small></div></header>
    <div class="page"><div class="pageinner">
      <h2>Call history</h2>
      <div class="card" id="calllog"><div class="empty">Loading…</div></div>
    </div></div>`;
  loadLog();
}

async function loadLog() {
  try {
    const calls = await API.get('/api/calls');
    const log = document.getElementById('calllog');
    if (!log) return;
    log.innerHTML = calls.length ? calls.map(c => `
      <div class="settingrow">${avatarHTML(c.other)}
        <span class="content"><strong>${esc(c.other.name)}</strong>
        <small>${c.type === 'video' ? 'Video' : 'Voice'} · ${c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} · ${c.status} · ${timeAgo(c.started_at)}${c.duration_secs ? ` · ${c.duration_secs}s` : ''}</small></span>
      </div>`).join('')
      : '<div class="empty">No calls yet. Start one from any chat with the call buttons.</div>';
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('callmic').onclick = toggleMic;
  document.getElementById('callcam').onclick = toggleCam;
  document.getElementById('callend').onclick = () => {
    if (peer) getSocket()?.emit('call:end', { callId: peer.callId, to: peer.userId });
    endCallUI('Call ended');
  };
  document.getElementById('callaccept').onclick = accept;
  document.getElementById('calldecline').onclick = decline;
});
