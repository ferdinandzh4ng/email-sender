document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('testSend').addEventListener('click', async () => {
  const to = prompt('Test email recipient:', '');
  if (!to || !to.trim()) return;
  const status = document.getElementById('status');
  status.textContent = 'Sending...';
  status.className = '';
  try {
    const token = await window.emailSenderApi.getGmailAccessToken();
    if (!token) {
      status.textContent = 'Could not get Google sign-in. Set Chrome app OAuth client ID in manifest.json and reload the extension.';
      status.className = 'error';
      return;
    }
    await window.emailSenderApi.fetchBackend('/campaigns/send-test', {
      method: 'POST',
      body: JSON.stringify({
        accessToken: token,
        to: to.trim(),
        subject: 'Test from Gmail Campaign Sender',
        body: 'This is a test email.',
      }),
    });
    status.textContent = 'Test email sent.';
    status.className = 'success';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'error';
  }
});
