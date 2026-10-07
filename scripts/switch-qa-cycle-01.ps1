$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$signalQaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $signalQaRoot
try {
  $signalTested = Get-Content outputs/verification/qa-cycle-01-isolated-runtime.json -Raw | ConvertFrom-Json
  foreach ($signalProof in 'quality','id','matching','general','managed','opportunities') {
    $signalResult = Get-Content "outputs/verification/qa-cycle-01-$signalProof-http.json" -Raw | ConvertFrom-Json
    if (-not $signalResult.passed) { throw "Required HTTP proof $signalProof failed" }
  }
  $signalBank = Get-Content outputs/verification/qa-cycle-01-bank.json -Raw | ConvertFrom-Json
  if (-not $signalBank.verified) { throw 'Built bank verification missing' }
  $signalTaggedImage = docker image inspect --format '{{.Id}}' signal-qa-cycle-01-app
  if ($LASTEXITCODE -ne 0 -or $signalTaggedImage -ne $signalTested.imageId) { throw 'Tested image tag changed' }
  @'
services:
  app:
    image: signal-qa-cycle-01-app
    pull_policy: never
    command: ["node", "artifacts/api-server/dist/index.mjs"]
'@ | Set-Content -LiteralPath outputs/verification/qa-cycle-01-preserve.compose.yaml -Encoding utf8
  docker compose -p fsp-signal -f compose.yaml -f outputs/verification/qa-cycle-01-preserve.compose.yaml --profile full up -d --no-deps --no-build app
  if ($LASTEXITCODE -ne 0) { throw 'Working app switch failed' }
  $signalHealthy = $false
  for ($signalRetry=0; $signalRetry -lt 10; $signalRetry++) {
    try { $signalHealthy = (Invoke-RestMethod http://127.0.0.1:4310/api/healthz -TimeoutSec 3).status -eq 'ok' } catch { $signalHealthy = $false }
    if ($signalHealthy) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $signalHealthy) { throw 'Working health endpoint not ready' }
  node scripts/qa-runtime-hashes.mjs --container fsp-signal-app-1 --report outputs/verification/qa-cycle-01-working-runtime.json
  if ($LASTEXITCODE -ne 0) { throw 'Working source attestation failed' }
  $signalWorking = Get-Content outputs/verification/qa-cycle-01-working-runtime.json -Raw | ConvertFrom-Json
  if ($signalWorking.imageId -ne $signalTested.imageId -or $signalWorking.bundleSHA -ne $signalTested.bundleSHA) { throw 'Working image differs from tested image' }
  if (($signalWorking.command -join '|') -ne 'node|artifacts/api-server/dist/index.mjs') { throw 'Working startup could seed the database' }
  node --env-file-if-exists=.env --import tsx scripts/snapshot-qa-preserved-state.ts after
  if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA records changed' }
  $signalBefore = Get-Content outputs/verification/qa-cycle-01-runtime-before.json -Raw | ConvertFrom-Json
  foreach ($signalName in 'fsp-signal-db-1','fsp-signal-mail-1') {
    $signalInfo = docker inspect --format '{{json .}}' $signalName | ConvertFrom-Json
    $signalOld = $signalBefore.containers | Where-Object name -eq "/$signalName"
    if ($signalInfo.Id -ne $signalOld.id -or $signalInfo.State.StartedAt -ne $signalOld.startedAt) { throw "Preserved $signalName restarted" }
  }
  $signalQuality = Invoke-RestMethod http://127.0.0.1:4310/api/quality/report -TimeoutSec 5
  if ($signalQuality.status -ne 'current') { throw 'Working quality report not current' }
  [ordered]@{
    status = 'ready'; preparedAt = [DateTime]::UtcNow.ToString('o'); baseUrl = 'http://localhost:4310'
    imageId = $signalWorking.imageId; containerId = $signalWorking.containerId
    bundleSHA = $signalWorking.bundleSHA; frontendManifestSHA = $signalWorking.frontendManifestSHA
    sourceHashes = $signalWorking.sourceHashes; deployedAggregateSHA = $signalWorking.deployedAggregateSHA
    startup = 'node artifacts/api-server/dist/index.mjs; migration/seed startup bypassed'
    protectedRecords = 'Two ordinary QA accounts, attempt1134/need179 verified unchanged by before/after row hashes'
    databaseAndMail = 'Existing containers and volumes preserved without restart'
    testedRuntimeProof = 'outputs/verification/qa-cycle-01-isolated-runtime.json'
    independentAcceptance = 'pending HTTP/UI retest; runtime frozen until independent acceptance'
  } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath outputs/verification/qa-cycle-01-runtime-ready.json -Encoding utf8
  Write-Output 'Working Signal 4310 ready; tested image reused; protected records unchanged. Runtime frozen for independent retest.'
} finally { Pop-Location }
