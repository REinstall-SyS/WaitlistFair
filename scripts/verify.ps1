$ErrorActionPreference = 'Stop'
if (-not $env:TEST_DATABASE_URL) { throw 'Set TEST_DATABASE_URL to a disposable PostgreSQL database to include integration and concurrency checks.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'go vet failed' }
    go test -race -count=1 -v ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go tests failed' }
    Push-Location 'apps/web'
    try {
        foreach ($script in @('lint', 'typecheck', 'test', 'build')) {
            npm run $script
            if ($LASTEXITCODE -ne 0) { throw "$script failed" }
        }
    } finally { Pop-Location }
} finally { Pop-Location }
