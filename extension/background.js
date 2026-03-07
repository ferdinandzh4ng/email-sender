const BACKEND = 'https://email-sender-dztw.onrender.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ backend: BACKEND });
});
