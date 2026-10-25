const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const ext = path.resolve(__dirname, '..');
  const ctx = await chromium.launchPersistentContext('/tmp/pw-prof', { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'] });
  const p0 = await ctx.newPage(); await p0.goto('chrome://extensions');
  const id = await p0.evaluate(async () => (await chrome.developerPrivate.getExtensionsInfo()).find(e => e.name === 'Bharosa').id);
  console.log('extension id', id);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`chrome-extension://${id}/popup.html`); await page.waitForTimeout(800);
  console.log('chip:', await page.textContent('#chipTxt'));
  const homeBadges = await page.locator('#home .card .tag').count();
  if (homeBadges !== 0) throw new Error(`Expected no Home Ready badges, found ${homeBadges}`);
  // --- redact sample
  await page.click('[data-go=redact-in]'); await page.click('#sample');
  if (!(await page.inputValue('#paste')).includes('(synthetic)')) throw new Error('Sample button did not load synthetic statement text');
  await page.click('#scan');
  await page.waitForSelector('#redact-review:not([hidden])'); console.log('count:', await page.textContent('#count'));
  await page.click('#toExport'); await page.waitForSelector('#redact-out:not([hidden])');
  console.log('verdict:', (await page.textContent('#verdict')).replace(/\s+/g, ' ').slice(0, 140));
  const out = await page.textContent('#out'); console.log(out.split('\n').slice(0, 6).join('\n'));
  // downloads
  for (const [id2, ext2] of [['#dlMd', 'md'], ['#dlPdf', 'pdf']]) { const [d] = await Promise.all([page.waitForEvent('download'), page.click(id2)]); await d.saveAs(`/tmp/dl.${ext2}`); console.log('downloaded', d.suggestedFilename()); }
  // --- PDF upload
  await page.click('#clear'); await page.click('[data-go=redact-in]');
  await page.setInputFiles('#file', '/tmp/stmt.pdf'); await page.click('#scan'); await page.waitForSelector('#redact-review:not([hidden])');
  console.log('pdf findings:', await page.textContent('#count')); await page.click('#toExport'); await page.waitForSelector('#redact-out:not([hidden])');
  console.log('pdf verdict:', (await page.textContent('#verdict')).replace(/\s+/g, ' ').slice(0, 80));
  // encrypted pdf
  await page.click('#clear'); await page.click('[data-go=redact-in]'); await page.setInputFiles('#file', '/tmp/enc.pdf'); await page.click('#scan'); await page.waitForTimeout(800);
  console.log('enc msg:', await page.textContent('#err')); await page.fill('#pw', 'pass123'); await page.click('#scan'); await page.waitForSelector('#redact-review:not([hidden])'); console.log('enc ok:', await page.textContent('#count'));
  // --- site check on a local fake phishing page
  await page.click('#back'); await page.click('#back');
  const http = require('http'); const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>HDFC Bank NetBanking</title><h1>HDFC Bank</h1><p>Verify your account now</p><input type=text name=user><input type=password name=pw>'); }).listen(8099);
  const tabp = await ctx.newPage(); await tabp.goto('http://127.0.0.1:8099/'); await tabp.bringToFront();
  await page.bringToFront(); await page.click('[data-go=verify]'); await page.click('#mLink'); await page.fill('#url', 'https://hdfcbank-secure-login.xyz'); await page.click('#check'); await page.waitForSelector('#vres:not([hidden])');
  console.log('link check:', await page.textContent('#vlabel'), '-', await page.textContent('#vreason'));
  await page.fill('#url', 'https://www.sbi.co.in'); await page.click('#check'); await page.waitForTimeout(500); console.log('official:', await page.textContent('#vlabel'));
  console.log('page errors:', errs); await ctx.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
