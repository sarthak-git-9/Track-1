# Integrating Bharosa into `sarthak-git-9/Track-1`

The repository currently has a small starter history and a shared test-fixture branch. This patch targets the already-existing `test/task-1-shared-fixtures` branch and never switches to or writes to `main`.

## One-command integration on macOS

1. Download and extract `Track-1_Bharosa_Implementation_Patch.zip`.
2. Open Terminal in the extracted `Track-1-bharosa-patch` folder.
3. Run the script with your local repository path (or omit the argument to clone into `~/Track-1`):

```bash
./apply_to_existing_branch.sh ~/Track-1
```

The script verifies the remote and branch, aborts if your working tree has uncommitted changes, fetches the existing branch, copies the starter without Python cache files, keeps an existing LICENSE intact, installs backend requirements in `backend/.venv`, runs backend tests and syntax checks, creates four milestone commits, and pushes only `test/task-1-shared-fixtures`. It does not force-push or merge into `main`.

If your current clone is in another location, pass that path. If local Git authentication does not permit pushing, the script leaves the commits on your local branch and prints the push command.

## Included starter capabilities

- FastAPI backend bound to loopback, token-protected routes and extension-origin allow-list.
- In-memory TXT/Markdown redaction workflow with review before replacement and code-owned verification.
- Evidence-led site check using URL normalization, a placeholder official-domain registry, lookalike heuristics and form metadata.
- Chrome Manifest V3 popup for redaction and current-tab/pasted-address checks.
- Synthetic tests, CI workflow and preflight checks.

## Known gaps (not release-ready)

This remains a starter vertical slice. Text-based PDF extraction/export, a live threat-intelligence provider, RDAP and certificate lookup, social-review collection, independent contextual verification, and thorough security/browser tests still need implementation. `data/official_domains.json` is intentionally unreviewed demo data. A missing or unavailable check must never be treated as proof that a website is safe.
