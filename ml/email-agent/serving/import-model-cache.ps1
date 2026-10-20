param([string]$Container = 'email-agent-model', [string[]]$Models)
$ErrorActionPreference = 'Stop'
$taskService = (Resolve-Path (Join-Path $PSScriptRoot '../../../services/email-agent')).Path
$taskCache = Join-Path $PSScriptRoot '.local/models'
if (-not $Models) {
    $Models = @(Get-Content -LiteralPath (Join-Path $taskService '.env') | Where-Object { $_ -match '^(OLLAMA_MODEL|EMBED_MODEL)=' } | ForEach-Object { (($_.Split('=', 2)[1] -split '#', 2)[0]).Trim().Trim([char[]]@([char]34, [char]39)) })
}
foreach ($taskName in $Models) {
    if ($taskName -notmatch '^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._-]+)?$') { throw 'Unsupported model tag format.' }
    $taskParts = $taskName.Split(':', 2)
    $taskRepository = $taskParts[0]
    if (-not $taskRepository.Contains('/')) { $taskRepository = 'library/' + $taskRepository }
    $taskTag = if ($taskParts.Count -gt 1) { $taskParts[1] } else { 'latest' }
    $taskRelative = 'manifests/registry.ollama.ai/' + $taskRepository + '/' + $taskTag
    $taskManifest = Join-Path $taskCache $taskRelative
    if (-not (Test-Path -LiteralPath $taskManifest)) { Write-Output "No local cache for $taskName; install it with ollama pull in $Container."; continue }
    $taskData = Get-Content -Raw -LiteralPath $taskManifest | ConvertFrom-Json
    & docker exec $Container mkdir -p /models/blobs ('/models/manifests/registry.ollama.ai/' + $taskRepository)
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare model cache.' }
    $taskDigests = @($taskData.config.digest) + @($taskData.layers | ForEach-Object { $_.digest })
    foreach ($taskDigest in ($taskDigests | Select-Object -Unique)) {
        if ($taskDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid model digest.' }
        $taskBlob = $taskDigest.Replace(':', '-')
        $taskSource = Join-Path $taskCache ('blobs/' + $taskBlob)
        $taskSize = (Get-Item -LiteralPath $taskSource).Length
        $taskExisting = & docker exec $Container sh -c "stat -c %s /models/blobs/$taskBlob 2>/dev/null || true"
        if ($taskExisting -ne [string]$taskSize) {
            & node (Join-Path $PSScriptRoot 'copy-model-blob.cjs') $taskSource ($Container + ':/models/blobs/' + $taskBlob + '.partial')
            if ($LASTEXITCODE -ne 0) {
                & docker exec $Container rm -f ('/models/blobs/' + $taskBlob + '.partial')
                throw 'Model copy failed; manifest was not installed.'
            }
            & docker exec $Container mv ('/models/blobs/' + $taskBlob + '.partial') ('/models/blobs/' + $taskBlob)
            if ($LASTEXITCODE -ne 0) { throw 'Model cache commit failed.' }
        }
    }
    & docker cp $taskManifest ($Container + ':/models/' + $taskRelative)
    if ($LASTEXITCODE -ne 0) { throw 'Model manifest copy failed.' }
    Write-Output "Imported $taskName into the native Docker model volume."
}
