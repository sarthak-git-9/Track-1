const assert = require('node:assert/strict');
const E = require('../engine.js');
const AI = require('../ai.js').AI;

(async () => {
  const text = 'Name: Anita Desai\nAccount No: 12345678901234\nThe landlord is Meera Kulkarni.';
  const ruleFindings = E.build(text);
  assert(ruleFindings.some(g => g.value === 'Anita Desai'));

  const aiResult = await E.agent(async () => ({ findings: [
    { text: 'Anita Desai', type: 'person', personal: true },
    { text: 'Meera Kulkarni', type: 'person', personal: true },
    { text: 'Meera Kulkarni', type: 'person', personal: true }
  ] }), text, ruleFindings.map(g => g.value));
  const merged = E.build(text + '\nLandlord: Meera Kulkarni', [...ruleFindings, ...aiResult.hits]);
  assert.equal(merged.filter(g => g.key === 'anita desai').length, 1);
  assert.equal(merged.filter(g => g.key === 'meera kulkarni').length, 1);

  const failed = await E.agent(async () => null, text, []);
  assert.equal(failed.ok, false);
  const fallback = E.build(text, failed.hits);
  assert(fallback.some(g => g.value === 'Anita Desai'));
  assert(E.apply(text, fallback).indexOf('Anita Desai') === -1);

  global.LanguageModel = { availability: async () => 'downloading' };
  const downloading = await AI.detect();
  assert.equal(downloading.kind, 'none');
  assert.equal(downloading.state, 'downloading');

  global.LanguageModel = { availability: async () => 'available', create: () => new Promise(() => {}) };
  const ready = await AI.detect();
  assert.equal(ready.state, 'available');
  const started = Date.now();
  assert.equal(await AI.ask('system', 'document', 25), null);
  assert(Date.now() - started < 500, 'a stalled session creation must time out');
  const timedOut = await E.agent(async () => AI.ask('system', 'document', 25), text, []);
  assert.equal(timedOut.ok, false);
  assert(E.build(text, timedOut.hits).some(g => g.value === 'Anita Desai'), 'rules remain usable after AI timeout');

  global.LanguageModel = { availability: async () => 'unavailable' };
  const unavailable = await AI.detect();
  assert.equal(unavailable.kind, 'none');
  assert.equal(unavailable.state, 'unavailable');
  assert(E.build(text).some(g => g.value === 'Anita Desai'));
  console.log('ok rule-only, merged AI findings, failed AI fallback, and AI state/timeout handling');
})().catch(e => { console.error(e); process.exitCode = 1; });
