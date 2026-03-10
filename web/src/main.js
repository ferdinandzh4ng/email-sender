import { api } from './api.js';

const SESSION_SIGNED_IN_KEY = 'email-sender-signed-in';
let linkedUser = { linked: false, email: null };

function isSignedInThisSession() {
  return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_SIGNED_IN_KEY) === '1';
}

function setSignedInThisSession(signedIn) {
  if (typeof sessionStorage === 'undefined') return;
  if (signedIn) sessionStorage.setItem(SESSION_SIGNED_IN_KEY, '1');
  else sessionStorage.removeItem(SESSION_SIGNED_IN_KEY);
}

function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function updateLinkedUI() {
  const headerEl = document.getElementById('headerUser');
  const linkSection = document.getElementById('linkGmailSection');
  const linkedSection = document.getElementById('linkedAccountSection');
  const linkedEmailEl = document.getElementById('linkedAccountEmail');
  const signOutBtn = document.getElementById('signOutGmail');
  const dashboardSignInSection = document.getElementById('dashboardSignInSection');
  const showAsLinked = linkedUser.linked && linkedUser.email && isSignedInThisSession();
  if (showAsLinked) {
    if (headerEl) headerEl.innerHTML = `<span class="avatar">${(linkedUser.email[0] || '?').toUpperCase()}</span><span><span class="linked-badge">Linked</span><span class="email" title="${escapeAttr(linkedUser.email)}">${escapeHtml(linkedUser.email)}</span></span>`;
    if (linkSection) linkSection.style.display = 'none';
    if (linkedSection) linkedSection.style.display = 'block';
    if (linkedEmailEl) linkedEmailEl.textContent = linkedUser.email;
    if (signOutBtn) signOutBtn.style.display = 'inline-block';
    if (dashboardSignInSection) dashboardSignInSection.style.display = 'none';
  } else {
    if (headerEl) headerEl.innerHTML = '<span class="not-linked">Not signed in — sign in with Google in New campaign</span>';
    if (linkSection) linkSection.style.display = 'block';
    if (linkedSection) linkedSection.style.display = 'none';
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (dashboardSignInSection) dashboardSignInSection.style.display = 'block';
  }
}

async function loadLinkedUser() {
  try {
    const data = await api.fetchBackend('/auth/me');
    linkedUser = { linked: !!data.linked, email: data.email || null };
    updateLinkedUI();
  } catch (err) {
    linkedUser = { linked: false, email: null };
    const headerEl = document.getElementById('headerUser');
    if (headerEl) headerEl.innerHTML = '<span class="not-linked">Backend unreachable — set VITE_BACKEND_URL?</span>';
    const linkSection = document.getElementById('linkGmailSection');
    const linkedSection = document.getElementById('linkedAccountSection');
    const dashboardSignInSection = document.getElementById('dashboardSignInSection');
    if (linkSection) linkSection.style.display = 'block';
    if (linkedSection) linkedSection.style.display = 'none';
    if (dashboardSignInSection) dashboardSignInSection.style.display = 'block';
  }
}

const titles = { dashboard: 'Dashboard', templates: 'Templates', campaign: 'New campaign' };
document.querySelectorAll('.side-nav [data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-nav [data-panel]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = btn.dataset.panel;
    document.getElementById('panel-' + panel).classList.add('active');
    document.getElementById('headerTitle').textContent = titles[panel] || panel;
    if (panel === 'dashboard') loadDashboard();
    if (panel === 'templates') loadTemplatesList();
    if (panel === 'campaign') {
      resetCampaignPanel();
      loadLinkedUser();
      loadCampaignTemplatePicker();
    }
  });
});

function resetCampaignPanel() {
  const statusEl = document.getElementById('scheduleStatus');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.className = '';
  }
  setSendButtonsLoading(false);
}

let templatesList = [];
function renderTemplatesList(container, list, onSelect, onDelete) {
  if (!container) return;
  if (!list || list.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No templates yet. Create one above.</p>';
    return;
  }
  const showDelete = typeof onDelete === 'function';
  container.innerHTML = list.map((t) => {
    const cardHtml = `<div class="template-card" data-id="${t.id}" role="button" tabindex="0"><div class="template-card-body"><div class="name">${escapeHtml(t.name || 'Default')}</div><div class="subject">${escapeHtml((t.subject || '').slice(0, 60))}${(t.subject || '').length > 60 ? '…' : ''}</div><div class="updated">${t.updated_at ? new Date(t.updated_at).toLocaleDateString() : ''}</div></div>${showDelete ? `<button type="button" class="template-card-delete btn btn-secondary btn-sm" data-id="${escapeHtml(String(t.id))}" title="Delete template">Delete</button>` : ''}</div>`;
    return cardHtml;
  }).join('');
  container.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.template-card-delete')) return;
      const t = list.find((x) => String(x.id) === String(card.dataset.id));
      if (t && onSelect) onSelect(t);
    });
  });
  if (showDelete) {
    container.querySelectorAll('.template-card-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = list.find((x) => String(x.id) === String(btn.dataset.id));
        if (t && onDelete) onDelete(t);
      });
    });
  }
}

async function loadTemplatesList() {
  try {
    const data = await api.fetchBackend('/templates');
    templatesList = Array.isArray(data) ? data : (data ? [data] : []);
    renderTemplatesList(document.getElementById('templatesList'), templatesList, (t) => {
      document.getElementById('templateName').value = t.name || '';
      document.getElementById('templateSubject').value = t.subject || '';
      document.getElementById('templateBody').value = t.body || '';
      document.getElementById('saveTemplate').dataset.editId = t.id;
      const saveBtn = document.getElementById('saveTemplate');
      if (saveBtn) saveBtn.textContent = 'Update template';
      document.querySelectorAll('#templatesList .template-card').forEach((c) => c.classList.remove('selected'));
      const sel = document.querySelector(`#templatesList .template-card[data-id="${t.id}"]`);
      if (sel) sel.classList.add('selected');
    }, async (t) => {
      if (!confirm(`Delete template "${(t.name || 'Default').replace(/"/g, '')}"?`)) return;
      const btn = document.querySelector(`#templatesList .template-card-delete[data-id="${t.id}"]`);
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        await api.fetchBackend(`/templates/${t.id}`, { method: 'DELETE' });
        if (document.getElementById('saveTemplate').dataset.editId === String(t.id)) {
          document.getElementById('saveTemplate').dataset.editId = '';
          document.getElementById('saveTemplate').textContent = 'Save template';
          document.getElementById('templateName').value = '';
          document.getElementById('templateSubject').value = '';
          document.getElementById('templateBody').value = '';
        }
        loadTemplatesList();
        loadCampaignTemplatePicker();
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
        document.getElementById('saveTemplateStatus').textContent = err.message || 'Delete failed';
        document.getElementById('saveTemplateStatus').className = 'error';
      }
    });
  } catch (err) {
    templatesList = [];
    document.getElementById('templatesList').innerHTML = '<p class="error">Could not load templates.</p>';
  }
}

document.getElementById('saveTemplate').addEventListener('click', async () => {
  const name = document.getElementById('templateName').value.trim() || 'Default';
  const subject = document.getElementById('templateSubject').value;
  const body = document.getElementById('templateBody').value;
  const editId = document.getElementById('saveTemplate').dataset.editId;
  const statusEl = document.getElementById('saveTemplateStatus');
  statusEl.textContent = '';
  statusEl.className = '';
  try {
    const payload = { name, subject, body };
    if (editId) payload.id = editId;
    await api.fetchBackend('/templates', { method: 'POST', body: JSON.stringify(payload) });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'success';
    document.getElementById('saveTemplate').dataset.editId = '';
    loadTemplatesList();
    loadCampaignTemplatePicker();
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'error';
  }
});

let selectedTemplateId = null;
let campaignTemplatesList = [];
let pendingTemplateId = null;

async function loadCampaignTemplatePicker() {
  try {
    const data = await api.fetchBackend('/templates');
    campaignTemplatesList = Array.isArray(data) ? data : (data ? [data] : []);
    const container = document.getElementById('campaignTemplatePicker');
    if (!campaignTemplatesList.length) {
      container.innerHTML = '<p style="color: var(--text-muted);">No templates. Create one in Templates.</p>';
      return;
    }
    container.innerHTML = campaignTemplatesList.map((t) => `<div class="template-card" data-id="${t.id}"><div class="name">${escapeHtml(t.name || 'Default')}</div><div class="subject">${escapeHtml((t.subject || '').slice(0, 50))}${(t.subject || '').length > 50 ? '…' : ''}</div></div>`).join('');
    container.querySelectorAll('.template-card').forEach((card) => {
      card.addEventListener('click', () => {
        const t = campaignTemplatesList.find((x) => String(x.id) === String(card.dataset.id));
        if (!t) return;
        container.querySelectorAll('.template-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTemplateId = t.id;
        document.getElementById('campaignSubject').value = t.subject || '';
        document.getElementById('campaignBody').value = t.body || '';
        updatePreview();
      });
    });
    if (pendingTemplateId) {
      const card = container.querySelector(`.template-card[data-id="${pendingTemplateId}"]`);
      if (card) card.click();
      pendingTemplateId = null;
    } else if (campaignTemplatesList.length && !document.querySelector('.template-card.selected')) {
      const first = container.querySelector('.template-card');
      if (first) first.click();
    }
  } catch (err) {
    document.getElementById('campaignTemplatePicker').innerHTML = '<p class="error">Could not load templates.</p>';
  }
}

async function goToGoogleSignIn() {
  const successRedirect = window.location.origin + '/linked.html';
  try {
    const url = await api.getAuthUrl(successRedirect);
    window.location.href = url;
  } catch (err) {
    alert('Failed to get auth URL. Is the backend running? ' + err.message);
  }
}

document.getElementById('linkGmail').addEventListener('click', goToGoogleSignIn);
document.getElementById('dashboardSignInBtn').addEventListener('click', goToGoogleSignIn);

document.getElementById('relinkGmail').addEventListener('click', async () => {
  const successRedirect = window.location.origin + '/linked.html';
  try {
    const url = await api.getAuthUrl(successRedirect);
    window.location.href = url;
  } catch (err) {
    alert('Failed to get auth URL. ' + err.message);
  }
});

document.getElementById('signOutGmail').addEventListener('click', async () => {
  try {
    await api.logout();
  } catch (_) {}
  setSignedInThisSession(false);
  linkedUser = { linked: false, email: null };
  updateLinkedUI();
});

document.getElementById('sendTestBtn').addEventListener('click', async () => {
  const to = document.getElementById('testEmailTo').value.trim();
  const statusEl = document.getElementById('testEmailStatus');
  statusEl.textContent = '';
  statusEl.className = '';
  if (!to) {
    statusEl.textContent = 'Enter an email address.';
    statusEl.className = 'error';
    return;
  }
  statusEl.textContent = 'Sending…';
  try {
    await api.fetchBackend('/campaigns/send-test-linked', { method: 'POST', body: JSON.stringify({ to }) });
    statusEl.textContent = 'Test email sent.';
    statusEl.className = 'success';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'error';
  }
});

if (typeof window !== 'undefined' && window.location.search.includes('linked=1') && !window.location.search.includes('claim=')) {
  setSignedInThisSession(true);
  loadLinkedUser();
  window.history.replaceState({}, '', window.location.pathname || '/');
}

let csvRows = [];
let csvHeaders = [];

document.getElementById('csvFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      document.getElementById('csvInfo').textContent = 'CSV must have header row and at least one data row.';
      csvRows = [];
      return;
    }
    const headerLine = lines[0];
    csvHeaders = parseCSVLine(headerLine);
    if (!csvHeaders.map((h) => h.toLowerCase()).includes('email')) {
      document.getElementById('csvInfo').textContent = 'CSV must include an "email" column.';
      csvRows = [];
      return;
    }
    csvRows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const row = {};
      csvHeaders.forEach((h, j) => { row[h] = vals[j] != null ? vals[j] : ''; });
      csvRows.push(row);
    }
    document.getElementById('csvInfo').textContent = `Loaded ${csvRows.length} recipient(s). Columns: ${csvHeaders.join(', ')}`;
    updatePreview();
  };
  reader.readAsText(file, 'UTF-8');
});

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (inQuotes) cur += c;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function replacePlaceholders(template, row) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (row[key] != null ? String(row[key]) : ''));
}

function replacePlaceholdersHtml(template, row) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(row[key] != null ? String(row[key]) : ''));
}

function updatePreview() {
  const subject = document.getElementById('campaignSubject').value;
  const body = document.getElementById('campaignBody').value;
  const el = document.getElementById('preview');
  if (!el) return;
  if (!csvRows.length) { el.textContent = ''; return; }
  const row = csvRows[0];
  const subj = replacePlaceholders(subject, row);
  const bodySafe = replacePlaceholdersHtml(body, row);
  el.innerHTML = '<strong>Subject:</strong> ' + escapeHtml(subj) + '<br><br><div class="preview-body">' + bodySafe + '</div>';
}

document.getElementById('campaignSubject').addEventListener('input', updatePreview);
document.getElementById('campaignBody').addEventListener('input', updatePreview);

async function uploadAttachmentIfAny() {
  const attachmentInput = document.getElementById('attachmentFile');
  if (!attachmentInput?.files?.length) return null;
  const file = attachmentInput.files[0];
  const base64 = await fileToBase64(file);
  const data = await api.fetchBackend('/campaigns/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, content: base64 }) });
  return data.attachment_storage_key || null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getCampaignPayload() {
  const subject = document.getElementById('campaignSubject').value.trim();
  const body = document.getElementById('campaignBody').value.trim();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { subject_template: subject, body_template: body, csv_rows: csvRows, timezone };
}

function goToDashboard() {
  const btn = document.querySelector('.side-nav [data-panel="dashboard"]');
  if (btn) btn.click();
}

document.getElementById('openCalendar').addEventListener('click', () => {
  const input = document.getElementById('sendAt');
  input.focus();
  if (typeof input.showPicker === 'function') input.showPicker();
});

function setSendButtonsLoading(loading) {
  const sendBtn = document.getElementById('sendNowBtn');
  const scheduleBtn = document.getElementById('scheduleCampaign');
  if (sendBtn) {
    sendBtn.disabled = loading;
    sendBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (scheduleBtn) {
    scheduleBtn.disabled = loading;
    scheduleBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
}

document.getElementById('sendNowBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('scheduleStatus');
  statusEl.textContent = '';
  statusEl.className = '';
  const subject = document.getElementById('campaignSubject').value.trim();
  const body = document.getElementById('campaignBody').value.trim();
  if (!subject || !body) { statusEl.textContent = 'Pick a template and ensure subject and body are set.'; statusEl.className = 'error'; return; }
  if (!csvRows.length) { statusEl.textContent = 'Upload a CSV with at least one row.'; statusEl.className = 'error'; return; }
  let attachmentStorageKey = null;
  try { attachmentStorageKey = await uploadAttachmentIfAny(); } catch (err) { statusEl.textContent = 'Upload failed: ' + err.message; statusEl.className = 'error'; return; }
  const payload = getCampaignPayload();
  if (attachmentStorageKey) payload.attachment_storage_key = attachmentStorageKey;
  setSendButtonsLoading(true);
  statusEl.textContent = 'Sending…';
  statusEl.className = '';
  try {
    await api.fetchBackend('/campaigns/send-now', { method: 'POST', body: JSON.stringify(payload) });
    statusEl.textContent = 'Sent! Redirecting to dashboard…';
    statusEl.className = 'success';
    goToDashboard();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'error';
    setSendButtonsLoading(false);
  }
});

document.getElementById('scheduleCampaign').addEventListener('click', async () => {
  const statusEl = document.getElementById('scheduleStatus');
  statusEl.textContent = '';
  statusEl.className = '';
  const subject = document.getElementById('campaignSubject').value.trim();
  const body = document.getElementById('campaignBody').value.trim();
  const sendAtInput = document.getElementById('sendAt').value;
  if (!subject || !body) { statusEl.textContent = 'Pick a template and ensure subject and body are set.'; statusEl.className = 'error'; return; }
  if (!csvRows.length) { statusEl.textContent = 'Upload a CSV with at least one row.'; statusEl.className = 'error'; return; }
  if (!sendAtInput) { statusEl.textContent = 'Pick a date and time to send.'; statusEl.className = 'error'; return; }
  let attachmentStorageKey = null;
  try { attachmentStorageKey = await uploadAttachmentIfAny(); } catch (err) { statusEl.textContent = 'Upload failed: ' + err.message; statusEl.className = 'error'; return; }
  const payload = getCampaignPayload();
  payload.sendAt = new Date(sendAtInput).toISOString();
  if (attachmentStorageKey) payload.attachment_storage_key = attachmentStorageKey;
  setSendButtonsLoading(true);
  statusEl.textContent = 'Scheduling…';
  statusEl.className = '';
  try {
    await api.fetchBackend('/campaigns/schedule', { method: 'POST', body: JSON.stringify(payload) });
    statusEl.textContent = 'Scheduled! Redirecting to dashboard…';
    statusEl.className = 'success';
    goToDashboard();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'error';
    setSendButtonsLoading(false);
  }
});

async function loadDashboard() {
  loadLinkedUser();
  const statEl = document.getElementById('statCards');
  const scheduledEl = document.getElementById('scheduledList');
  const dashTplEl = document.getElementById('dashboardTemplates');
  const listEl = document.getElementById('dashboardList');
  statEl.innerHTML = '';
  scheduledEl.innerHTML = 'Loading…';
  listEl.innerHTML = 'Loading…';
  try {
    const [scheduledRes, sentRes, templatesRes] = await Promise.all([
      api.fetchBackend('/campaigns/scheduled').catch(() => ({ campaigns: [] })),
      api.fetchBackend('/campaigns/sent').catch(() => ({ campaigns: [] })),
      api.fetchBackend('/templates').catch(() => []),
    ]);
    const scheduled = scheduledRes.campaigns || [];
    const sent = sentRes.campaigns || [];
    const tplList = Array.isArray(templatesRes) ? templatesRes : (templatesRes ? [templatesRes] : []);
    const sentCount = sent.reduce((acc, c) => acc + (c.sent_count || 0), 0);
    statEl.innerHTML = `<div class="stat-card"><div class="num">${scheduled.length}</div><div class="label">Scheduled</div></div><div class="stat-card"><div class="num">${sent.length}</div><div class="label">Sent campaigns</div></div><div class="stat-card"><div class="num">${sentCount}</div><div class="label">Emails sent</div></div>`;
    if (scheduled.length === 0) scheduledEl.innerHTML = '<p style="color: var(--text-muted);">No emails scheduled.</p>';
    else {
      scheduledEl.innerHTML = '<ul class="schedule-list">' + scheduled.map((c) => `<li data-id="${escapeHtml(c.id)}"><div><div class="subject">${escapeHtml(c.subject_template)}</div><div class="meta">${c.recipient_count} recipient(s) · ${new Date(c.send_at).toLocaleString()}</div></div><button type="button" class="btn btn-secondary btn-sm cancel-campaign">Cancel</button></li>`).join('') + '</ul>';
      scheduledEl.querySelectorAll('.cancel-campaign').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const li = e.target.closest('li');
          const id = li?.dataset?.id;
          if (!id) return;
          e.target.disabled = true;
          e.target.textContent = 'Cancelling…';
          try {
            await api.fetchBackend(`/campaigns/scheduled/${id}`, { method: 'DELETE' });
            loadDashboard();
          } catch (err) {
            e.target.disabled = false;
            e.target.textContent = 'Cancel';
            scheduledEl.insertAdjacentHTML('beforeend', '<p class="error">' + escapeHtml(err.message) + '</p>');
            setTimeout(() => scheduledEl.querySelector('.error')?.remove(), 3000);
          }
        });
      });
    }
    renderTemplatesList(dashTplEl, tplList, (t) => {
      pendingTemplateId = t.id;
      document.querySelector('.side-nav [data-panel="campaign"]').click();
    });
    if (sent.length === 0) listEl.innerHTML = '<p style="color: var(--text-muted);">No sent campaigns yet.</p>';
    else listEl.innerHTML = `<table><thead><tr><th>Subject</th><th>Scheduled</th><th>Recipients</th><th>Sent / Failed</th><th>Status</th></tr></thead><tbody>${sent.map((c) => `<tr><td>${escapeHtml(c.subject_template)}</td><td>${escapeHtml(c.send_at)}</td><td>${c.recipient_count}</td><td>${c.sent_count || 0} / ${c.failed_count || 0}</td><td>${escapeHtml(c.status)}</td></tr>`).join('')}</tbody></table>`;
  } catch (err) {
    scheduledEl.innerHTML = '<p class="error">Failed to load.</p>';
    listEl.innerHTML = '<p class="error">' + escapeHtml(err.message) + '</p>';
  }
}

document.getElementById('refreshDashboard').addEventListener('click', loadDashboard);

function applyPanelFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const panel = params.get('panel');
  if (panel && ['dashboard', 'templates', 'campaign'].includes(panel)) {
    document.querySelectorAll('.side-nav [data-panel]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    const btn = document.querySelector(`.side-nav [data-panel="${panel}"]`);
    if (btn) {
      btn.classList.add('active');
      document.getElementById('panel-' + panel)?.classList.add('active');
      document.getElementById('headerTitle').textContent = titles[panel] || panel;
      if (panel === 'dashboard') loadDashboard();
      if (panel === 'templates') loadTemplatesList();
      if (panel === 'campaign') {
        resetCampaignPanel();
        loadLinkedUser();
        loadCampaignTemplatePicker();
      }
    }
    window.history.replaceState({}, '', window.location.pathname || '/');
  }
}

(async function init() {
  const params = new URLSearchParams(window.location.search);
  const claim = params.get('claim');
  if (claim) {
    try {
      const data = await api.fetchBackend('/auth/claim?claim=' + encodeURIComponent(claim));
      if (data.token) api.setAuthToken(data.token);
      setSignedInThisSession(true);
      const u = new URL(window.location.href);
      u.searchParams.delete('claim');
      const search = u.search ? u.search : '';
      window.history.replaceState({}, '', u.pathname + search || '/');
    } catch (_) {}
  }
  await loadLinkedUser();
  if (sessionStorage.getItem('email-sender-just-linked')) {
    sessionStorage.removeItem('email-sender-just-linked');
    setSignedInThisSession(true);
    await loadLinkedUser();
  }
  applyPanelFromUrl();
  loadDashboard();
  loadCampaignTemplatePicker();
})();
