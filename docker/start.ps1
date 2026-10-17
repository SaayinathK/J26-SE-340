param([switch]$ContainerBuild)
& powershell -NoProfile -File (Join-Path $PSScriptRoot '../scripts/start.ps1') -ContainerBuild:$ContainerBuild
exit $LASTEXITCODE
