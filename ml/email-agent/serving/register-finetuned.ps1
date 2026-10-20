param(
    [string]$Container = 'email-agent-model',
    [string]$Url = 'http://127.0.0.1:11435',
    [string]$ModelName = 'c4-email-ft'
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskAdapter = Join-Path $taskRoot 'ml/models/email-agent/c4-email-lora'
$taskWeights = Join-Path $taskAdapter 'adapter_model.safetensors'
$taskConfiguration = Get-Content -Raw -LiteralPath (Join-Path $taskAdapter 'adapter_config.json') | ConvertFrom-Json
if ($taskConfiguration.base_model_name_or_path -ne 'unsloth/mistral-7b-instruct-v0.3') { throw 'This recipe requires the existing Mistral 7B Instruct v0.3 adapter.' }
if (-not (Test-Path -LiteralPath $taskWeights)) { throw 'Fine-tuned adapter weights are missing under ml/models/email-agent/c4-email-lora.' }
if ($ModelName -notmatch '^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$') { throw 'Invalid local model name.' }
$taskOrigin = [uri]$Url
if ($taskOrigin.Scheme -notin @('http','https') -or $taskOrigin.UserInfo -or $taskOrigin.AbsolutePath -ne '/' -or $taskOrigin.Query -or $taskOrigin.Fragment) { throw 'Url must be an HTTP(S) origin.' }
$taskBase = 'mistral:7b-instruct-v0.3-q4_K_M'
$taskTags = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/api/tags') -TimeoutSec 10
if ($taskTags.models.name -notcontains $taskBase) {
    & powershell -NoProfile -File (Join-Path $PSScriptRoot 'import-model-cache.ps1') -Container $Container -Models $taskBase
    if ($LASTEXITCODE -ne 0) { throw 'Matching base cache import failed.' }
    $taskTags = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/api/tags') -TimeoutSec 10
    if ($taskTags.models.name -notcontains $taskBase) { throw "Matching base is not installed. Pull $taskBase explicitly before retrying." }
}
$taskDigest = (Get-FileHash -LiteralPath $taskWeights -Algorithm SHA256).Hash.ToLower()
$taskRemote = '/models/imports/c4-email-lora/' + $taskDigest
$taskLocal = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $taskLocal | Out-Null
# Use the CLI shipped with the pinned Docker runtime. Newer host clients may
# reject ADAPTER before sending a create request to this older compatible server.
& docker exec $Container mkdir -p $taskRemote
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare adapter import storage.' }
foreach ($taskFile in @('adapter_config.json','adapter_model.safetensors')) {
    & docker cp (Join-Path $taskAdapter $taskFile) ($Container + ':' + $taskRemote + '/' + $taskFile)
    if ($LASTEXITCODE -ne 0) { throw "Could not copy $taskFile into the owned model volume." }
}
$taskDockerModelfile = Join-Path $taskLocal 'Modelfile.docker'
((Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Modelfile')) -replace '(?m)^ADAPTER .+$', ('ADAPTER ' + $taskRemote)) |
    Set-Content -LiteralPath $taskDockerModelfile -Encoding ASCII
& docker cp $taskDockerModelfile ($Container + ':' + $taskRemote + '/Modelfile')
if ($LASTEXITCODE -ne 0) { throw 'Could not stage the model recipe.' }
& docker exec -e OLLAMA_HOST=http://127.0.0.1:11434 $Container ollama create $ModelName -f ($taskRemote + '/Modelfile')
if ($LASTEXITCODE -ne 0) { throw 'Ollama adapter import failed. No successful inference has been established.' }
$taskShow = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/api/show') -Method Post -ContentType 'application/json' -Body (@{ model = $ModelName } | ConvertTo-Json) -TimeoutSec 15
if ($taskShow.modelfile -notmatch '(?im)^ADAPTER\s+') { throw 'Registered model does not declare an adapter.' }
@{ model = $ModelName; base_model = $taskBase; adapter_source = $taskConfiguration.base_model_name_or_path; adapter_sha256 = $taskDigest; server_url = $Url; registration_verified = $true; inference_verified = $false } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLocal 'fine-tuned-registration.json') -Encoding UTF8
Write-Output "Registered $ModelName on $Url with the saved adapter. Run evaluate_live.py to check inference and quality."
Write-Output 'The application model setting was not changed.'
