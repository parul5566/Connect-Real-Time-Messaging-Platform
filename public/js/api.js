const BASE = '';
let token = localStorage.getItem('connect_token') || null;
let user = null;

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opts);
  if (res.status === 401) { logout(); location.reload(); throw new Error('Session expired'); }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const API = {
  get: p => req('GET', p),
  post: (p, b) => req('POST', p, b ?? {}),
  put: (p, b) => req('PUT', p, b ?? {}),
  patch: (p, b) => req('PATCH', p, b ?? {}),
  del: p => req('DELETE', p),
  setSession(t, u) { token = t; user = u; localStorage.setItem('connect_token', t); },
  logout() { token = null; user = null; localStorage.removeItem('connect_token'); },
  get token() { return token; },
  get user() { return user; },
  set user(u) { user = u; }
};

export default API;
