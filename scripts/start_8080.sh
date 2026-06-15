#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root/frontend"
npm install
npm run build

cd "$repo_root/backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
