const api = window.emailSenderApi;

// --- Tabs ---
document.querySelectorAll('nav [data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav [data-panel]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
    if (btn.dataset.panel === 'dashboard') loadDashboard();
  });
});

// --- Templates (local) ---
async function loadTemplate() {
  const { templateSubject, templateBody } = await chrome.storage.local.get(['templateSubject', 'templateBody']);
  document.getElementById('templateSubject').value = templateSubject || '';
  document.getElementById('templateBody').value = templateBody || '';
}
document.getElementById('saveTemplate').addEventListener('click', async () => {
  await chrome.storage.local.set({
    templateSubject: document.getElementById('templateSubject').value,
    templateBody: document.getElementById('templateBody').value,
  });
  document.getElementById('saveTemplate').textContent = 'Saved.';
  setTimeout(() => { document.getElementById('saveTemplate').textContent = 'Save template (local)'; }, 1500);
});
loadTemplate();

// --- Campaign: Link Gmail ---
document.getElementById('linkGmail').addEventListener('click', () => {
  const successRedirect = chrome.runtime.getURL('success.html');
  api.getAuthUrl(successRedirect).then((url) => {
    chrome.tabs.create({ url });
  }).catch((err) => {
    alert('Failed to get auth URL. Is the backend running? ' + err.message);
  });
});

// --- Campaign: CSV ---
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

function replacePlaceholders(template, row) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (row[key] != null ? String(row[key]) : ''));
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replacePlaceholdersHtml(template, row) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(row[key] != null ? String(row[key]) : ''));
}

function updatePreview() {
  const subject = document.getElementById('templateSubject').value;
  const body = document.getElementById('templateBody').value;
  const el = document.getElementById('preview');
  if (!csvRows.length) {
    el.textContent = '';
    return;
  }
  const row = csvRows[0];
  const subj = replacePlaceholders(subject, row);
  const bodySafe = replacePlaceholdersHtml(body, row);
  el.innerHTML = '<strong>Subject:</strong> ' + escapeHtml(subj) + '<br><br><div class="preview-body">' + bodySafe + '</div>';
}

document.getElementById('templateSubject').addEventListener('input', updatePreview);
document.getElementById('templateBody').addEventListener('input', updatePreview);

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      cur += c;
    } else if (c === ',') {
    out.push(cur.trim());
    cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

// --- Campaign: Schedule ---
document.getElementById('scheduleCampaign').addEventListener('click', async () => {
  const statusEl = document.getElementById('scheduleStatus');
  statusEl.textContent = '';
  statusEl.className = '';

  const subject = document.getElementById('templateSubject').value.trim();
  const body = document.getElementById('templateBody').value.trim();
  const sendAtInput = document.getElementById('sendAt').value;
  if (!subject || !body) {
    statusEl.textContent = 'Save a template with subject and body first.';
    statusEl.className = 'error';
    return;
  }
  if (!csvRows.length) {
    statusEl.textContent = 'Upload a CSV with at least one row.';
    statusEl.className = 'error';
    return;
  }
  if (!sendAtInput) {
    statusEl.textContent = 'Pick a date and time to send.';
    statusEl.className = 'error';
    return;
  }

  let attachmentStorageKey = null;
  const attachmentInput = document.getElementById('attachmentFile');
  if (attachmentInput.files && attachmentInput.files[0]) {
    try {
      const file = attachmentInput.files[0];
      const base64 = await fileToBase64(file);
      const data = await api.fetchBackend('/campaigns/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content: base64 }),
      });
      attachmentStorageKey = data.attachment_storage_key;
    } catch (err) {
      statusEl.textContent = 'Upload failed: ' + err.message;
      statusEl.className = 'error';
      return;
    }
  }

  const sendAt = new Date(sendAtInput).toISOString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const payload = {
      sendAt,
      timezone,
      subject_template: subject,
      body_template: body,
      csv_rows: csvRows,
    };
    if (attachmentStorageKey) payload.attachment_storage_key = attachmentStorageKey;
    await api.fetchBackend('/campaigns/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    statusEl.textContent = 'Campaign scheduled. Emails will be sent at the chosen time (backend must be running).';
    statusEl.className = 'success';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'error';
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Dashboard ---
async function loadDashboard() {
  const listEl = document.getElementById('dashboardList');
  listEl.innerHTML = 'Loading...';
  try {
    const data = await api.fetchBackend('/campaigns/sent');
    const campaigns = data.campaigns || [];
    if (campaigns.length === 0) {
      listEl.innerHTML = '<p>No sent campaigns yet.</p>';
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Scheduled</th>
            <th>Recipients</th>
            <th>Sent / Failed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.map((c) => `
            <tr>
              <td>${escapeHtml(c.subject_template)}</td>
              <td>${escapeHtml(c.send_at)}</td>
              <td>${c.recipient_count}</td>
              <td>${c.sent_count || 0} / ${c.failed_count || 0}</td>
              <td>${escapeHtml(c.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    listEl.innerHTML = '<p class="error">Failed to load: ' + escapeHtml(err.message) + '</p>';
  }
}

document.getElementById('refreshDashboard').addEventListener('click', loadDashboard);

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
