param([string]$Container = 'gateway-database')
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskDatabase = 'c4_docker_verify_' + ([guid]::NewGuid().ToString('N').Substring(0, 12))
if ($taskDatabase -notmatch '^c4_docker_verify_[a-f0-9]{12}$') { throw 'Invalid verification database name' }
$taskEnvironment = @{}
foreach ($taskName in @('DB_NAME', 'MIGRATION_DB_PASSWORD', 'MIGRATIONS_DIR')) { $taskEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
$taskCreated = $false
$taskResult = 1
try {
    docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $taskDatabase"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create verification database' }
    $taskCreated = $true
    $env:DB_NAME = $taskDatabase
    $env:MIGRATION_DB_PASSWORD = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'localdev' }
    $env:MIGRATIONS_DIR = Join-Path $taskRoot 'services/gateway/db/migrations'
    Push-Location -LiteralPath (Join-Path $taskRoot 'services/gateway')
    try {
        node -r dotenv/config scripts/migrate.js
        if ($LASTEXITCODE -ne 0) { throw 'Fresh migration failed' }
        node -r dotenv/config scripts/migrate.js
        if ($LASTEXITCODE -ne 0) { throw 'Repeated migration failed' }
        $taskResult = 0
    } finally { Pop-Location }
} finally {
    foreach ($taskName in $taskEnvironment.Keys) { [Environment]::SetEnvironmentVariable($taskName, $taskEnvironment[$taskName], 'Process') }
    if ($taskCreated -and $taskDatabase -match '^c4_docker_verify_[a-f0-9]{12}$') {
        docker exec $Container psql -U admin -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $taskDatabase WITH (FORCE)"
        if ($LASTEXITCODE -ne 0) { Write-Warning ('Could not remove verification database ' + $taskDatabase) }
    }
}
exit $taskResult
