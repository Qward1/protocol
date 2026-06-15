$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location "$repoRoot\frontend"
try {
  npm install
  npm run build
}
finally {
  Pop-Location
}

Push-Location "$repoRoot\backend"
try {
  if (-not (Test-Path ".venv")) {
    python -m venv .venv
  }

  & ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
  & ".\.venv\Scripts\python.exe" -c "from app.services.media import ffmpeg_bin, ffmpeg_available; import uvicorn; binary = ffmpeg_bin(); assert ffmpeg_available(), f'ffmpeg is not executable: {binary}'; print(f'Backend preflight OK: uvicorn={uvicorn.__version__}, ffmpeg={binary}')"
  & ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8080
}
finally {
  Pop-Location
}
