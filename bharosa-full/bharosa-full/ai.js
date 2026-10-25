/* Optional Chrome built-in AI. Pattern detection works independently when the model is unavailable. */
(function (root) {
  'use strict';
  const DETECT_MS = 2000, ASK_MS = 12000;
  const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  let active = { kind: 'none', name: '', state: 'checking' };

  async function bounded(p, ms, onTimeout) {
    let timer;
    try {
      return await Promise.race([Promise.resolve(p), new Promise((_, reject) => {
        timer = setTimeout(() => { try { onTimeout && onTimeout(); } catch (_) {} reject(new Error('timeout')); }, ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  const parse = t => { try { const d = JSON.parse(t); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch (e) { const m = String(t).match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (e2) { return null; } } };

  async function detect() {
    try {
      if (typeof LanguageModel !== 'undefined') {
        const a = await bounded(LanguageModel.availability(LANG), DETECT_MS);
        if (a === 'available') return (active = { kind: 'chrome', name: 'Chrome on-device model', state: 'available' });
        if (a === 'downloadable' || a === 'downloading') return (active = { kind: 'none', name: '', state: a });
      }
    } catch (e) { /* unavailable or timed out */ }
    return (active = { kind: 'none', name: '', state: 'unavailable' });
  }

  async function ask(system, user, ms) {
    ms = Math.min(ms || ASK_MS, ASK_MS);
    if (active.kind !== 'chrome' || active.state !== 'available') return null;
    let session, controller;
    try {
      controller = new AbortController();
      session = await bounded(LanguageModel.create({ ...LANG, initialPrompts: [{ role: 'system', content: system }], temperature: 0, topK: 1, signal: controller.signal }), ms, () => controller.abort());
      const result = await bounded(session.prompt(user, { responseConstraint: { type: 'object' } }), ms, () => session.destroy && session.destroy());
      return parse(result);
    } catch (e) { /* timeout or model error: caller continues with rule findings */ }
    finally { if (session && session.destroy) { try { session.destroy(); } catch (_) {} } }
    return null;
  }

  root.AI = { detect, ask, get active() { return active; } };
})(typeof self !== 'undefined' ? self : this);
