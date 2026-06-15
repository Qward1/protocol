#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${PYTHON:-python}"

if ! command -v "$python_bin" >/dev/null 2>&1; then
  python_bin="python3"
fi

cd "$repo_root/frontend"
npm install
npm run build

cd "$repo_root/backend"
if [[ ! -d ".venv" ]]; then
  "$python_bin" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python - <<'PY'
from app.services.media import ffmpeg_bin, ffmpeg_available
import uvicorn

binary = ffmpeg_bin()
if not ffmpeg_available():
    raise SystemExit(f"ffmpeg is not executable: {binary}")

print(f"Backend preflight OK: uvicorn={uvicorn.__version__}, ffmpeg={binary}")
PY
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
