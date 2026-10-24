# Bharosa commit plan for `sarthak-git-9/Track-1`

The integration script targets the existing `test/task-1-shared-fixtures` branch. It never modifies `main`, force-pushes, or merges automatically. Before running, ensure your local checkout has no uncommitted work.

## Commits created by `apply_to_existing_branch.sh`

1. `chore(repo): add Bharosa scaffolding and setup docs` — `.gitignore`, environment example, README, integration plan and synthetic sample.
2. `feat(backend): add local redaction and evidence-led site checks` — FastAPI routes, local security helpers, redaction workflow, optional localhost-only model adapter, site-check rules and data files.
3. `test: add Bharosa regression tests and CI preflight` — synthetic regression tests, GitHub Actions and local preflight script.
4. `feat(extension): add redaction and site-check popup` — Manifest V3 popup, styling and local API integration.

The script installs dependencies in `backend/.venv`, compiles Python, runs the backend tests, checks extension JavaScript syntax when Node.js is available, and runs `git diff --check` before committing. If validation fails, the script stops before creating commits. If pushing fails, local commits remain for review.

## Manual checks still required

- Load the extension in Chrome and configure its actual extension ID in `BHAROSA_ALLOWED_ORIGINS`.
- Demonstrate review-before-redaction with only synthetic data.
- Confirm the session token and document contents never enter Git or logs.
- Verify pasted-link mode never fetches the target website.
- Confirm every unavailable external check is shown as unavailable, not safe.
- Test on the team's demo laptops before the pitch.

## Follow-up implementation commits

- `feat(pdf): parse text-based PDFs and export fresh metadata-clean PDFs`
- `feat(redaction): add chunked contextual detection and independent verification`
- `feat(site): integrate a compliant threat-intelligence provider`
- `feat(site): add RDAP and certificate evidence with graceful timeouts`
- `feat(site): add sourced review collection after terms verification`
- `test(security): add browser-level and privacy regression coverage`

These are future milestones, not implemented features in the starter kit. Do not create empty commits for them.
