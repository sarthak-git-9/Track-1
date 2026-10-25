import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractPdf, toPdf } = require('../pdfio.js');
const E = require('../engine.js'), C = require('./corpora.js');
import * as pdfjs from '../lib/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;
const inputPdf = toPdf(C.SAMPLE);
const text = await extractPdf(pdfjs, inputPdf);
assert.match(text, /Rahul Sharma/);
assert.match(text, /50100234567890/);

const findings = E.build(text), redacted = E.apply(text, findings);
for (const sensitive of ['Rahul Sharma', '50100234567890', 'ABCDE1234F', 'rahul.sharma@example.com', '98765 43210', 'Meera Kulkarni', 'Priya Nair'])
  assert.equal(redacted.includes(sensitive), false, `redacted text retained ${sensitive}`);
const exportedPdf = toPdf(redacted);
const exportedText = await extractPdf(pdfjs, exportedPdf);
for (const sensitive of ['Rahul Sharma', '50100234567890', 'ABCDE1234F', 'rahul.sharma@example.com', '98765 43210', 'Meera Kulkarni', 'Priya Nair'])
  assert.equal(exportedText.includes(sensitive), false, `exported PDF retained ${sensitive}`);

await assert.rejects(() => extractPdf(pdfjs, Buffer.from('not a pdf')), /could not be opened/i);
console.log('ok PDF extraction, redaction, export round trip, and invalid-PDF rejection');
