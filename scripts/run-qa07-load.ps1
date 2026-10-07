param([switch]$CheckOnly, [switch]$VideoCaptureReleased, [switch]$ProfileWarmup, [string]$RuntimeReadyProof='outputs/verification/qa-cycle-01-runtime-ready.json')
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
if (-not $CheckOnly -and -not $VideoCaptureReleased) { throw 'Wait for root: video capture released; then pass -VideoCaptureReleased' }
$signalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signalMatcher = '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44'
$signalLoadScript = '0f11b65156b1bbec4cbc52f09c2f75266a801964820a05d36ad75ea8e1ae1b34'
$signalOldOrigin = [Environment]::GetEnvironmentVariable('LOAD_API_ORIGIN','Process')
$signalOldRelease = [Environment]::GetEnvironmentVariable('QA07_VIDEO_CAPTURE_RELEASED','Process')
$signalOldPrefix = [Environment]::GetEnvironmentVariable('QA07_PRESERVATION_PREFIX','Process')
$signalHistory = Join-Path $signalRoot 'outputs/verification/history'
$signalLockPath = Join-Path $signalRoot 'outputs/local-backup/qa07-load-exclusive.lock'
$signalLock = $null
Push-Location -LiteralPath $signalRoot
try {
  if ($RuntimeReadyProof -notin @('outputs/verification/qa-cycle-01-runtime-ready.json','outputs/verification/qa-cycle-03-runtime-ready.json','outputs/verification/qa-cycle-04-runtime-ready.json')) { throw 'Explicit known independently tested runtime-ready proof required' }
  $signalReady = Get-Content -LiteralPath $RuntimeReadyProof -Raw | ConvertFrom-Json
  if ($signalReady.status -notin @('ready','ready-for-fixed-load')) { throw 'Runtime-ready handoff is not ready' }
  if ($signalReady.testedRuntimeProof -notin @('outputs/verification/qa-cycle-01-isolated-runtime.json','outputs/verification/qa-cycle-03-isolated-runtime.json','outputs/verification/qa-cycle-04-isolated-runtime.json')) { throw 'Exact isolated tested-runtime proof required' }
  $signalTested = Get-Content -LiteralPath $signalReady.testedRuntimeProof -Raw | ConvertFrom-Json
  $signalImage=$signalReady.imageId; $signalBundle=$signalReady.bundleSHA
  if ($signalImage -notmatch '^sha256:[a-f0-9]{64}$' -or $signalBundle -notmatch '^[a-f0-9]{64}$' -or $signalImage -ne $signalTested.imageId -or $signalBundle -ne $signalTested.bundleSHA) { throw 'Ready image/bundle differs from isolated tested runtime' }
  if ($RuntimeReadyProof -in @('outputs/verification/qa-cycle-03-runtime-ready.json','outputs/verification/qa-cycle-04-runtime-ready.json')) {
    $signalCycle = $(if($RuntimeReadyProof -eq 'outputs/verification/qa-cycle-04-runtime-ready.json'){'04'}else{'03'})
    if ($signalReady.testedRuntimeProof -ne "outputs/verification/qa-cycle-$signalCycle-isolated-runtime.json" -or $signalReady.rootTargetedMatchingProof -ne "outputs/verification/qa-cycle-$signalCycle-matching-http.json") { throw 'Runtime cycle proof pairing differs' }
    $signalTarget = Get-Content -LiteralPath $signalReady.rootTargetedMatchingProof -Raw | ConvertFrom-Json
    $signalSql = Get-Content outputs/verification/qa07-readonly-perf.json -Raw | ConvertFrom-Json
    if (-not $signalTarget.passed -or -not $signalReady.protectedRecordsPreserved -or -not $signalSql.actualSqlCapturedFromProductionLoader -or -not $signalSql.rubricHashesAndObjectKeysEquivalent -or -not $signalSql.malformedShapesPreserved -or $signalSql.productionLoaderSha256 -ne $signalTested.sourceHashes.'artifacts/api-server/src/lib/assessment-ranking-evidence.ts') { throw 'Root isolated matching/SQL/preservation proof failed' }
  }
  $env:LOAD_API_ORIGIN = 'http://127.0.0.1:4310'
  $env:QA07_PRESERVATION_PREFIX='qa07-load'
  node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts --guard
  if ($LASTEXITCODE -ne 0) { throw 'Exact working database target guard failed' }
  node --import tsx scripts/qa07-load-preservation.mts --guard-self-test
  if ($LASTEXITCODE -ne 0) { throw 'Operation guard self-test failed' }
  if ((Get-FileHash scripts/load-scale.ts -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalLoadScript) { throw 'Frozen load profile/script changed' }
  if ((Get-FileHash artifacts/api-server/src/lib/signal-matching.ts -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalMatcher) { throw 'Frozen accepted matcher changed' }
  $signalInfo = docker inspect --format '{{json .}}' fsp-signal-app-1 | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $signalInfo.State.Running -or $signalInfo.Image -ne $signalImage -or $signalInfo.Id -ne $signalReady.containerId) { throw 'Working app is not exact accepted runtime-ready image/container' }
  if (($signalInfo.Config.Cmd -join '|') -ne 'node|artifacts/api-server/dist/index.mjs') { throw 'Working app startup could rerun migration/seed' }
  $signalPorts = @($signalInfo.NetworkSettings.Ports.'4310/tcp')
  if (-not ($signalPorts | Where-Object { $_.HostPort -eq '4310' -and $_.HostIp -eq '127.0.0.1' })) { throw 'Working app must be published on loopback4310' }
  $signalBuiltBundle = (docker exec fsp-signal-app-1 sha256sum /app/artifacts/api-server/dist/index.mjs).Split(' ')[0]
  if ($LASTEXITCODE -ne 0 -or $signalBuiltBundle -ne $signalBundle) { throw 'Working bundle differs from independently tested runtime' }
  node --env-file-if-exists=.env --import tsx scripts/load-scale.ts --fixture-check
  if ($LASTEXITCODE -ne 0) { throw 'Unchanged1000-record fixture generator preflight failed' }
  if ($CheckOnly) {
    Write-Output 'QA07 operation preflight PASS; no HTTP/database load, no fixtures created. Await video capture release.'
    return
  }
  New-Item -ItemType Directory -Path $signalHistory -Force | Out-Null
  $signalOldProofs = [Collections.Generic.List[object]]::new()
  $signalCurrentLoad = Get-Content outputs/verification/load-scale.json -Raw | ConvertFrom-Json
  if ($signalCurrentLoad.preflightPath -notmatch '^outputs/verification/load-scale-preflight-[a-f0-9]{8}\.json$') { throw 'Current load preflight path is invalid' }
  $signalCurrentUnique = $signalCurrentLoad.preflightPath.Replace('load-scale-preflight-','load-scale-')
  $signalPreservationFiles=@('outputs/verification/load-scale.json','outputs/verification/load-scale-aaa5462f.json','outputs/verification/load-scale-preflight-aaa5462f.json',$signalCurrentUnique,$signalCurrentLoad.preflightPath,'outputs/verification/qa07-load.json','outputs/verification/qa07-load-preserved-before.json','outputs/verification/qa07-load-preserved-after.json','outputs/verification/qa07-load-runtime-before.json','outputs/verification/qa07-load-runtime-after.json') | Select-Object -Unique
  foreach ($signalCpuProof in @('outputs/verification/qa07-cpu-warmup.json','outputs/verification/qa07-cpu-hotspots.json','outputs/verification/qa07-inspector-cleanup.json')) {
    if (Test-Path -LiteralPath $signalCpuProof) { $signalPreservationFiles += $signalCpuProof }
  }
  foreach ($signalFile in $signalPreservationFiles) {
    if (-not (Test-Path -LiteralPath $signalFile)) { throw "Original load proof missing: $signalFile" }
    $signalSha = (Get-FileHash -LiteralPath $signalFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $signalName = "qa07-before-rerun-" + [IO.Path]::GetFileNameWithoutExtension($signalFile) + "-$($signalSha.Substring(0,12)).json"
    $signalDestination = Join-Path $signalHistory $signalName
    if (-not (Test-Path -LiteralPath $signalDestination)) { Copy-Item -LiteralPath $signalFile -Destination $signalDestination }
    if ((Get-FileHash -LiteralPath $signalDestination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalSha) { throw 'Old load proof preservation failed' }
    $signalOldProofs.Add([ordered]@{ original=$signalFile; history="outputs/verification/history/$signalName"; sha256=$signalSha })
  }
  $signalLock = [IO.File]::Open($signalLockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $env:QA07_VIDEO_CAPTURE_RELEASED = '1'
  $signalPriorFixturePaths = @(Get-ChildItem outputs/local-backup -Filter 'load-scale-fixtures-*.json' -File | ForEach-Object FullName)
  $signalStarted = [DateTime]::UtcNow
  $signalFailure = $null
  $signalFallback = $null
  $signalLoadExit = $null
  try {
    node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts before
    if ($LASTEXITCODE -ne 0) { throw 'Protected ordinary QA baseline missing' }
    node scripts/qa-runtime-hashes.mjs --container fsp-signal-app-1 --report outputs/verification/qa07-load-runtime-before.json
    if ($LASTEXITCODE -ne 0) { throw 'Full frozen runtime source attestation failed' }
    if ($ProfileWarmup) {
      $signalDiagnosticId=[guid]::NewGuid().ToString('N').Substring(0,8)
      $signalKnownPreflights=@(Get-ChildItem outputs/verification -Filter 'load-scale-preflight-*.json' -File | ForEach-Object FullName)
      $signalStdout="outputs/local-backup/qa07-diagnostic-$signalDiagnosticId.stdout.txt"; $signalStderr="outputs/local-backup/qa07-diagnostic-$signalDiagnosticId.stderr.txt"
      $signalLoadProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--env-file-if-exists=.env','--import','tsx','scripts/load-scale.ts') -WorkingDirectory $signalRoot -WindowStyle Hidden -RedirectStandardOutput $signalStdout -RedirectStandardError $signalStderr -PassThru
      $signalDeadline=[DateTime]::UtcNow.AddSeconds(90)
      do {
        $signalFreshPreflights=@(Get-ChildItem outputs/verification -Filter 'load-scale-preflight-*.json' -File | Where-Object { $_.FullName -notin $signalKnownPreflights })
        if($signalFreshPreflights.Count){break}; if($signalLoadProcess.HasExited){throw 'Diagnostic load exited before preflight'}; Start-Sleep -Milliseconds 200
      } while([DateTime]::UtcNow -lt $signalDeadline)
      if($signalFreshPreflights.Count -ne 1){throw 'Exact single new diagnostic preflight unavailable'}
      $signalDiagnosticPreflight="outputs/verification/$($signalFreshPreflights[0].Name)"
      docker kill --signal=USR1 fsp-signal-app-1 | Out-Null
      if($LASTEXITCODE -ne 0){throw 'Cannot start loopback-only PID1 inspector'}
      Start-Sleep -Milliseconds 250
      $signalProfilerSource=Get-Content scripts/profile-qa07-warmup.cjs -Raw
      $signalControl=docker exec fsp-signal-app-1 node -e $signalProfilerSource -- $signalDiagnosticId | ConvertFrom-Json
      if($LASTEXITCODE -ne 0 -or -not $signalControl.passed){throw 'Warmup CPU profiling failed'}
      $signalControlPath="outputs/local-backup/qa07-cpu-$signalDiagnosticId-control.json"
      $signalControl | ConvertTo-Json -Depth 8 | Set-Content $signalControlPath -Encoding utf8
      $signalRawProfile="outputs/local-backup/qa07-cpu-$signalDiagnosticId.cpuprofile"
      docker cp "fsp-signal-app-1:$($signalControl.profilePath)" $signalRawProfile
      if($LASTEXITCODE -ne 0){throw 'Private CPU profile copy failed'}
      node scripts/summarize-qa07-cpu.mjs $signalRawProfile $signalControlPath $signalDiagnosticPreflight
      if($LASTEXITCODE -ne 0){throw 'Warmup-only timing/safe CPU summary failed'}
      $signalLoadProcess.WaitForExit();$signalLoadExit=$signalLoadProcess.ExitCode
      Get-Content -LiteralPath $signalStdout
    } else {
      node --env-file-if-exists=.env --import tsx scripts/load-scale.ts
      $signalLoadExit = $LASTEXITCODE
    }
    if ($signalLoadExit -ne 0) { throw "Original fixed-profile load failed with code $signalLoadExit" }
  } catch { $signalFailure = $_.Exception.Message }
  finally {
    # A diagnostic-controller failure must never clean records underneath an
    # original load process that is still running its authorized fixed profile.
    if ($signalLoadProcess -and -not $signalLoadProcess.HasExited) { $signalLoadProcess.WaitForExit() }
    $signalNewFixturePaths = @(Get-ChildItem outputs/local-backup -Filter 'load-scale-fixtures-*.json' -File | Where-Object { $_.FullName -notin $signalPriorFixturePaths } | ForEach-Object FullName)
    if ($signalNewFixturePaths.Count -eq 1) {
      $signalFallback = node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts cleanup $signalNewFixturePaths[0] | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0) { $signalFailure = 'Exact run-owned cleanup check failed' }
    } elseif ($signalNewFixturePaths.Count -gt 1) { $signalFailure = 'More than one new load fixture file; automatic cleanup refused' }
    node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts after
    if ($LASTEXITCODE -ne 0) { $signalFailure = 'Protected ordinary QA records changed or preservation check failed' }
    node scripts/qa-runtime-hashes.mjs --container fsp-signal-app-1 --report outputs/verification/qa07-load-runtime-after.json
    if ($LASTEXITCODE -ne 0) { $signalFailure = 'Frozen runtime changed during load' }
    $signalReport = Get-Content outputs/verification/load-scale.json -Raw | ConvertFrom-Json
    $signalPreserved = Get-Content outputs/verification/qa07-load-preserved-after.json -Raw | ConvertFrom-Json
    $signalAfter = Get-Content outputs/verification/qa07-load-runtime-after.json -Raw | ConvertFrom-Json
    $signalPassed = -not $signalFailure -and $signalReport.passed -and $signalReport.cleanup -eq 'complete' -and $signalReport.createdSyntheticUsers -eq 1016 -and $signalReport.remainingSyntheticUsers -eq 0 -and $signalPreserved.preserved -and $signalReport.imageId -eq $signalImage -and $signalAfter.imageId -eq $signalImage -and $signalAfter.bundleSHA -eq $signalBundle -and $signalFallback.passed
    [ordered]@{
      version='signal-qa07-load-v1'; startedAt=$signalStarted.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o'); passed=[bool]$signalPassed; failure=$signalFailure
      status=$(if($signalPassed){'measured-pass'}else{'measured-failure-retained'}); apiOrigin=$env:LOAD_API_ORIGIN; database='working loopback55433/signal, secret URL omitted'
      imageId=$signalImage; bundleSha256=$signalBundle; matcherSha256=$signalMatcher; originalLoadScriptSha256=$signalLoadScript
      runtimeReadyProof=$RuntimeReadyProof; isolatedTestedRuntimeProof=$signalReady.testedRuntimeProof; independentMatchingAcceptance='Required after load and before final seal; not concurrent with load window'
      diagnosticWarmupCpuProfile=[bool]$ProfileWarmup; cpuProfileProof=$(if($ProfileWarmup){'outputs/verification/qa07-cpu-warmup.json'}else{$null})
      profileAndLimits='Original1000/32sessions/16employers/30s warmup/180s measurement and all original limits unchanged'
      loadReport='outputs/verification/load-scale.json'; loadReportSha256=(Get-FileHash outputs/verification/load-scale.json -Algorithm SHA256).Hash.ToLowerInvariant(); originalProofs=$signalOldProofs.ToArray()
      protectedOrdinaryRecordsPreserved=$signalPreserved.preserved; protectedProof='outputs/verification/qa07-load-preserved-after.json'; exactOwnCleanup=$signalFallback
      runtimeBefore='outputs/verification/qa07-load-runtime-before.json'; runtimeAfter='outputs/verification/qa07-load-runtime-after.json'; noResetSeed=$true; sourceOrBundleModified=$false
      scope='Local synthetic fixed-profile runtime regression; no claim of production capacity or human validity'
    } | ConvertTo-Json -Depth 12 | Set-Content outputs/verification/qa07-load.json -Encoding utf8
  }
  if (-not $signalPassed) { throw 'QA07 load regression did not pass; failure retained in qa07-load.json' }
} finally {
  if ($signalLock) { $signalLock.Dispose(); Remove-Item -LiteralPath $signalLockPath }
  [Environment]::SetEnvironmentVariable('LOAD_API_ORIGIN',$signalOldOrigin,'Process')
  [Environment]::SetEnvironmentVariable('QA07_VIDEO_CAPTURE_RELEASED',$signalOldRelease,'Process')
  [Environment]::SetEnvironmentVariable('QA07_PRESERVATION_PREFIX',$signalOldPrefix,'Process')
  Pop-Location
}
