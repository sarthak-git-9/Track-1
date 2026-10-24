const API_BASE = 'http://127.0.0.1:8765';
const $ = (id) => document.getElementById(id);
let activeSessionId = null;
let activeDocumentType = 'text';
let activeFindings = [];
let pendingAdditions = [];
let redactedAndVerified = false;

function setMessage(element, message, kind = '') {
  element.textContent = message;
  element.className = `message${kind ? ` ${kind}` : ''}`;
}

function token() { return localStorage.getItem('bharosaApiToken') || ''; }

async function api(path, body, method = 'POST') {
  const headers = {};
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (path !== '/health') headers['X-Bharosa-Token'] = token();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({}));
      message = error.detail || message;
    }
    throw new Error(message);
  }
  return contentType.includes('application/json') ? response.json() : response;
}

async function refreshBackendStatus() {
  const badge = $('backend-badge');
  try {
    const health = await api('/health', undefined, 'GET');
    badge.textContent = health.model?.status === 'reachable' ? 'Backend + model ready' : 'Backend ready';
    badge.className = 'status-pill status-ok';
    if (!token()) setMessage($('redact-message'), 'Backend is reachable. Paste the session token from its terminal to enable actions.');
    else if (health.model?.status === 'not_configured') setMessage($('redact-message'), 'Backend is ready. Local model is not configured; deterministic pattern detection remains available.');
    else if (health.model?.status === 'model_not_found') setMessage($('redact-message'), 'Backend is ready, but the configured model tag was not found in Ollama. Check OLLAMA_MODEL.');
    else if (health.model?.status === 'unavailable') setMessage($('redact-message'), 'Backend is ready, but the local model is unavailable. Pattern-based detection can still run.', 'error');
  } catch (error) {
    badge.textContent = 'Backend offline';
    badge.className = 'status-pill status-bad';
    setMessage($('redact-message'), 'Start the backend on 127.0.0.1:8765 and paste its session token.', 'error');
  }
}

function selectTab(tab) {
  const redact = tab === 'redact';
  $('tab-redact').classList.toggle('is-active', redact);
  $('tab-site').classList.toggle('is-active', !redact);
  $('tab-redact').setAttribute('aria-selected', String(redact));
  $('tab-site').setAttribute('aria-selected', String(!redact));
  $('panel-redact').classList.toggle('hidden', !redact);
  $('panel-site').classList.toggle('hidden', redact);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function renderFindings(findings) {
  activeFindings = findings || [];
  $('finding-count').textContent = `${activeFindings.length} finding${activeFindings.length === 1 ? '' : 's'}`;
  const root = $('findings-list');
  root.innerHTML = '';
  if (!activeFindings.length) {
    root.innerHTML = '<div class="finding"><div class="finding-main"><strong>No pattern matches found</strong><div class="finding-reason">This is not a guarantee that the document contains no personal information. You can add a missed value above.</div></div></div>';
    return;
  }
  root.innerHTML = activeFindings.map((finding) => `
    <label class="finding">
      <input type="checkbox" data-finding-id="${escapeHtml(finding.id)}" ${finding.approved ? 'checked' : ''}>
      <span class="finding-main">
        <span class="finding-top"><span class="finding-type">${escapeHtml(finding.type)}</span><span class="finding-count">${Number(finding.occurrences) || 1} occurrence(s)</span></span>
        <div class="finding-value">${escapeHtml(finding.value)}</div>
        <div class="finding-reason">${escapeHtml(finding.reason || 'Review before redacting.')}</div>
      </span>
    </label>`).join('');
}

function clearRedactionUi(message = 'Session cleared. The backend removed this document from memory.') {
  activeSessionId = null;
  activeDocumentType = 'text';
  $('export-format').value = 'md';
  Array.from($('export-format').options).forEach((option) => { option.disabled = option.value === 'pdf'; });
  activeFindings = [];
  pendingAdditions = [];
  redactedAndVerified = false;
  $('document-file').value = '';
  $('scan-document').disabled = true;
  $('clear-session').disabled = true;
  $('findings-section').classList.add('hidden');
  $('findings-list').innerHTML = '';
  $('verification-panel').classList.add('hidden');
  $('export-document').disabled = true;
  $('redacted-preview').textContent = 'Your preview will appear here after applying decisions.';
  $('missed-value').value = '';
  setMessage($('redact-message'), message, 'success');
}

$('save-token').addEventListener('click', async () => {
  const value = $('api-token').value.trim();
  if (!value) return setMessage($('redact-message'), 'Paste the token printed by the backend first.', 'error');
  localStorage.setItem('bharosaApiToken', value);
  setMessage($('redact-message'), 'Token saved in the extension. Checking the backend…', 'success');
  await refreshBackendStatus();
});
$('api-token').value = token();
$('tab-redact').addEventListener('click', () => selectTab('redact'));
$('tab-site').addEventListener('click', () => selectTab('site'));
$('document-file').addEventListener('change', () => {
  $('scan-document').disabled = !$('document-file').files?.length;
  if ($('document-file').files?.length) setMessage($('redact-message'), `Selected ${$('document-file').files[0].name}. Click Find sensitive data to scan it locally.`);
});

$('scan-document').addEventListener('click', async () => {
  const file = $('document-file').files?.[0];
  if (!file) return;
  if (!token()) return setMessage($('redact-message'), 'Save the backend token before scanning.', 'error');
  const isPdf = /\.pdf$/i.test(file.name);
  const isText = /\.(txt|md|markdown)$/i.test(file.name);
  if (!isPdf && !isText) return setMessage($('redact-message'), 'Choose a .txt, .md, .markdown, or selectable-text .pdf file.', 'error');
  const maxBytes = isPdf ? 10 * 1024 * 1024 : 500000;
  if (file.size > maxBytes) return setMessage($('redact-message'), isPdf ? 'PDFs must be 10 MB or smaller.' : 'For this prototype, keep text files below 500 KB.', 'error');
  setMessage($('redact-message'), isPdf ? 'Encoding PDF for local scanning. Scanned PDFs are unsupported…' : 'Reading and scanning in memory. Please keep this popup open…');
  $('scan-document').disabled = true;
  try {
    let result;
    if (isPdf) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      result = await api('/redact/pdf/start', {
        filename: file.name,
        content_b64: btoa(binary),
      });
      activeDocumentType = 'pdf';
      $('export-format').value = 'pdf';
      Array.from($('export-format').options).forEach((option) => { option.disabled = option.value !== 'pdf'; });
    } else {
      const content = await file.text();
      result = await api('/redact/start', {filename: file.name, content});
      activeDocumentType = 'text';
      $('export-format').value = 'md';
      Array.from($('export-format').options).forEach((option) => { option.disabled = option.value === 'pdf'; });
    }
    activeSessionId = result.session_id;
    redactedAndVerified = false;
    $('clear-session').disabled = false;
    $('findings-section').classList.remove('hidden');
    $('verification-panel').classList.add('hidden');
    $('export-document').disabled = true;
    $('redacted-preview').textContent = 'Approve the findings, then apply and verify redactions.';
    renderFindings(result.findings);
    setMessage($('redact-message'), `${result.findings.length} candidate finding(s). Model status: ${result.model_status}. Nothing has been changed yet.`, 'success');
  } catch (error) {
    setMessage($('redact-message'), error.message, 'error');
  } finally {
    $('scan-document').disabled = false;
  }
});

$('add-missed').addEventListener('click', () => {
  const value = $('missed-value').value.trim();
  if (!value) return;
  if (!activeSessionId) return setMessage($('redact-message'), 'Scan a document before adding a missed finding.', 'error');
  pendingAdditions.push({value, type: $('missed-type').value});
  $('missed-value').value = '';
  setMessage($('redact-message'), `${pendingAdditions.length} manual finding(s) queued. They will be approved when you apply decisions.`);
});

$('apply-decisions').addEventListener('click', async () => {
  if (!activeSessionId) return;
  const decisions = {};
  document.querySelectorAll('[data-finding-id]').forEach((checkbox) => { decisions[checkbox.dataset.findingId] = checkbox.checked; });
  $('apply-decisions').disabled = true;
  setMessage($('redact-message'), 'Applying approved replacements and running independent checks…');
  try {
    const updated = await api('/redact/update', {session_id: activeSessionId, decisions, additions: pendingAdditions});
    pendingAdditions = [];
    renderFindings(updated.findings);
    $('redacted-preview').textContent = updated.redacted_preview;
    const verification = await api('/redact/verify', {session_id: activeSessionId});
    redactedAndVerified = verification.status === 'pass';
    $('export-document').disabled = !redactedAndVerified;
    const panel = $('verification-panel');
    panel.classList.remove('hidden', 'pass', 'fail');
    panel.classList.add(verification.status === 'pass' ? 'pass' : 'fail');
    const problems = (verification.problems || []).map((p) => p.detail).join(' ');
    panel.textContent = verification.status === 'pass'
      ? `✓ No leaks found by our checks. ${verification.approved_count} finding(s) approved. Amount/date integrity checks passed where supported. Detection is best-effort; review before sharing.`
      : `Verification failed. ${problems || 'Review the document and retry.'}`;
    const successMessage = activeDocumentType === 'pdf'
      ? `✓ Approved values are no longer extractable from PDF page text. ${verification.approved_count} finding(s) approved. Non-text content and metadata may still contain sensitive data.`
      : 'Review the preview and verification result before exporting.';
    setMessage($('redact-message'), successMessage, verification.status === 'pass' ? 'success' : 'error');
  } catch (error) {
    setMessage($('redact-message'), error.message, 'error');
  } finally {
    $('apply-decisions').disabled = false;
  }
});

$('export-document').addEventListener('click', async () => {
  if (!activeSessionId || !redactedAndVerified) return;
  try {
    const response = await api('/redact/export', {session_id: activeSessionId, format: $('export-format').value});
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bharosa-redacted.${$('export-format').value}`;
    link.click();
    URL.revokeObjectURL(url);
    clearRedactionUi('Redacted file downloaded. Bharosa cleared the session from backend memory.');
  } catch (error) {
    setMessage($('redact-message'), error.message, 'error');
  }
});

$('clear-session').addEventListener('click', async () => {
  if (activeSessionId && token()) {
    try { await api('/redact/clear', {session_id: activeSessionId}); } catch (_) { /* Clear local UI even if backend restarted. */ }
  }
  clearRedactionUi();
});

function verdictLabel(category) {
  return ({very_unsafe:'VERY UNSAFE', unsafe:'UNSAFE', suspicious:'SUSPICIOUS', safe:'SAFE', very_safe:'VERY SAFE', insufficient_evidence:'NOT ENOUGH INFORMATION'})[category] || String(category || 'UNKNOWN').toUpperCase();
}

function renderSiteResult(result) {
  const root = $('site-result');
  const head = verdictLabel(result.category);
  const evidence = (result.evidence || []).map((item) => `
    <li class="evidence-item"><span class="evidence-status ${item.status === 'ok' ? '' : 'failed'}">${escapeHtml(item.status)}</span><strong>${escapeHtml(item.id)} · ${escapeHtml(item.check)}</strong><p>${escapeHtml(item.result)}${item.source ? ` — ${escapeHtml(item.source)}` : ''}${item.detail ? `\n${escapeHtml(item.detail)}` : ''}</p></li>`).join('');
  const notChecked = (result.not_checked || []).map(escapeHtml).join(' · ') || 'None listed';
  root.innerHTML = `<div class="site-result-head"><p class="verdict-label">${escapeHtml(head)}</p><p class="verdict-url">${escapeHtml(result.url)}</p></div><div class="verdict-reason">${escapeHtml(result.reason)}<br><br><strong>${escapeHtml(result.disclaimer || 'Risk assessment, not a guarantee.')}</strong></div><h3 class="evidence-title">Evidence ledger</h3><ul class="evidence-list">${evidence}</ul><div class="not-checked"><strong>Could not check:</strong> ${notChecked}</div>`;
  root.classList.remove('hidden');
}

async function runSiteCheck(url, mode, pageSnapshot) {
  if (!token()) throw new Error('Save the backend token first.');
  const result = await api('/site/check', {url, mode, page_snapshot: pageSnapshot || null, social_search: false});
  renderSiteResult(result);
  return result;
}

$('check-current-tab').addEventListener('click', async () => {
  setMessage($('site-message'), 'Taking a one-time snapshot of visible page text and form metadata…');
  $('site-result').classList.add('hidden');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('This page does not allow inspection. Open a normal HTTP or HTTPS website.');
    const injection = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: () => {
        const fields = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 100).map((el) => {
          const label = Array.from(el.labels || []).map((node) => node.innerText || '').join(' ').slice(0, 160);
          const clues = `${label} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('autocomplete') || ''}`.toLowerCase();
          let type = (el.getAttribute('type') || el.tagName || 'text').toLowerCase();
          if (type === 'password') type = 'password';
          else if (/\botp\b|one.?time|verification code|passcode/.test(clues)) type = 'otp';
          else if (/credit.?card|debit.?card|cvv|cvc|payment|bank account|upi/.test(clues)) type = 'payment';
          let actionHost = '';
          try { if (el.form?.action) actionHost = new URL(el.form.action).hostname; } catch (_) {}
          return {type, label, autocomplete: (el.getAttribute('autocomplete') || '').slice(0, 80), action_host: actionHost};
        });
        return {url: location.href, title: document.title.slice(0, 300), text: (document.body?.innerText || '').slice(0, 12000), forms: fields};
      }
    });
    const snapshot = injection?.[0]?.result;
    if (!snapshot) throw new Error('The page snapshot was not available.');
    await runSiteCheck(snapshot.url, 'current_tab', snapshot);
    setMessage($('site-message'), 'Check complete. Review the evidence and the checks that could not run.', 'success');
  } catch (error) {
    setMessage($('site-message'), error.message, 'error');
  }
});

$('check-pasted-url').addEventListener('click', async () => {
  const url = $('site-url').value.trim();
  if (!url) return setMessage($('site-message'), 'Enter a website address first.', 'error');
  setMessage($('site-message'), 'Running address-only checks. Bharosa will not fetch this page.');
  $('site-result').classList.add('hidden');
  try {
    await runSiteCheck(url, 'pasted_url', null);
    setMessage($('site-message'), 'Address-only check complete. The website content was not fetched or viewed.', 'success');
  } catch (error) {
    setMessage($('site-message'), error.message, 'error');
  }
});

refreshBackendStatus();
