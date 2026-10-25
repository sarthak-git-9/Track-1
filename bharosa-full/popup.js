const $ = s => document.querySelector(s);
const E = window.Engine, AI = window.AI, PDF = window.PdfIO;
const SCREENS = ['home', 'redact-in', 'redact-review', 'redact-out', 'verify'];
const BACK = { 'redact-in': 'home', verify: 'home', 'redact-review': 'redact-in', 'redact-out': 'redact-review' };
const LABEL = { PERSON: 'name', ACCOUNT: 'account', CARD: 'card', PHONE: 'phone', EMAIL: 'email', UPI: 'UPI', ID: 'ID', DOB: 'birth date', ITEM: 'item', ADDRESS: 'address', ORG: 'organisation', PIN: 'PIN code' };
const fresh = () => ({ text: '', extra: [], force: {}, list: [], out: '', file: null, hits: [], model: false, previewHidden: new Set() });
let cur = 'home', S = fresh(), cfg = {};

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null;

/* ---------- on-device AI (optional) ---------- */
function chip(txt, cls) { $('#chipTxt').textContent = txt; $('#chip').className = 'chip ' + (cls || ''); }
async function initAI() {
  const a = await AI.detect();
  if (a.kind === 'none') {
    chip('Pattern mode', 'warn');
    const state = a.state === 'downloading' ? 'The on-device model is downloading. ' : a.state === 'downloadable' ? 'The on-device model is not ready yet. ' : '';
    $('#aiMsg').innerHTML = `<b>Works fully on this device.</b> ${esc(state)}Names and addresses are found by patterns.`;
  } else {
    chip('AI: ' + a.name, '');
    $('#aiMsg').innerHTML = `<b>On-device AI ready:</b> ${esc(a.name)}. It runs on your computer, and your document never leaves it.`;
  }
}

/* ---------- navigation ---------- */
function go(id) {
  cur = id; SCREENS.forEach(s => $('#' + s).hidden = s !== id); $('#back').hidden = id === 'home';
  if (id === 'verify') initVerify();
}
$('#back').onclick = () => go(BACK[cur]);
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
$('#leaves').onclick = () => $('#sheet').hidden = !$('#sheet').hidden;
$('#closeSheet').onclick = () => $('#sheet').hidden = true;

/* ---------- redact: add ---------- */
const showErr = m => { $('#err').textContent = m || ''; $('#err').hidden = !m; };
function loadFile(f) {
  showErr(''); S.file = null; $('#pw').hidden = true;
  if (!f) return;
  if (/\.pdf$/i.test(f.name)) {
    S.file = f; $('#dropT').textContent = f.name; $('#dropS').textContent = 'Scanned PDFs are not supported.'; $('#pw').hidden = false; $('#paste').value = ''; return;
  }
  if (!/\.(txt|md|csv|text)$/i.test(f.name)) return showErr('Please add a .pdf, .txt or .md file.');
  const r = new FileReader(); r.onload = () => { $('#paste').value = String(r.result); $('#dropT').textContent = f.name; }; r.readAsText(f);
}
$('#file').onchange = e => loadFile(e.target.files[0]);
const sampleButton = $('#sample');
if (sampleButton) sampleButton.onclick = () => {
  S.file = null; $('#file').value = ''; $('#pw').value = ''; $('#pw').hidden = true; showErr('');
  $('#dropT').textContent = 'Drop a .pdf, .txt or .md file';
  $('#dropS').textContent = 'or click to choose. Scanned PDFs are not supported.';
  $('#paste').value = window.BharosaSample;
};
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });
let pdfjsMod = null;
async function pdfjs() {
  if (!pdfjsMod) { pdfjsMod = await import('./lib/pdf.min.mjs'); pdfjsMod.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', location.href).href; }
  return pdfjsMod;
}
$('#scan').onclick = async () => {
  const text = $('#paste').value; showErr('');
  if (!S.file && text.trim().length < 5) return showErr('Add a file or paste some text first.');
  const btn = $('#scan'); btn.disabled = true; btn.textContent = 'Reading…';
  const keep = S.file; S = fresh(); S.file = keep;
  try {
    S.text = S.file ? await PDF.extractPdf(await pdfjs(), await S.file.arrayBuffer(), $('#pw').value) : text;
    if (S.text.trim().length < 5) throw new Error('The document has no readable text.');
    S.list = E.build(S.text);
    if (AI.active.kind === 'chrome' && AI.active.state === 'available') {
      btn.textContent = 'Asking the on-device AI…';
      const r = await E.agent(AI.ask, S.text, S.list.map(g => g.value));
      S.hits = r.hits; S.model = r.ok;
      S.list = E.build(S.text, [...S.list, ...S.hits]);
      if (!r.ok) $('#aiMsg').textContent = 'On-device AI could not complete. Rule-based findings are ready to review.';
    }
    renderDoc(); renderList(); go('redact-review');
  } catch (e) {
    if (e.message === 'password') { $('#pw').hidden = false; $('#pw').focus(); showErr('This PDF is password protected. Enter the password above and try again.'); }
    else showErr(e.message);
  } finally { btn.disabled = false; btn.textContent = 'Find private details'; }
};

/* ---------- redact: review ---------- */
async function rebuild() { S.list = E.build(S.text, [...S.hits, ...S.extra], S.force); renderDoc(); renderList(); }
function renderDoc() {
  const spans = []; S.list.forEach((g, i) => g.spans.forEach(s => spans.push([s[0], s[1], i]))); spans.sort((a, b) => a[0] - b[0]);
  let html = '', p = 0;
  spans.forEach(([s, e, i]) => {
    const g = S.list[i];
    const display = g.on && S.previewHidden.has(g.key) ? g.placeholder : S.text.slice(s, e);
    html += esc(S.text.slice(p, s)) + `<mark class="k-${g.type}${g.on ? '' : ' off'}" data-i="${i}" data-t="${LABEL[g.type] || 'item'}" role="button" aria-pressed="${g.on}" title="${g.on ? 'Will be hidden. Tap to keep.' : 'Will be kept. Tap to hide.'}">${esc(display)}</mark>`; p = e;
  });
  $('#doc').innerHTML = html + esc(S.text.slice(p));
}
function renderList() {
  $('#count').textContent = `${S.list.filter(g => g.on).length} of ${S.list.length} will be hidden`;
  $('#list').innerHTML = S.list.length ? S.list.map((g, i) =>
    `<label class="item"><input type="checkbox" data-i="${i}" ${g.on ? 'checked' : ''}><span>${esc(g.value)}${g.biz ? ' <small>(business or organisation, kept by default)</small>' : ''}</span><small>×${g.spans.length}</small><code>${g.placeholder}</code></label>`).join('')
    : '<p class="hint">Nothing found. Select text above to hide anything we missed.</p>';
}
function toggle(i) { const g = S.list[i]; g.on = !g.on; S.force[g.key] = g.on; renderDoc(); renderList(); }
$('#doc').onclick = e => { const m = e.target.closest('mark'); if (m) toggle(+m.dataset.i); };
$('#list').onchange = e => { if (e.target.dataset.i) toggle(+e.target.dataset.i); };
$('#addSel').onclick = () => {
  const sel = window.getSelection(), t = sel.toString().trim();
  if (t.length >= 2 && $('#doc').contains(sel.anchorNode)) {
    S.extra.push({ value: t, type: 'ITEM' }); sel.removeAllRanges(); rebuild(); return;
  }
  const checked = S.list.filter(g => g.on);
  if (checked.length) {
    checked.forEach(g => { g.on = true; S.force[g.key] = true; S.previewHidden.add(g.key); });
    rebuild(); return;
  }
  alert('Check at least one finding or select text inside the document first.');
};

/* ---------- redact: verify + export ---------- */
const OK = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6FE3B0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.500l2.800 2.800L16 9.500"/></svg>';
const BAD = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF7A66" stroke-width="2.4" stroke-linecap="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.1"/></svg>';
$('#toExport').onclick = async () => {
  const btn = $('#toExport'); btn.disabled = true; btn.textContent = 'Checking for leaks…';
  try {
    const r = await E.runLoop({ text: S.text, hits: S.hits, model: S.model }, S.force, S.extra, AI.ask); S.list = r.findings; S.runInfo = { verificationRound: r.verificationRound, rebuiltFromOriginalInput: r.rebuiltFromOriginalInput };
    S.out = r.out; const pass = r.status === 'pass';
    const meta = [r.rounds ? `Fixed automatically over ${r.rounds} round${r.rounds > 1 ? 's' : ''} (${r.auto_added} extra item${r.auto_added === 1 ? '' : 's'} hidden).` : '', ...(r.risk_notes || [])].filter(Boolean);
    $('#verdict').className = 'verdict ' + (pass ? 'ok' : 'bad');
    $('#verdict').innerHTML = (pass ? OK : BAD) + `<div><b>${pass ? 'No leaks found by our checks' : 'Something may remain'}</b><p>${pass ? 'Detection is best effort, so skim the text below before sharing.' : 'Still found after 3 rounds. Go back and hide these, or accept the risk:'}</p>${pass ? '' : `<ul>${r.problems.slice(0, 5).map(p => `<li>${esc(p)}</li>`).join('')}</ul>`}${meta.length ? `<ul>${meta.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
    $('#out').textContent = S.out; go('redact-out');
  } catch (e) { alert(e.message); } finally { btn.disabled = false; btn.textContent = 'Redact and check'; }
};
function save(fmt) {
  const leaks = S.list.filter(g => g.on && new RegExp(E.pattern(g.value, g.type), 'i').test(S.out));   // last exact-match check on the final text
  if (leaks.length) {
    const diagnostics = leaks.map(g => {
      const match = new RegExp(E.pattern(g.value, g.type), 'i').exec(S.out);
      const sensitiveValue = ['ACCOUNT', 'PHONE'].includes(g.type) || /(?:\+?\d[\d ()-]{7,}\d|\b\d{8,}\b)/.test(g.value);
      return {
        type: g.type,
        value: sensitiveValue ? '[omitted: account or phone data]' : g.value,
        enabled: !!g.on,
        approved: !!g.on,
        spans: (g.spans || []).map(([start, end]) => {
          const boundsValid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= S.text.length;
          return { start, end, boundsValid, indexedTextMatchesFindingValue: boundsValid && S.text.slice(start, end) === g.value };
        }),
        occursInOutput: !!match,
        matchingOffset: match ? match.index : null,
        exportFormat: fmt,
        verificationRound: S.runInfo && S.runInfo.verificationRound,
        rebuiltFromOriginalInput: S.runInfo && S.runInfo.rebuiltFromOriginalInput
      };
    });
    console.info('[Bharosa export diagnostic]', diagnostics);
    return alert('Export blocked: an approved value still appears in the output.');
  }
  const blob = fmt === 'pdf' ? new Blob([PDF.toPdf(S.out)], { type: 'application/pdf' }) : new Blob([S.out], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'redacted-document.' + fmt; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#dlMd').onclick = () => save('md'); $('#dlTxt').onclick = () => save('txt'); $('#dlPdf').onclick = () => save('pdf');
$('#copy').onclick = async () => { await navigator.clipboard.writeText(S.out); $('#copy').textContent = 'Copied'; setTimeout(() => $('#copy').textContent = 'Copy text', 1500); };
$('#clear').onclick = () => { S = fresh(); ['#paste', '#pw'].forEach(i => $(i).value = ''); $('#out').textContent = ''; $('#doc').innerHTML = ''; $('#dropT').textContent = 'Drop a .pdf, .txt or .md file'; $('#pw').hidden = true; go('home'); };

/* ---------- check a website ---------- */
let tab = null, mode = 'tab';
function setMode(m) {
  mode = m; $('#mTab').classList.toggle('on', m === 'tab'); $('#mLink').classList.toggle('on', m === 'link');
  $('#url').readOnly = m === 'tab'; $('#url').value = m === 'tab' ? (tab && tab.url) || '' : ''; $('#vres').hidden = true; if (m === 'link') $('#url').focus();
}
$('#mTab').onclick = () => setMode('tab'); $('#mLink').onclick = () => setMode('link');
function initVerify() {
  tab = null;
  if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.query({ active: true, currentWindow: true }, t => { tab = t && t[0]; if (mode === 'tab') $('#url').value = (tab && tab.url) || ''; });
  setMode('tab');
}
async function snapshot() {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, text: document.body.innerText.slice(0, 20000), forms: [...document.querySelectorAll('input')].slice(0, 80).map(i => ({ type: i.type, name: i.name || i.id || '', ac: i.autocomplete || '' })) }) });
    return r.result;
  } catch (e) { return null; }
}
const ICON = { 'very-safe': '✓', safe: '✓', unsafe: '!', 'very-unsafe': '!', unknown: '?' };
$('#check').onclick = async () => {
  const url = $('#url').value.trim(); let r; const btn = $('#check'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    r = await E.checkSite(url, mode === 'tab' && tab ? await snapshot() : null, {});
  } catch (e) { r = { error: e.message }; }
  btn.disabled = false; btn.textContent = 'Check'; $('#vres').hidden = false;
  if (r.error) { $('#vcat').className = 'vcat unknown'; $('#vicon').textContent = '?'; $('#vlabel').textContent = 'Cannot check this'; $('#vreason').textContent = r.error; $('#vlog').innerHTML = ''; return; }
  $('#vcat').className = 'vcat ' + r.category; $('#vicon').textContent = ICON[r.category];
  $('#vlabel').textContent = r.label; $('#vreason').textContent = r.reason;
  const nc = r.not_checked && r.not_checked.length ? `<li><b>Could not check</b><small>${esc(r.not_checked.join(', '))}</small></li>` : '';
  $('#vlog').innerHTML = r.log.map(l => `<li><b>${l.id} ${esc(l.check)}</b><small>${esc(l.result)} (${esc(l.source || 'Bharosa')}, ${l.status})</small></li>`).join('') + nc +
    `<li><b>Mode</b><small>${r.mode === 'current_tab' ? 'Current tab: page read on your device' : 'Address only, page not viewed'}</small></li>`;
};
$('#url').addEventListener('keydown', e => { if (e.key === 'Enter') $('#check').click(); });

/* ---------- boot ---------- */
initAI();
