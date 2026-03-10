const BACKEND = import.meta.env.VITE_BACKEND_URL || '';
const AUTH_TOKEN_KEY = 'email-sender-auth-token';

function getBackend() {
  return BACKEND.replace(/\/$/, '') || (typeof window !== 'undefined' ? new URL(window.location.origin).origin : '');
}

function getAuthToken() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  } catch (_) {
    return null;
  }
}

function setAuthToken(token) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch (_) {}
}

function clearAuthToken() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (_) {}
}

async function fetchBackend(path, options = {}) {
  const base = getBackend();
  const url = base ? base + path : path;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getAuthToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
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
  clearAuthToken();
  const base = getBackend();
  const url = base ? base + '/auth/logout' : '/auth/logout';
  await fetch(url, { method: 'POST', credentials: 'include' });
}

export const api = {
  getBackend,
  fetchBackend,
  getAuthUrl,
  logout,
  setAuthToken,
  clearAuthToken,
};
