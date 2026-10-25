// node tests/t_popup_selection.js : review button honors checked findings and manual selection
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../engine.js');
const SAMPLE = require('../sample.js');
const HTML = fs.readFileSync(require.resolve('../popup.html'), 'utf8');
const section = id => HTML.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))[0];
assert.doesNotMatch(section('home'), /class="tag live">Ready<\/span>/, 'Home cards have no Ready badges');
assert(section('redact-in').indexOf('id="sample"') < section('redact-in').indexOf('id="drop"'), 'sample button precedes file upload in Add');
assert.equal((HTML.match(/id="sample"/g) || []).length, 1, 'sample button appears only once in the Add stage');
assert(HTML.indexOf('<script src="sample.js"></script>') < HTML.indexOf('<script src="popup.js"></script>'), 'shared sample data loads before the popup handler');

const REVIEW_TEXT = 'Account Holder: Alice Sample\nPaid to Bob Example Rs 10.00';

function app(runLoopOverride, missingSelectors = []) {
  const nodes = new Map();
  const alerts = [];
  let sourceUsed;
  let createdElements = 0;
  let selection = { toString: () => '', anchorNode: null, removeAllRanges() {} };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, className: '',
      dataset: {}, onclick: null, onchange: null,
      addEventListener() {},
      contains(target) { return target === 'document-text'; },
      classList: { toggle() {} }
    });
    return nodes.get(selector);
  };
  const document = {
    querySelector: selector => missingSelectors.includes(selector) ? null : node(selector),
    querySelectorAll: () => [],
    createElement: () => { createdElements++; return node('created-element'); }
  };
  const engine = Object.create(E);
  engine.runLoop = async (...args) => {
    sourceUsed = args[0].text;
    return runLoopOverride ? runLoopOverride(...args) : E.runLoop(...args);
  };
  const window = { Engine: engine, AI: { active: { kind: 'none' }, async detect() { return { kind: 'none', state: 'unavailable' }; }, async ask() { return null; } }, PdfIO: {}, BharosaSample: SAMPLE, getSelection: () => selection };
  const context = { window, document, alert: message => alerts.push(message), console, setTimeout, clearTimeout, URL, Blob };
  vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'), 'utf8'), context, { filename: 'popup.js' });
  return {
    nodes, alerts,
    get sourceUsed() { return sourceUsed; },
    get createdElements() { return createdElements; },
    setSelection(value) { selection = value; },
    clickSample() { node('#sample').onclick(); },
    async scan(text) { node('#paste').value = text; await node('#scan').onclick(); },
    toggleFinding(index) { node('#list').onchange({ target: { dataset: { i: String(index) } } }); },
    clickAdd() { node('#addSel').onclick(); },
    async exportText() { await node('#toExport').onclick(); return node('#out').textContent; }
  };
}

(async () => {
  assert.doesNotThrow(() => app(), 'popup initializes with the Add-stage sample button');
  console.log('ok popup initializes with the Add-stage sample button');

  {
    const a = app(undefined, ['#sample']);
    assert.equal(typeof a.nodes.get('#scan').onclick, 'function', 'remaining popup handlers initialize when optional sample markup is absent');
    console.log('ok missing sample button does not prevent popup initialization');
  }

  {
    const a = app();
    a.clickSample();
    assert.equal(a.nodes.get('#paste').value, SAMPLE, 'sample button loads only the shared synthetic statement into pasted text');
    assert.equal(a.nodes.get('#file').value, '', 'sample button does not select or upload a file');
    assert.equal(a.nodes.has('#count'), false, 'sample button does not bypass detection');
    await a.nodes.get('#scan').onclick();
    assert.equal(a.nodes.get('#redact-review').hidden, false, 'sample proceeds through the normal detection and Review flow');
    assert.equal(a.sourceUsed, undefined, 'sample loading and scanning do not bypass redaction and verification');
    console.log('ok sample button loads synthetic text without bypassing scan and Review');
  }

  {
    const a = app();
    await a.scan(REVIEW_TEXT);
    assert.equal(E.build(REVIEW_TEXT).filter(g => g.on).length, 2, 'synthetic review has two checked findings');
    a.clickAdd();
    assert.equal(a.alerts.length, 0, 'checked findings do not require browser text selection');
    const preview = a.nodes.get('#doc').innerHTML;
    assert.equal(preview.includes('Alice Sample'), false, 'checked finding is hidden from preview immediately');
    assert.equal(preview.includes('Bob Example'), false, 'second checked finding is hidden from preview immediately');
    assert.match(preview, /\[PERSON_\d+\]/, 'preview shows the existing redaction placeholder');
    assert.equal(a.nodes.get('#paste').value, REVIEW_TEXT, 'textarea source remains intact');
    const out = await a.exportText();
    assert.equal(a.sourceUsed, REVIEW_TEXT, 'final redaction receives the original source');
    assert.equal(out.includes('Alice Sample'), false);
    assert.equal(out.includes('Bob Example'), false);
    console.log('ok checked findings hide in preview and final redaction uses original source');
  }

  {
    const a = app();
    await a.scan(REVIEW_TEXT);
    E.build(REVIEW_TEXT).forEach((g, i) => { if (g.on) a.toggleFinding(i); });
    const before = a.nodes.get('#doc').innerHTML;
    a.clickAdd();
    assert.equal(a.alerts.length, 1);
    assert.match(a.alerts[0], /check at least one finding|select text/i);
    assert.equal(a.nodes.get('#doc').innerHTML, before, 'no selection leaves document preview unchanged');
    console.log('ok no checked findings produces a clear prompt without changing preview');
  }

  {
    const a = app();
    const text = 'Synthetic narration: HiddenVendor Rs 2.00';
    await a.scan(text);
    a.setSelection({ toString: () => 'HiddenVendor', anchorNode: 'document-text', removeAllRanges() {} });
    a.clickAdd();
    assert.equal(a.alerts.length, 0);
    assert.match(a.nodes.get('#doc').innerHTML, /HiddenVendor/, 'manual selection retains the existing highlighted-text path');
    const out = await a.exportText();
    assert.equal(out.includes('HiddenVendor'), false, 'manual selection is still added and redacted');
    console.log('ok valid manual text selection is still added and redacted');
  }

  {
    const text = 'Paid to Casey Example Rs 2.00';
    const a = app(async sess => ({
      status: 'fail', rounds: 0, verificationRound: 1, rebuiltFromOriginalInput: true,
      problems: ['synthetic remaining value'], risk_notes: [], understandable: true,
      out: sess.text, findings: E.build(sess.text), auto_added: 0
    }));
    await a.scan(text);
    await a.nodes.get('#toExport').onclick();
    a.nodes.get('#dlTxt').onclick();
    assert.match(a.alerts.at(-1), /Export blocked/);
    assert.equal(a.createdElements, 0, 'blocked output never starts a download');
    console.log('ok final export safeguard blocks an enabled value that remains');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
