const DEFAULT_BACKEND = 'http://localhost:3000';

async function getBackend() {
  const { backend } = await chrome.storage.local.get('backend');
  return backend || DEFAULT_BACKEND;
}

async function getGmailAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!token) {
        reject(new Error('Could not get Google sign-in. Use the Chrome app OAuth client ID in manifest.json (not the Web client), add your extension ID in Google Cloud Console, and reload the extension.'));
        return;
      }
      resolve(token);
    });
  });
}

async function fetchBackend(path, options = {}) {
  const base = await getBackend();
  const url = base.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    ...options,
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

function openLinkGmail() {
  const redirect = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL('success.html') : null;
  getAuthUrl(redirect).then((url) => {
    chrome.tabs.create({ url });
  }).catch((err) => {
    alert('Failed to get auth URL: ' + err.message);
  });
}

window.emailSenderApi = {
  getBackend,
  getGmailAccessToken,
  fetchBackend,
  getAuthUrl,
  openLinkGmail,
};
