$ErrorActionPreference = 'Stop'
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
