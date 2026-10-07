param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$signalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signalOldPrefix = [Environment]::GetEnvironmentVariable('QA07_PRESERVATION_PREFIX','Process')
$signalOldOrigin = [Environment]::GetEnvironmentVariable('LOAD_API_ORIGIN','Process')
Push-Location -LiteralPath $signalRoot
try {
  $signalTested = Get-Content outputs/verification/qa-cycle-04-isolated-runtime.json -Raw | ConvertFrom-Json
  $signalTarget = Get-Content outputs/verification/qa-cycle-04-matching-http.json -Raw | ConvertFrom-Json
  if (-not $signalTarget.passed -or @($signalTarget.groups).Count -lt 6) { throw 'Root targeted matching HTTP proof unavailable or failed' }
  $signalSql = Get-Content outputs/verification/qa07-readonly-perf.json -Raw | ConvertFrom-Json
  if (-not $signalSql.actualSqlCapturedFromProductionLoader -or -not $signalSql.rubricHashesAndObjectKeysEquivalent -or -not $signalSql.malformedShapesPreserved -or $signalSql.productionLoaderSha256 -ne $signalTested.sourceHashes.'artifacts/api-server/src/lib/assessment-ranking-evidence.ts') { throw 'Exact loader SQL equivalence proof unavailable' }
  if ($signalTested.sourceHashes.'artifacts/api-server/src/lib/signal-matching.ts' -ne '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44') { throw 'Core matcher policy changed' }
  if ($signalTested.sourceHashes.'scripts/lib/grade-transfer-model.ts' -ne '8fb73421de22a16a38ac7befad4a62a585fa7d80af7e156dd3c0770ee0c97836') { throw 'Grade transfer model changed' }
  if ($signalTested.sourceHashes.'artifacts/api-server/src/lib/matching-pool-admission.ts' -notmatch '^[a-f0-9]{64}$' -or @($signalTested.sourceHashes.PSObject.Properties).Count -ne 22) { throw 'Exact22-source runtime including admission helper required' }
  $signalHistoryPath='outputs/verification/history/qa07-before-qa04-history.json'
  $signalHistory = Get-Content $signalHistoryPath -Raw | ConvertFrom-Json
  if (-not $signalHistory.passed -or @($signalHistory.files).Count -lt 19) { throw 'Previous d814 evidence preservation incomplete' }
  foreach ($signalFile in $signalHistory.files) {
    if ($signalFile.history -notmatch '^outputs/verification/history/qa07-before-qa04-[A-Za-z0-9.-]+\.(json|yaml)$' -or (Get-FileHash -LiteralPath $signalFile.history -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalFile.sha256) { throw 'Previous exact evidence snapshot changed' }
  }
  $signalTagged = (docker image inspect --format '{{.Id}}' signal-qa-cycle-01-app).Trim()
  if ($LASTEXITCODE -ne 0 -or $signalTagged -ne $signalTested.imageId) { throw 'Tested image tag differs' }
  $signalOriginalServices = @()
  foreach ($signalName in 'fsp-signal-db-1','fsp-signal-mail-1') {
    $signalInfo = docker inspect --format '{{json .}}' $signalName | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $signalInfo.State.Running) { throw 'Existing working DB/mail missing' }
    $signalOriginalServices += [ordered]@{ name=$signalName; id=$signalInfo.Id; image=$signalInfo.Image; startedAt=$signalInfo.State.StartedAt }
  }
  if ($CheckOnly) { Write-Output 'QA04 exact tested-image, fixed core/model, loader equivalence and d814 history preflight PASS; no app/database mutation'; return }
  $env:QA07_PRESERVATION_PREFIX='qa-cycle-04'
  $env:LOAD_API_ORIGIN='http://127.0.0.1:4310'
  node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts before
  if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA baseline failed' }
  @'
services:
  app:
    image: signal-qa-cycle-01-app
    pull_policy: never
    command: ["node", "artifacts/api-server/dist/index.mjs"]
'@ | Set-Content outputs/verification/qa-cycle-04-preserve.compose.yaml -Encoding utf8
  docker compose -p fsp-signal -f compose.yaml -f outputs/verification/qa-cycle-04-preserve.compose.yaml --profile full up -d --no-deps --no-build app
  if ($LASTEXITCODE -ne 0) { throw 'App-only tested-image reuse failed' }
  $signalHealthy=$false
  for ($signalRetry=0;$signalRetry -lt 12;$signalRetry++) {
    try{$signalHealthy=(Invoke-RestMethod http://127.0.0.1:4310/api/healthz -TimeoutSec 3).status -eq 'ok'}catch{$signalHealthy=$false}
    if($signalHealthy){break}; Start-Sleep -Milliseconds 500
  }
  if (-not $signalHealthy) { throw 'Working app health unavailable' }
  node scripts/qa-runtime-hashes.mjs --container fsp-signal-app-1 --report outputs/verification/qa-cycle-04-working-runtime.json
  if ($LASTEXITCODE -ne 0) { throw 'Working exact22-source runtime attestation failed' }
  $signalWorking = Get-Content outputs/verification/qa-cycle-04-working-runtime.json -Raw | ConvertFrom-Json
  if ($signalWorking.imageId -ne $signalTested.imageId -or $signalWorking.bundleSHA -ne $signalTested.bundleSHA -or $signalWorking.frontendManifestSHA -ne $signalTested.frontendManifestSHA -or ($signalWorking.command -join '|') -ne 'node|artifacts/api-server/dist/index.mjs') { throw 'Working image/bundle/startup differs from tested runtime' }
  node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts after
  if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA rows changed' }
  foreach ($signalPrevious in $signalOriginalServices) {
    $signalCurrent = docker inspect --format '{{json .}}' $signalPrevious.name | ConvertFrom-Json
    if ($signalCurrent.Id -ne $signalPrevious.id -or $signalCurrent.State.StartedAt -ne $signalPrevious.startedAt -or $signalCurrent.Image -ne $signalPrevious.image) { throw 'Existing working DB/mail restarted or changed' }
  }
  [ordered]@{
    status='ready-for-fixed-load'; preparedAt=[DateTime]::UtcNow.ToString('o'); baseUrl='http://127.0.0.1:4310'; imageId=$signalWorking.imageId; containerId=$signalWorking.containerId
    bundleSHA=$signalWorking.bundleSHA; frontendManifestSHA=$signalWorking.frontendManifestSHA; sourceHashes=$signalWorking.sourceHashes; deployedAggregateSHA=$signalWorking.deployedAggregateSHA
    startup='node artifacts/api-server/dist/index.mjs; migration/seed bypassed'; protectedRecordsPreserved=$true; protectedProof='outputs/verification/qa-cycle-04-preserved-after.json'; preservedDbMail=$signalOriginalServices
    testedRuntimeProof='outputs/verification/qa-cycle-04-isolated-runtime.json'; rootTargetedMatchingProof='outputs/verification/qa-cycle-04-matching-http.json'; sqlEquivalenceProof='outputs/verification/qa07-readonly-perf.json'
    previousRuntimeAndFailureHistory=$signalHistoryPath
    optimizedSourcePaths=@('artifacts/api-server/src/routes/signal-employer-matching.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts','artifacts/api-server/src/lib/skill-catalog.ts','artifacts/api-server/src/lib/matching-pool-admission.ts')
    equivalence='Coarse SQL gates and exact rubric projection retained. Admission helper replaces only redundant preliminary full evaluation, with core fallback for provided proof; final enriched core evaluation unchanged. Bounded512 normalization-string memo returns exact NFKC/en-US transform and fresh resolved objects; no profile, consent, attempt, proof or ranking cache. Core513/model8fb unchanged.'
    priorCapture=[ordered]@{ proof='outputs/verification/qa-cycle-02-video.json'; image='sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'; untouched=$true; note='Genuine UI capture retains recorded55a5 provenance; backend optimization does not claim a recapture' }
    freezeWindow='App code frozen; original load1000/32/180+30 runs only in released exclusive window. No UI/build/PDF/media jobs during measurement. Independent matching checks wait until load finishes and remain required before final seal.'
    independentAcceptance='Required after load before final seal; root exact isolated HTTP and unit/typecheck results support pre-load verification'
  } | ConvertTo-Json -Depth 14 | Set-Content outputs/verification/qa-cycle-04-runtime-ready.json -Encoding utf8
  Write-Output 'QA04 working tested runtime ready: app-only reuse, exact protected QA rows and DB/mail containers preserved. Fixed load window requires root release; independent targeted checks after load.'
} finally {
  [Environment]::SetEnvironmentVariable('QA07_PRESERVATION_PREFIX',$signalOldPrefix,'Process')
  [Environment]::SetEnvironmentVariable('LOAD_API_ORIGIN',$signalOldOrigin,'Process')
  Pop-Location
}
