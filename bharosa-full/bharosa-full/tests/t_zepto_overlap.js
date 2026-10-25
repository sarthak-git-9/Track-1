// node tests/t_zepto_overlap.js : enabled short findings must own overlapping spans
const assert = require('node:assert/strict');
const E = require('../engine.js');

const phrase = '01 Oct paid to Zepto Store Rs 1.00';
const standalone = '02 Oct paid to Zepto Rs 2.00';
const text = `${phrase}\n${standalone}`;
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

(async () => {
  {
    const business = E.build(phrase);
    const merchant = business.find(g => g.key === 'zepto store');
    assert(merchant, 'business finding exists when it has an unopposed span');
    assert.equal(merchant.biz, true);
    assert.equal(merchant.on, false, 'business heuristic keeps Zepto Store by default');
    assert.equal(E.apply(phrase, business), phrase, 'Zepto Store alone is not redacted by default');
  }

  {
    const hits = E.detect(text);
    assert(hits.some(g => g.value === 'Zepto Store'));
    assert(hits.some(g => g.value === 'Zepto'));
    const findings = E.build(text);
    const short = findings.find(g => g.key === 'zepto');
    assert(short && short.on, 'standalone Zepto finding is enabled');
    assert.equal(short.spans.length, 2, 'enabled Zepto claims the embedded and standalone occurrences');
    assert.equal(findings.some(g => g.key === 'zepto store'), false, 'the disabled overlapping span is not retained as a competing preview span');
    for (let i = 0; i < findings.length; i++) for (let j = i + 1; j < findings.length; j++)
      for (const a of findings[i].spans) for (const b of findings[j].spans) assert.equal(overlaps(a, b), false, 'finding spans do not overlap');
    const out = E.apply(text, findings);
    assert.equal(/\bZepto\b/i.test(out), false);
    assert(out.includes('Store'), 'the shorter approved value does not redact the whole business-name match');
    const result = await E.runLoop({ text, hits: [], model: false }, {}, [], null);
    assert.equal(result.status, 'pass');
    assert.equal(result.rounds, 0);
    assert.equal(/\bZepto\b/i.test(result.out), false);
    console.log('ok Zepto Store plus standalone Zepto redacts approved spans and preserves the business heuristic');
  }

  {
    const repeated = '01 Oct paid to Zepto Rs 1.00\n02 Oct paid to Zepto Rs 2.00\n03 Oct paid to Zepto Rs 3.00';
    const findings = E.build(repeated);
    const short = findings.find(g => g.key === 'zepto');
    assert(short && short.on);
    assert.equal(short.spans.length, 3);
    assert.equal(/\bZepto\b/i.test(E.apply(repeated, findings)), false);
    console.log('ok repeated enabled Zepto occurrences are all redacted');
  }

  {
    const forced = E.build(text, [], { 'zepto store': false, zepto: true });
    const short = forced.find(g => g.key === 'zepto');
    assert(short && short.on);
    assert.equal(short.spans.length, 2, 'enabled shorter finding wins over explicitly disabled longer finding');
    assert.equal(/\bZepto\b/i.test(E.apply(text, forced)), false);
    console.log('ok disabled longer finding cannot reserve the enabled shorter finding span');
  }

  {
    const remaining = 'Paid to Zepto Rs 2.00';
    const findings = E.build(remaining);
    const verification = await E.verify(remaining, remaining, findings, null);
    assert(verification.probs.some(p => p.type === 'leak' && p.value === 'Zepto'), 'verification rejects a genuinely remaining enabled value');
    console.log('ok final verification still rejects an enabled value that remains');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
