// node tests/t_engine.js  : planted identifiers must be hidden, clean text must be untouched
const E = require('../engine.js'); const C = require('./corpora.js'); let bad = 0;
const must = { SAMPLE: ['Rahul Sharma', '50100234567890', 'ABCDE1234F', 'rahul.sharma@example.com', '98765 43210', 'Meera Kulkarni', 'Priya Nair'],
  REAL: ['RAHUL SHARMA', '50100234567890', '9876543210', 'PRIYA NAIR', 'SUNRISE', 'HDFC0001234'], LETTER: ['Anita Desai', 'LIC4455667', 'K1234567', 'MH12AB1234', 'Verma'], CLEAN: [] };
for (const n in must) { const t = C[n], f = E.build(t), o = E.apply(t, f); const miss = must[n].filter(x => o.includes(x));
  const clean = n !== 'CLEAN' || o === t; if (miss.length || !clean) { bad++; console.log('FAIL', n, miss); } else console.log('ok', n, f.filter(g => g.on).length + ' hidden'); }
process.exit(bad);
