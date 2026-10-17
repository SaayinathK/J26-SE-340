param([switch]$ContainerBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $taskRoot
try {
    node scripts/setup.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Local configuration failed.' }
    $taskCompose = @('compose', '-f', 'docker-compose.yml')
    if (-not $ContainerBuild) {
        npm run build --prefix frontend
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        foreach ($taskService in @('gateway', 'email-agent')) {
            node "services/$taskService/scripts/prepare-runtime.cjs"
            if ($LASTEXITCODE -ne 0) { throw "Runtime preparation failed: $taskService" }
        }
        $taskCompose += @('-f', 'docker-compose.prebuilt.yml')
    }
    & docker @taskCompose build frontend gateway email-agent content-agent lead-intel strategy-fl content-agent-model lead-intel-model strategy-fl-model
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed; existing containers were left running.' }
    # The existing email model image/cache is retained; build it only when absent.
    docker image inspect ciftron-email-agent-model:local *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker @taskCompose build email-agent-model
        if ($LASTEXITCODE -ne 0) { throw 'Email model image build failed.' }
    }
    & docker @taskCompose up -d --no-build --wait gateway-database email-agent-database content-agent-database lead-intel-database strategy-fl-database
    if ($LASTEXITCODE -ne 0) { throw 'Database startup failed.' }
    node scripts/migrate-all.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Migrations failed.' }
    & docker @taskCompose up -d --no-build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Application startup failed.' }
    Write-Host 'Open http://127.0.0.1:5173'
} finally { Pop-Location }
