param([string]$Container = 'email-agent-database')
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskGateway = Join-Path $taskRoot 'services/email-agent'
$taskDatabase = 'email_auth_verify_' + ([guid]::NewGuid().ToString('N').Substring(0, 12))
if ($taskDatabase -notmatch '^email_auth_verify_[a-f0-9]{12}$') { throw 'Invalid test database name' }
$taskCreated = $false
$taskExit = 1
$taskOldDatabase = $env:DB_NAME
$taskOldPort = $env:DB_PORT
try {
    docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $taskDatabase"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test database' }
    $taskCreated = $true
    foreach ($taskMigration in @('001_init.sql', '002_app_role.sql', '003_auth_lookup.sql', '004_accounts_and_sessions.sql', '005_workspace_records.sql', '006_gateway_identity.sql')) {
        $taskMigrationPath = Join-Path $taskRoot ('services/email-agent/db/migrations/' + $taskMigration)
        Get-Content -Raw -LiteralPath $taskMigrationPath | docker exec -i $Container psql -U admin -d $taskDatabase -v ON_ERROR_STOP=1
        if ($LASTEXITCODE -ne 0) { throw "Test migration failed: $taskMigration" }
    }
    $env:DB_NAME = $taskDatabase
    $env:DB_PORT = '5434'
    Push-Location -LiteralPath $taskGateway
    try {
        node node_modules/jest/bin/jest.js --runInBand --forceExit --detectOpenHandles --runTestsByPath tests/integration/accounts.test.js tests/integration/email.test.js
        $taskExit = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:DB_NAME = $taskOldDatabase
    $env:DB_PORT = $taskOldPort
    # Only the uniquely named database created by this invocation is removed.
    if ($taskCreated -and $taskDatabase -match '^email_auth_verify_[a-f0-9]{12}$') {
        docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $taskDatabase WITH (FORCE)"
        if ($LASTEXITCODE -ne 0) { Write-Warning "Test database cleanup failed: $taskDatabase" }
    }
}
exit $taskExit
