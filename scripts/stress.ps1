$ErrorActionPreference = 'Stop'
if (-not $env:TEST_DATABASE_URL) { throw 'Set TEST_DATABASE_URL to a disposable PostgreSQL database.' }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    go test -race -count=10 -run Test100ConcurrentHTTPClaims -v ./tests/concurrency
    if ($LASTEXITCODE -ne 0) { throw 'Concurrency stress test failed' }
} finally { Pop-Location }
