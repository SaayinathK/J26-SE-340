$ErrorActionPreference = 'Stop'
$baseUrl = 'http://127.0.0.1:4000'
$health = Invoke-RestMethod "$baseUrl/health"
if ($health.status -ne 'ok') { throw 'Gateway unhealthy' }
$login = Invoke-RestMethod "$baseUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"admin@tenant-a.com","password":"Test@12345"}'
$headers = @{ Authorization = 'Bearer ' + $login.access_token; 'X-Tenant-Id' = 'tenant_b' }
$normalDashboard = Invoke-RestMethod "$baseUrl/api/leads/dashboard" -Headers @{ Authorization = 'Bearer ' + $login.access_token }
$spoofedDashboard = Invoke-RestMethod "$baseUrl/api/leads/dashboard" -Headers $headers
if (($normalDashboard | ConvertTo-Json -Depth 12) -ne ($spoofedDashboard | ConvertTo-Json -Depth 12)) { throw 'Client tenant header changed tenant data' }
$otherLogin = Invoke-RestMethod "$baseUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"admin@tenant-b.com","password":"Test@12345"}'
$otherDashboard = Invoke-RestMethod "$baseUrl/api/leads/dashboard" -Headers @{ Authorization = 'Bearer ' + $otherLogin.access_token }
$firstTenantIds = @($normalDashboard.top_10_hottest | ForEach-Object { $_.lead_id })
foreach ($otherLead in $otherDashboard.top_10_hottest) {
    if ($otherLead.lead_id -in $firstTenantIds) { throw 'Lead leaked between tenant dashboards' }
}
Write-Output 'PASS JWT tenant isolation and spoofed tenant header rejection'
foreach ($endpoint in @('analytics', 'dashboard', 'monitoring', 'history')) {
    $null = Invoke-RestMethod "$baseUrl/api/leads/$endpoint" -Headers $headers
    Write-Output "PASS gateway -> lead-intel: $endpoint"
}
$score = Invoke-RestMethod "$baseUrl/api/leads/score" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"lead_id":"docker-smoke","time_on_site_sec":600,"total_visits":5,"pages_per_visit":3}'
if ($score.score -lt 0 -or $score.score -gt 100) { throw 'Invalid score' }
$saved = Invoke-RestMethod "$baseUrl/api/leads/docker-smoke/history" -Headers $headers
if ($saved.storage -ne 'postgres' -or $saved.counts.scores -lt 1) { throw 'Score was not saved in the C3 database' }
Write-Output 'PASS score saved in the C3 database (lead history)'
$null = Invoke-RestMethod 'http://127.0.0.1:8501/_stcore/health'
Write-Output 'PASS login, scoring, dashboard health'
