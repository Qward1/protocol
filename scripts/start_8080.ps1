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
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
}
finally {
  Pop-Location
}
