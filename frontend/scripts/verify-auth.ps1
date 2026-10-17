param([string]$Container = 'gateway-database', [switch]$DirectDatabase)
$ErrorActionPreference = 'Stop'
$taskFrontend = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskRoot = (Resolve-Path (Join-Path $taskFrontend '..')).Path
$taskGateway = Join-Path $taskRoot 'services/gateway'
$taskDatabase = 'c4_browser_verify_' + ([guid]::NewGuid().ToString('N').Substring(0, 12))
if ($taskDatabase -notmatch '^c4_browser_verify_[a-f0-9]{12}$') { throw 'Invalid test database name' }
$taskCreated = $false
$taskGatewayProcess = $null
$taskFrontendProcess = $null
$taskExit = 1
$taskEnvironment = @{}
foreach ($taskName in @('DB_NAME', 'PORT', 'CLIENT_ORIGINS', 'GOOGLE_CLIENT_ID', 'GATEWAY_URL', 'CIFTRON_BASE_URL', 'CIFTRON_AUTH_TEST_DATABASE')) { $taskEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
try {
    if ($DirectDatabase) {
        node (Join-Path $taskGateway 'scripts/test-database.js') create $taskDatabase
        if ($LASTEXITCODE -ne 0) { throw 'Could not create/migrate isolated browser test database' }
        $taskCreated = $true
    } else {
        docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $taskDatabase"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated browser test database' }
        $taskCreated = $true
        foreach ($taskMigration in @('001_init.sql', '002_app_role.sql', '003_auth_lookup.sql', '004_accounts_and_sessions.sql', '005_workspace_records.sql')) {
            Get-Content -Raw -LiteralPath (Join-Path $taskRoot ('services/gateway/db/migrations/' + $taskMigration)) | docker exec -i $Container psql -U admin -d $taskDatabase -v ON_ERROR_STOP=1
            if ($LASTEXITCODE -ne 0) { throw "Test migration failed: $taskMigration" }
        }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $taskFrontend '.local') | Out-Null
    $env:DB_NAME = $taskDatabase
        $env:CLIENT_ORIGINS = 'http://127.0.0.1:5175,http://localhost:5175'
    # Provider verification is covered separately; automated UI tests never use a real Google account.
    $env:GOOGLE_CLIENT_ID = 'disabled-for-isolated-browser-tests'
    $env:GATEWAY_URL = 'http://127.0.0.1:4010'
    $env:CIFTRON_BASE_URL = 'http://127.0.0.1:5175'
    $env:CIFTRON_AUTH_TEST_DATABASE = 'isolated'
    $env:PORT = '4010'
    $taskGatewayProcess = Start-Process -FilePath 'node' -ArgumentList @('src/main.js') -WorkingDirectory $taskGateway -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskFrontend '.local/auth-gateway.log') -RedirectStandardError (Join-Path $taskFrontend '.local/auth-gateway-error.log')
    $taskFrontendProcess = Start-Process -FilePath 'node' -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort') -WorkingDirectory $taskFrontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskFrontend '.local/auth-vite.log') -RedirectStandardError (Join-Path $taskFrontend '.local/auth-vite-error.log')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 25; $taskAttempt++) {
        if ($taskGatewayProcess.HasExited -or $taskFrontendProcess.HasExited) { throw 'A test server exited. See frontend/.local/auth-*-error.log; ports 4010 and 5175 must be free.' }
        try {
            $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4010/health' -TimeoutSec 2
            $taskPage = Invoke-WebRequest -Uri 'http://127.0.0.1:5175/' -UseBasicParsing -TimeoutSec 2
            if ($taskHealth.status -eq 'ok' -and $taskPage.StatusCode -eq 200) { $taskReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $taskReady) { throw 'Test servers did not become ready' }
    Push-Location -LiteralPath $taskFrontend
    try { node scripts/browser-check.cjs; $taskExit = $LASTEXITCODE } finally { Pop-Location }
} finally {
    foreach ($taskProcess in @($taskFrontendProcess, $taskGatewayProcess)) {
        if ($null -ne $taskProcess) {
            $taskLiveProcess = Get-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue
            if ($null -ne $taskLiveProcess -and $taskLiveProcess.ProcessName -eq 'node' -and $taskLiveProcess.StartTime -eq $taskProcess.StartTime) { Stop-Process -Id $taskProcess.Id -Force }
        }
    }
    foreach ($taskName in $taskEnvironment.Keys) { [Environment]::SetEnvironmentVariable($taskName, $taskEnvironment[$taskName], 'Process') }
    if ($taskCreated -and $taskDatabase -match '^c4_browser_verify_[a-f0-9]{12}$') {
        if ($DirectDatabase) { node (Join-Path $taskGateway 'scripts/test-database.js') drop $taskDatabase }
        else { docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $taskDatabase WITH (FORCE)" }
        if ($LASTEXITCODE -ne 0) { Write-Warning "Browser test database cleanup failed: $taskDatabase" }
    }
}
exit $taskExit
