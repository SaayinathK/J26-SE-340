param([switch]$ContainerBuild)
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
# The shared web app is launched by the root stack.
& powershell -NoProfile -File (Join-Path $taskRoot 'scripts/start.ps1') -ContainerBuild:$ContainerBuild
exit $LASTEXITCODE
