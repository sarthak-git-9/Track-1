/* PDF in, PDF out, entirely in the extension.
   In: pdf.js (Apache-2.0, bundled in /lib) reads text and keeps table columns.
   Out: a FRESH PDF is written from the redacted text, never drawn over the original, with no metadata. */
(function (root) {
  'use strict';
  class BadInput extends Error {}

  // pdfjs: the imported pdf.js module. data: ArrayBuffer/Uint8Array. Returns plain text, page by page, columns kept with spaces.
  async function extractPdf(pdfjs, data, password) {
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(data), password: password || undefined, isEvalSupported: false, useSystemFonts: false }).promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') throw new BadInput(e.code === 2 ? 'That password did not unlock the PDF.' : 'password');
      throw new BadInput('That PDF could not be opened.');
    }
    const pages = [];
    try { for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      const items = tc.items.filter(i => i.str !== undefined && i.str.trim() !== '').map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
      const cw = (() => { const r = items.filter(i => i.s.length > 2 && i.w > 0).map(i => i.w / i.s.length).sort((a, b) => a - b); return r.length ? r[r.length >> 1] : 4.5; })();
      const rows = [];
      items.sort((a, b) => b.y - a.y).forEach(it => { const r = rows.find(r => Math.abs(r.y - it.y) < 3); r ? r.items.push(it) : rows.push({ y: it.y, items: [it] }); });
      pages.push(rows.sort((a, b) => b.y - a.y).map(r => {
        let line = '';
        r.items.sort((a, b) => a.x - b.x).forEach(it => { const col = Math.round(it.x / cw); line += (line.length >= col ? (line && !/\s$/.test(line) ? ' ' : '') : ' '.repeat(col - line.length)) + it.s; });
        return line.replace(/\s+$/, '');
      }).join('\n'));
    } } catch (e) { throw new BadInput('Text could not be extracted from that PDF.'); }
    finally { await doc.destroy(); }
    if (pages.join('').trim().length < 20 * Math.max(1, pages.length)) throw new BadInput('This looks like a scanned PDF. Scanned documents are not supported.');
    return pages.join('\n\n');
  }

  const PDF_CHARS = { '₹': 'Rs.', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '*', '…': '...' };
  function wrap(line, width) {
    const out = []; let first = true;
    while (line.length > width) { out.push((first ? '' : '  ') + line.slice(0, width - (first ? 0 : 2))); line = line.slice(width - (first ? 0 : 2)); first = false; }
    out.push((first ? '' : '  ') + line); return out;
  }
  // Minimal PDF 1.4 writer: Courier, one text object per page, no Info dictionary (so no author, title, producer or dates).
  function toPdf(text) {
    for (const k in PDF_CHARS) text = text.split(k).join(PDF_CHARS[k]);
    text = text.replace(/\t/g, '    ').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');
    const lines = text.split('\n').flatMap(l => wrap(l, 118)), perPage = 80, pages = [];
    for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    if (!pages.length) pages.push(['']);
    const esc = s => s.replace(/[\\()]/g, '\\$&');
    const objs = []; const add = s => objs.push(s) && objs.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('<< /Type /Pages /Kids [' + pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ') + `] /Count ${pages.length} >>`);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    pages.forEach((ls, i) => {
      const body = 'BT /F1 7 Tf 8 TL 36 806 Td\n' + ls.map(l => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
      add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    });
    let pdf = '%PDF-1.4\n'; const off = [];
    objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xr = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
    const b = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 255;
    return b;
  }

  const api = { extractPdf, toPdf, BadInput };
  if (typeof module !== 'undefined') module.exports = api; else root.PdfIO = api;
})(typeof self !== 'undefined' ? self : this);
