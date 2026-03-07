const BACKEND = 'http://localhost:3000';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ backend: BACKEND });
});
