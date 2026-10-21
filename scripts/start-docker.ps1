$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($asset in @('models/lead_scorer.joblib', 'data/processed/leads_ghl.jsonl', 'data/kb/tenant_a_vectors.npy', 'data/kb/tenant_b_vectors.npy', 'data/kb/tenant_c_vectors.npy')) {
        if (-not (Test-Path (Join-Path 'services/lead-intel' $asset))) { throw "Missing Lead Intelligence asset: $asset. See docs/docker.md." }
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
    docker compose up -d --wait db lead-intel
    if ($LASTEXITCODE -ne 0) { throw 'Database or Lead Intelligence startup failed' }
    docker compose run --rm --no-deps gateway node scripts/seed-users.js
    if ($LASTEXITCODE -ne 0) { throw 'User seed failed' }
    docker compose up -d --wait gateway dashboard
    if ($LASTEXITCODE -ne 0) { throw 'Gateway or dashboard startup failed' }
    & (Join-Path $PSScriptRoot 'smoke-docker.ps1')
    docker compose up -d --wait ollama
    if ($LASTEXITCODE -ne 0) { throw 'Ollama startup failed' }
    $availableModels = (docker compose exec -T ollama ollama list) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list Ollama models' }
    if ($availableModels -notmatch '(?m)^nomic-embed-text:latest\s') {
        docker compose exec -T ollama ollama pull nomic-embed-text
        if ($LASTEXITCODE -ne 0) { throw 'Embedding model download failed' }
    }
    if ($availableModels -notmatch '(?m)^c3-mistral-ft:latest\s') {
        docker compose exec -T ollama ollama create c3-mistral-ft -f /Modelfile
        if ($LASTEXITCODE -ne 0) { throw 'Fine-tuned model import failed' }
    }
    if ($availableModels -notmatch '(?m)^mistral:7b-instruct-q4_K_M\s') {
        docker compose exec -T ollama ollama pull mistral:7b-instruct-q4_K_M
        if ($LASTEXITCODE -ne 0) { throw 'Email model download failed' }
    }
    docker compose exec -T gateway node scripts/seed-kb.js
    if ($LASTEXITCODE -ne 0) { throw 'Email knowledge base seed failed' }
} finally {
    Pop-Location
}
