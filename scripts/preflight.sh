#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo '== Python syntax =='
python3 -m compileall -q backend/app backend/tests

echo '== Backend tests =='
(cd backend && python3 -m pytest -q)

if command -v node >/dev/null 2>&1; then
  echo '== Extension JavaScript syntax =='
  node --check extension/popup.js
else
  echo 'SKIP: Node.js not found; extension JavaScript syntax check was not run.'
fi

if [[ -d .git ]]; then
  echo '== Git whitespace / status =='
  git diff --check
  git status --short
else
  echo 'SKIP: This folder is a starter kit, not a Git clone. Run preflight inside your project after merging.'
fi

echo 'Preflight finished. Browser/manual demo checks are still required.'
