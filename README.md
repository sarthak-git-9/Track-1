# Bharosa — Trust Before You Share

Bharosa is a local-first browser-extension prototype with two workflows:

1. **Redact before you share** — detect candidate sensitive values, let the user review them, replace only approved values with consistent placeholders, and run code-owned checks before export.
2. **Verify before you click** — inspect a current-tab snapshot or check a pasted address, then show the evidence and the checks that could not run.

This repository is a **starter implementation**, not a finished security product. It intentionally avoids claiming that any website is guaranteed safe or that redaction catches every sensitive value.

## What's implemented in this starter

- Chrome Manifest V3 popup with **Redact document** and **Check site** tabs.
- FastAPI backend bound to loopback only (`127.0.0.1:8765`).
- Random backend token printed at startup; protected API calls require `X-Bharosa-Token`.
- Configurable extension-origin allow-list.
- In-memory sessions with an automatic expiry and a Clear action.
- Pattern-based candidate detection for email, common UPI handles, Luhn-valid card-shaped strings, Indian phone-shaped strings, PAN-shaped strings, IFSC-shaped strings, Aadhaar-shaped *candidates*, explicit account numbers and labelled dates of birth.
- Human approval before code-owned replacements. The model never rewrites text.
- Post-redaction exact-match and basic currency/ISO-date integrity checks.
- TXT/Markdown export with neutral filenames; session cleared after successful export.
- Optional Ollama adapter for contextual entity candidates; the endpoint is restricted to localhost and returned text must occur verbatim in the source.
- Site URL normalization, IDN/Punycode visibility, exact reviewed-hostname matching, lookalike heuristic, sensitive form-metadata inspection, an evidence ledger, and explicit unavailable checks.
- Synthetic unit/API tests and a GitHub Actions test workflow.

## Important limitations to fix before a real release

1. **PDF support is not included yet.** The current UI accepts only `.txt` and `.md`. Add text-based PDF extraction and generate a fresh PDF from redacted text as a separate feature. Scanned PDFs should be rejected clearly unless a safe OCR strategy is designed and tested.
2. **No live threat-intelligence, RDAP/domain-age, certificate or social-review provider is configured.** The interface records those checks as unavailable. The local threat list (`data/threat_domains.json`) is currently empty and cannot identify known threats until verified entries are added. A missing result or no local-list match must never be treated as clean.
3. `data/official_domains.json` contains one synthetic, unreviewed fixture and a very small reviewed seed list (currently Google host entries for a control test). It is not a comprehensive or production-ready official-domain registry. Add hostnames only after independently verifying them from reliable official sources, and retain source URLs and review dates. An exact reviewed-host match is a limited signal, not a guarantee that every page or transaction is safe.
4. The lookalike similarity rule is a heuristic. Test false positives and false negatives before using it to make strong claims.
5. Contextual model inference is optional and runs only when `OLLAMA_MODEL` names an installed model. It currently sends only the first 6,000 characters in a single chunk; overlapping chunking, retries and independent contextual verification remain to be built.
6. Fixed-format detection is best-effort. The Aadhaar-shaped detector is explicitly a candidate detector and is **not checksum-validated** in this starter; do not present it as verified Aadhaar detection until a validated implementation and synthetic tests are added.
7. Sessions are stored in process memory, but this prototype is not a hardened multi-user service. Keep it on loopback, bind no network interface, do not log document content, and do not add persistence without an explicit privacy design.
8. The token is printed to the backend terminal. Do not commit it or paste it into a public issue, README, or screenshot. A browser-origin allow-list and token help protect the localhost service, but they are not a substitute for a security audit.
9. Verify the license for the exact locally served model and every external provider before mentioning them in the README or pitch.

## Requirements

- Python 3.11+ (CI currently tests 3.12)
- Google Chrome or another Chromium browser with Manifest V3 support
- Optional: Ollama plus a locally installed model

## Setup on macOS

### 1. Clone your actual repository

Use your existing Bharosa repository URL. Do not create a second repository just to use this starter.

```bash
git clone <YOUR_BHAROSA_REPOSITORY_URL>
cd <YOUR_REPOSITORY_FOLDER>
git status --short
git log --oneline -10
```

Before copying files, compare the existing structure with this starter and preserve working features. See `COMMIT_PLAN.md` for safe sequencing and commit messages.

### 2. Add or merge the backend

If your existing repo does not already contain an equivalent backend, copy the `backend/`, `data/`, and root configuration files into it. Resolve overlapping files deliberately instead of blindly overwriting them.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m compileall -q app
pytest -q
```

### 3. Load the browser extension once to get its ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this repo's `extension/` folder.
4. Copy the extension ID shown on the card.

### 4. Start the backend with that origin allow-listed

In the terminal, from `backend/`, set your actual extension ID. Do **not** use the placeholder literally.

```bash
export BHAROSA_ALLOWED_ORIGINS='chrome-extension://PASTE_YOUR_EXTENSION_ID_HERE'
# Optional: set this only to a model tag you already installed in Ollama.
# export OLLAMA_MODEL='YOUR_INSTALLED_MODEL_TAG'
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

The backend prints a random token. Keep the terminal open; do not use `--reload` for the demo because it may restart the process and rotate the token. If you change the extension ID or restart the backend, reload the extension and paste the new token when required.

### 5. Connect the popup

Click the Bharosa extension icon, paste the backend token into **Local backend session token**, and click **Save**. The badge should show **Backend ready**. The model badge becomes **Backend + model ready** when an installed Ollama model is configured and reachable.

### 6. Test the redaction flow

Use `samples/synthetic_statement.md` only. Choose the file, scan it, review/approve the findings, apply replacements and verify. The export button remains disabled unless the code-owned verification returns pass. The successful export uses a neutral filename and clears the in-memory session.

### 7. Test site checks

Click **Check site** to inspect the currently open HTTP(S) page, or paste a URL for address-only checks. The extension inspects field *metadata*, never form values. The UI must clearly show unavailable checks. No external website is fetched by pasted-URL mode.

## Local model configuration

This starter does not hard-code a model tag because availability, exact terms and license need to be confirmed for the model installed on the team's machine. Run Ollama locally, pull the model you choose, and set `OLLAMA_MODEL` to its exact installed tag before launching the backend. Keep `OLLAMA_URL` on loopback. The model may suggest contextual names/addresses; code validates every returned value against the source and code performs all replacement.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Backend/model status, no document content |
| POST | `/redact/start` | Scan a supported TXT/Markdown document in memory |
| POST | `/redact/update` | Apply approvals/rejections and user-added findings |
| POST | `/redact/verify` | Re-scan approved findings and verify basic integrity |
| POST | `/redact/export` | Download TXT/Markdown only when verification passes; clears session |
| POST | `/redact/clear` | Clear the in-memory session |
| POST | `/site/check` | Normalize/check a URL and return evidence + unavailable checks |

Protected requests require `X-Bharosa-Token`. Requests carrying an `Origin` must match `BHAROSA_ALLOWED_ORIGINS`.

## Architecture

```text
Chrome MV3 popup
  ├── Redact: file text -> local FastAPI -> deterministic candidates
  │            -> optional local Ollama contextual candidates
  │            -> user review -> code replaces -> verifier -> TXT/MD download
  └── Check site: current-tab snapshot / pasted address -> local FastAPI
                 -> URL normalization + reviewed registry + local heuristics
                 -> evidence ledger + unavailable checks -> explained verdict
```

The extension never reads password, OTP or payment field values. Pasted-link mode is address-only and does not fetch the URL. The page text used for current-tab analysis is sent only to the user's own loopback backend in this prototype; do not add a remote model or remote page-text API.

## Test commands

From `backend/` with its virtual environment active:

```bash
python -m compileall -q app
pytest -q
```

## Project rules

- Use only synthetic planted identifiers in tests and screenshots.
- Never claim “guaranteed safe” or “guaranteed private.”
- Report timeouts/missing integrations as unavailable, never as clean.
- Keep the evidence log owned by code; agents cannot invent or edit log records.
- Do not make a reviewed official-domain claim until the registry entry has a real source and a recorded review date.
- Update the README with the actual model name, version and license only after verifying the exact model in use.
