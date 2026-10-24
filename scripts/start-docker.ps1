$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($asset in @('ml/models/lead-intel/lead_scorer.joblib', 'ml/lead-intel/data/processed/leads_ghl.jsonl', 'ml/lead-intel/data/processed/kb/tenant_a_vectors.npy', 'ml/lead-intel/data/processed/kb/tenant_b_vectors.npy', 'ml/lead-intel/data/processed/kb/tenant_c_vectors.npy')) {
        if (-not (Test-Path $asset)) { throw "Missing Lead Intelligence asset: $asset. See ml/lead-intel/README.md." }
    }
    if (-not (Test-Path '.env')) {
        $secretBytes = New-Object byte[] 48
        $secretGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $secretGenerator.GetBytes($secretBytes)
        Set-Content '.env' ('JWT_SECRET=' + [Convert]::ToBase64String($secretBytes))
        $secretGenerator.Dispose()
    }
    docker compose build
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
    docker compose up -d --wait db lead-intel-database lead-intel
    if ($LASTEXITCODE -ne 0) { throw 'Database or Lead Intelligence startup failed' }
    docker compose run --rm --no-deps gateway node scripts/seed-users.js
    if ($LASTEXITCODE -ne 0) { throw 'User seed failed' }
    docker compose up -d --wait gateway frontend
    if ($LASTEXITCODE -ne 0) { throw 'Gateway or frontend startup failed' }
    & (Join-Path $PSScriptRoot 'smoke-docker.ps1')
    docker compose up -d --wait ollama
    if ($LASTEXITCODE -ne 0) { throw 'Ollama startup failed' }
    $availableModels = (docker compose exec -T ollama ollama list) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list Ollama models' }
    # C3 models (nomic-embed-text + c3-mistral-ft) are prepared by the lead-intel-model container itself
    docker compose up -d --wait lead-intel-model
    if ($LASTEXITCODE -ne 0) { Write-Warning 'lead-intel-model did not start - set C3_OLLAMA_URL in .env to use Ollama on the host' }
    if ($availableModels -notmatch '(?m)^mistral:7b-instruct-q4_K_M\s') {
        docker compose exec -T ollama ollama pull mistral:7b-instruct-q4_K_M
        if ($LASTEXITCODE -ne 0) { throw 'Email model download failed' }
    }
    docker compose exec -T gateway node scripts/seed-kb.js
    if ($LASTEXITCODE -ne 0) { throw 'Email knowledge base seed failed' }
} finally {
    Pop-Location
}
