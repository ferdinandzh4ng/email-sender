const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

function getBackend() {
  return BACKEND.replace(/\/$/, '') || (typeof window !== 'undefined' ? new URL(window.location.origin).origin : '');
}

async function fetchBackend(path, options = {}) {
  const base = getBackend();
  const url = base ? base + path : path;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

async function getAuthUrl(successRedirect) {
  let path = '/auth/url';
  if (successRedirect) path += '?success_redirect=' + encodeURIComponent(successRedirect);
  const data = await fetchBackend(path);
  return data.url;
}

async function logout() {
  const base = getBackend();
  const url = base ? base + '/auth/logout' : '/auth/logout';
  await fetch(url, { method: 'POST', credentials: 'include' });
}

export const api = {
  getBackend,
  fetchBackend,
  getAuthUrl,
  logout,
};
