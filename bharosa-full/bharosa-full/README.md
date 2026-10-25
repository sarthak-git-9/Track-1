# Bharosa

Browser extension, nothing else to install or run.
Two tools in one popup: **Redact a document** before you share it, and **Check a website** before you trust it.

## Install (users)
Chrome Web Store (when published), or for testing: `chrome://extensions` -> Developer mode -> Load unpacked -> select this folder.

## What it does
- Redact: drop a text PDF, .md or .txt (password-protected PDFs work). Review what will be hidden, export .md, .txt or a fresh PDF with no metadata. Amounts and dates stay.
- Check site: reads the page you are on (on your device), checks the address against a lookalike list and domain age.
- Optional Chrome built-in on-device AI can find names and addresses that patterns miss. It is only used when available and ready; pattern-based detection works without it.

## Privacy
Documents and page content never leave the device. Only the site address is sent for the registration-date lookup (rdap.org). No analytics, no accounts, no Bharosa server.

## Honest limits
Detection is best-effort ("No leaks found by our checks", not a guarantee). Scanned PDFs are not supported. The site check is a risk assessment, not a guarantee; reviews and ownership records are not checked yet.

## Open source
Code: Apache-2.0 (add LICENSE). Bundled: pdf.js (Apache-2.0, in /lib). Optional AI: Chrome's built-in on-device model.

## Tests
`node tests/t_engine.js`
