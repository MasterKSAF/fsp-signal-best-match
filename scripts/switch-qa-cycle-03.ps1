$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$signalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signalOldPrefix = [Environment]::GetEnvironmentVariable('QA07_PRESERVATION_PREFIX','Process')
$signalOldOrigin = [Environment]::GetEnvironmentVariable('LOAD_API_ORIGIN','Process')
Push-Location -LiteralPath $signalRoot
try {
  $signalTested = Get-Content outputs/verification/qa-cycle-03-isolated-runtime.json -Raw | ConvertFrom-Json
  $signalTarget = Get-Content outputs/verification/qa-cycle-03-matching-http.json -Raw | ConvertFrom-Json
  if (-not $signalTarget.passed) { throw 'Root targeted matching HTTP proof failed' }
  $signalSql = Get-Content outputs/verification/qa07-readonly-perf.json -Raw | ConvertFrom-Json
  if (-not $signalSql.actualSqlCapturedFromProductionLoader -or -not $signalSql.rubricHashesAndObjectKeysEquivalent -or -not $signalSql.malformedShapesPreserved -or $signalSql.productionLoaderSha256 -ne $signalTested.sourceHashes.'artifacts/api-server/src/lib/assessment-ranking-evidence.ts') { throw 'Exact loader SQL equivalence proof unavailable' }
  if ($signalTested.sourceHashes.'artifacts/api-server/src/lib/signal-matching.ts' -ne '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44') { throw 'Core matcher policy changed' }
  if ($signalTested.sourceHashes.'scripts/lib/grade-transfer-model.ts' -ne '8fb73421de22a16a38ac7befad4a62a585fa7d80af7e156dd3c0770ee0c97836') { throw 'Grade transfer model changed' }
  $signalTagged = (docker image inspect --format '{{.Id}}' signal-qa-cycle-01-app).Trim()
  if ($LASTEXITCODE -ne 0 -or $signalTagged -ne $signalTested.imageId) { throw 'Tested image tag differs' }
  $signalOriginalServices = @()
  foreach ($signalName in 'fsp-signal-db-1','fsp-signal-mail-1') {
    $signalInfo = docker inspect --format '{{json .}}' $signalName | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $signalInfo.State.Running) { throw 'Existing working DB/mail missing' }
    $signalOriginalServices += [ordered]@{ name=$signalName; id=$signalInfo.Id; image=$signalInfo.Image; startedAt=$signalInfo.State.StartedAt }
  }
  $env:QA07_PRESERVATION_PREFIX='qa-cycle-03'
  $env:LOAD_API_ORIGIN='http://127.0.0.1:4310'
  node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts before
  if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA baseline failed' }
  @'
services:
  app:
    image: signal-qa-cycle-01-app
    pull_policy: never
    command: ["node", "artifacts/api-server/dist/index.mjs"]
'@ | Set-Content outputs/verification/qa-cycle-03-preserve.compose.yaml -Encoding utf8
  docker compose -p fsp-signal -f compose.yaml -f outputs/verification/qa-cycle-03-preserve.compose.yaml --profile full up -d --no-deps --no-build app
  if ($LASTEXITCODE -ne 0) { throw 'App-only tested-image reuse failed' }
  $signalHealthy=$false
  for ($signalRetry=0;$signalRetry -lt 12;$signalRetry++) {
    try{$signalHealthy=(Invoke-RestMethod http://127.0.0.1:4310/api/healthz -TimeoutSec 3).status -eq 'ok'}catch{$signalHealthy=$false}
    if($signalHealthy){break}; Start-Sleep -Milliseconds 500
  }
  if (-not $signalHealthy) { throw 'Working app health unavailable' }
  node scripts/qa-runtime-hashes.mjs --container fsp-signal-app-1 --report outputs/verification/qa-cycle-03-working-runtime.json
  if ($LASTEXITCODE -ne 0) { throw 'Working exact runtime source attestation failed' }
  $signalWorking = Get-Content outputs/verification/qa-cycle-03-working-runtime.json -Raw | ConvertFrom-Json
  if ($signalWorking.imageId -ne $signalTested.imageId -or $signalWorking.bundleSHA -ne $signalTested.bundleSHA -or $signalWorking.frontendManifestSHA -ne $signalTested.frontendManifestSHA -or ($signalWorking.command -join '|') -ne 'node|artifacts/api-server/dist/index.mjs') { throw 'Working image/bundle/startup differs from tested runtime' }
  node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts after
  if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA rows changed' }
  foreach ($signalPrevious in $signalOriginalServices) {
    $signalCurrent = docker inspect --format '{{json .}}' $signalPrevious.name | ConvertFrom-Json
    if ($signalCurrent.Id -ne $signalPrevious.id -or $signalCurrent.State.StartedAt -ne $signalPrevious.startedAt -or $signalCurrent.Image -ne $signalPrevious.image) { throw 'Existing working DB/mail restarted or changed' }
  }
  $signalCapture = Get-Content outputs/verification/qa-cycle-02-video.json -Raw | ConvertFrom-Json
  [ordered]@{
    status='ready-for-fixed-load'; preparedAt=[DateTime]::UtcNow.ToString('o'); baseUrl='http://127.0.0.1:4310'; imageId=$signalWorking.imageId; containerId=$signalWorking.containerId
    bundleSHA=$signalWorking.bundleSHA; frontendManifestSHA=$signalWorking.frontendManifestSHA; sourceHashes=$signalWorking.sourceHashes; deployedAggregateSHA=$signalWorking.deployedAggregateSHA
    startup='node artifacts/api-server/dist/index.mjs; migration/seed bypassed'; protectedRecordsPreserved=$true; protectedProof='outputs/verification/qa-cycle-03-preserved-after.json'; preservedDbMail=$signalOriginalServices
    testedRuntimeProof='outputs/verification/qa-cycle-03-isolated-runtime.json'; rootTargetedMatchingProof='outputs/verification/qa-cycle-03-matching-http.json'; sqlEquivalenceProof='outputs/verification/qa07-readonly-perf.json'
    optimizedSourcePaths=@('artifacts/api-server/src/routes/signal-employer-matching.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts')
    equivalence='SQL coarse filters retain existing admission gates; exact saved six-entry rubric metadata, keys/count/types and unsupported historical shapes preserved; core matcher513/model8fb unchanged; no cross-request cache'
    priorCapture=[ordered]@{ proof='outputs/verification/qa-cycle-02-video.json'; image='sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'; untouched=$true; note='Existing genuine UI capture remains on recorded55a5; this backend-only read optimization does not claim a recapture' }
    freezeWindow='App code frozen; original load1000/32/180+30 authorized now. No UI/build/PDF/media jobs during measurement. Independent20 matching checks must wait until load finishes and remain required before final seal.'
    independentAcceptance='pending targeted20 after load; root isolated6/121unit/typecheck and exactSQL checks support pre-load runtime verification'
  } | ConvertTo-Json -Depth 14 | Set-Content outputs/verification/qa-cycle-03-runtime-ready.json -Encoding utf8
  Write-Output 'QA03 working tested runtime ready: app-only image reuse, exact protected QA rows and DB/mail containers preserved. Fixed load window released; independent20 after load.'
} finally {
  [Environment]::SetEnvironmentVariable('QA07_PRESERVATION_PREFIX',$signalOldPrefix,'Process')
  [Environment]::SetEnvironmentVariable('LOAD_API_ORIGIN',$signalOldOrigin,'Process')
  Pop-Location
}
