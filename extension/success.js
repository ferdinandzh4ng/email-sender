const params = new URLSearchParams(location.search);
const linked = params.get('linked');
const error = params.get('error');
const msg = document.getElementById('msg');
if (linked === '1') {
  msg.textContent = 'Gmail account linked. You can close this tab and schedule campaigns.';
  msg.className = 'success';
} else if (error) {
  msg.textContent = 'Error: ' + (params.get('message') || error);
  msg.className = 'error';
}
