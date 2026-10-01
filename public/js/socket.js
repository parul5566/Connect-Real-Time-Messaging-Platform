import { io } from '/socket.io/socket.io.esm.min.js';

let socket = null;
let handlers = {};

export function connectSocket(h) {
  handlers = h || {};
  if (socket) return socket;
  const token = localStorage.getItem('connect_token');
  socket = io({ auth: { token } });
  window.__connectSocket = socket;
  socket.on('connect', () => console.log('socket connected'));
  socket.on('connect_error', err => {
    console.error('socket error', err.message);
    if (err.message === 'Authentication required') { localStorage.removeItem('connect_token'); location.reload(); }
  });
  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; window.__connectSocket = null; }
}

export default { connectSocket, getSocket, disconnectSocket };
