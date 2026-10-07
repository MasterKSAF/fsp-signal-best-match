param([string]$Archive = 'outputs/submission/fsp-signal-source.zip', [string]$ExpectedSha256 = '')
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this verification with PowerShell 7' }
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
function Invoke-SignalProtectedRoot([string]$Mode) {
  if ($Mode -notin @('before','after')) { throw 'Only read-only root preservation modes allowed' }
  $signalHeld = @{}
  foreach ($signalName in 'DATABASE_URL','LOAD_API_ORIGIN','QA07_PRESERVATION_PREFIX') { $signalHeld[$signalName]=[Environment]::GetEnvironmentVariable($signalName,'Process') }
  Push-Location -LiteralPath $taskRoot
  try {
    # Restore the original working URL captured before isolated settings were
    # assigned; its value is never printed or copied into the extracted source.
    $signalWorkingURL=$previousPorts['DATABASE_URL']
    if ([string]::IsNullOrWhiteSpace($signalWorkingURL)) {
      $signalPrivateText=[IO.File]::ReadAllText((Join-Path $taskRoot '.env'))
      $signalPrivateMatch=[regex]::Match($signalPrivateText,'(?m)^\s*DATABASE_URL\s*=\s*(.*?)\s*$')
      if (-not $signalPrivateMatch.Success) { throw 'Saved main environment has no database URL' }
      $signalWorkingURL=$signalPrivateMatch.Groups[1].Value.Trim()
      if ($signalWorkingURL.Length -ge 2 -and (($signalWorkingURL[0] -eq '"' -and $signalWorkingURL[-1] -eq '"') -or ($signalWorkingURL[0] -eq "'" -and $signalWorkingURL[-1] -eq "'"))) { $signalWorkingURL=$signalWorkingURL.Substring(1,$signalWorkingURL.Length-2) }
    }
    $signalWorkingUri=$null
    if ([string]::IsNullOrWhiteSpace($signalWorkingURL) -or -not [Uri]::TryCreate($signalWorkingURL,[UriKind]::Absolute,[ref]$signalWorkingUri) -or $signalWorkingUri.Scheme -ne 'postgresql' -or $signalWorkingUri.Host -notin @('127.0.0.1','localhost') -or $signalWorkingUri.Port -ne 55433 -or $signalWorkingUri.AbsolutePath -ne '/signal') { throw 'Saved main URL must be exact working loopback55433/signal' }
    [Environment]::SetEnvironmentVariable('DATABASE_URL',$signalWorkingURL,'Process')
    $env:LOAD_API_ORIGIN='http://127.0.0.1:4310'
    $env:QA07_PRESERVATION_PREFIX='qa07-clean'
    node --env-file-if-exists=.env --import tsx scripts/qa07-load-preservation.mts $Mode
    if ($LASTEXITCODE -ne 0) { throw 'Protected root ordinary accounts changed or preservation target guard failed' }
  } finally {
    Pop-Location
    foreach ($signalName in $signalHeld.Keys) { [Environment]::SetEnvironmentVariable($signalName,$signalHeld[$signalName],'Process') }
  }
}
$archivePath = if ([IO.Path]::IsPathRooted($Archive)) { $Archive } else { Join-Path $taskRoot $Archive }
$sourceZip = (Resolve-Path -LiteralPath $archivePath).Path
$sourceHash = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $sourceHash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Exact expected seal SHA-256 is required and must match the source ZIP' }
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$projectName = "signal-clean-$runId"
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'outputs/verification'))
$cleanRoot = [IO.Path]::GetFullPath((Join-Path $allowedRoot "clean-$runId"))
if (-not $cleanRoot.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated workspace' }
foreach ($portNumber in 4320,55434,8027) {
  if (Get-NetTCPConnection -LocalPort $portNumber -State Listen -ErrorAction SilentlyContinue) { throw "Port $portNumber is already in use" }
}
$archiveReader = [IO.Compression.ZipFile]::OpenRead($sourceZip)
try {
  foreach ($entry in $archiveReader.Entries) {
    $entryName = $entry.FullName.Replace('\', '/')
    $entryParts = $entryName.Split('/')
    if (-not $entryName.StartsWith('fsp-signal/') -or $entryParts -contains '..' -or
        $entryParts -contains '.git' -or $entryParts -contains 'node_modules' -or $entryParts -contains 'local-backup' -or
        ($entryParts[-1].StartsWith('.env') -and $entryParts[-1] -ne '.env.example') -or
        $entryName -match '\.(dump|sqlite|db)$') { throw "Forbidden source entry: $entryName" }
  }
} finally { $archiveReader.Dispose() }
New-Item -ItemType Directory -Path $cleanRoot | Out-Null
Expand-Archive -LiteralPath $sourceZip -DestinationPath $cleanRoot
$checkout = Join-Path $cleanRoot 'fsp-signal'
$metadata = Get-Content -Raw -LiteralPath (Join-Path $checkout 'RELEASE-METADATA.json') | ConvertFrom-Json
$manifest = @(Get-Content -Raw -LiteralPath (Join-Path $checkout 'SOURCE-MANIFEST.json') | ConvertFrom-Json)
foreach ($item in $manifest) {
  $filePath = [IO.Path]::GetFullPath((Join-Path $checkout $item.path))
  if (-not $filePath.StartsWith($checkout + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest entry escapes isolated checkout' }
  if ((Get-Item -LiteralPath $filePath).Length -ne $item.bytes -or
      (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw "Manifest mismatch: $($item.path)" }
}
$expectedVersions = @{ 'backend-python'='signal-backend-python-v6'; 'frontend-typescript'='signal-frontend-typescript-v2' }
foreach ($programId in $expectedVersions.Keys) {
  if ($metadata.programVersions.$programId -ne $expectedVersions[$programId]) { throw "Source metadata has an old bank: $programId" }
}
if ($metadata.applicationVersion -ne '0.4.1' -or $metadata.matchingAlgorithmVersion -ne 'fsp-signal-match-v5') { throw 'Source metadata has an old application/matcher' }
if (Test-Path -LiteralPath (Join-Path $checkout '.env')) { throw 'Source contains private environment' }
if (Test-Path -LiteralPath (Join-Path $checkout 'node_modules')) { throw 'Source contains installed dependencies' }
$previousPorts = @{}
foreach ($name in 'SIGNAL_HTTP_PORT','SIGNAL_DB_PORT','SIGNAL_MAIL_PORT','DATABASE_URL','POSTGRES_PASSWORD','VERIFICATION_TOKEN_SECRET','CI') { $previousPorts[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$env:SIGNAL_HTTP_PORT='4320'
$env:SIGNAL_DB_PORT='55434'
$env:SIGNAL_MAIL_PORT='8027'
$env:DATABASE_URL='postgresql://signal:signal-local@127.0.0.1:55434/signal'
$env:POSTGRES_PASSWORD='signal-local'
$env:VERIFICATION_TOKEN_SECRET=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$env:CI='1'
$checks = [Collections.Generic.List[string]]::new()
$checks.Add('Source manifest SHA-256/byte sizes, safe extraction and current release metadata')
$start = [DateTime]::UtcNow
$reportPath = Join-Path $taskRoot 'outputs/verification/clean-source-launch.json'
if (Test-Path -LiteralPath $reportPath) {
  $historical = Join-Path $allowedRoot 'history'
  New-Item -ItemType Directory -Path $historical -Force | Out-Null
  $previousHash = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0,12)
  $previousReport = Join-Path $historical "clean-source-launch-$previousHash.json"
  if (-not (Test-Path -LiteralPath $previousReport)) { Copy-Item -LiteralPath $reportPath -Destination $previousReport }
}
$cleanup = 'not_started'
$passed = $false
$failure = $null
$image = $null
$health = $null
$containerId = $null
$matchingComparison = $null
$offlineReproduction = $null
$runtimeSourceAttestation = $null
$freshDependencies = $false
$freshDatabase = $false
$protectedRootRecords = $false
$apiOrigin = 'http://127.0.0.1:4320/api'
Push-Location -LiteralPath $checkout
try {
  Invoke-SignalProtectedRoot before
  node scripts/setup-env.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Private isolated config creation failed' }
  # All offline tests run in this extracted checkout with freshly installed
  # workspace dependencies. The serving API image intentionally omits outputs;
  # pnpm test inside that image is not claimed by this source handoff check.
  python scripts/validate-qa-source-inputs.py
  if ($LASTEXITCODE -ne 0) { throw 'Source is missing exact frozen offline QA dependencies' }
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Clean workspace dependency installation failed' }
  $freshDependencies = $true
  pnpm test
  if ($LASTEXITCODE -ne 0) { throw 'Clean source complete unit suite failed' }
  $competitiveBefore = Get-Content outputs/quality/matching-competitive-v2-report.json -Raw | ConvertFrom-Json -AsHashtable
  $intergroupProof = Get-Content outputs/verification/qa01-intergroup-control.json -Raw | ConvertFrom-Json -AsHashtable
  node --import tsx scripts/evaluate.ts
  if ($LASTEXITCODE -ne 0) { throw 'Clean source legacy offline evaluation failed' }
  node --import tsx scripts/evaluate-competitive-matching.ts
  if ($LASTEXITCODE -ne 0) { throw 'Clean source competitive offline reproduction failed' }
  node --import tsx scripts/evaluate-intergroup-control.ts
  if ($LASTEXITCODE -ne 0) { throw 'Clean source intergroup offline reproduction failed' }
  node --import tsx scripts/evaluate-traceability-regression.ts
  if ($LASTEXITCODE -ne 0) { throw 'Clean source traceability offline reproduction failed' }
  $competitiveAfter = Get-Content outputs/quality/matching-competitive-v2-report.json -Raw | ConvertFrom-Json -AsHashtable
  $intergroupAfter = Get-Content outputs/quality/qa-cycle-01/intergroup-control-v1-report.json -Raw | ConvertFrom-Json -AsHashtable
  $traceabilityAfter = Get-Content outputs/quality/qa-cycle-01/traceability-regression-v1-report.json -Raw | ConvertFrom-Json -AsHashtable
  $competitiveSame = ($competitiveBefore.summary | ConvertTo-Json -Depth 50 -Compress) -eq ($competitiveAfter.summary | ConvertTo-Json -Depth 50 -Compress)
  $intergroupSame = ($intergroupProof.summary | ConvertTo-Json -Depth 50 -Compress) -eq ($intergroupAfter.summary | ConvertTo-Json -Depth 50 -Compress)
  if (-not $competitiveSame -or -not $intergroupSame) { throw 'Clean evaluation differs from archived current summary' }
  if (@($intergroupAfter.metamorphic.checks.Values | Where-Object { $_ -ne $true }).Count -or @($traceabilityAfter.checks.Values | Where-Object { $_ -ne $true }).Count) { throw 'Clean metamorphic or semantic traceability regression failed' }
  $offlineSource = '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44'
  foreach ($report in $competitiveAfter,$intergroupAfter,$traceabilityAfter) {
    if ($report.algorithmVersion -ne $metadata.matchingAlgorithmVersion -or $report.algorithmSha256 -ne $offlineSource) { throw 'Clean evaluator did not use exact accepted v5 source' }
  }
  python scripts/validate-qa-source-inputs.py --frozen-only
  if ($LASTEXITCODE -ne 0) { throw 'Offline evaluators changed frozen QA inputs' }
  $offlineReproduction = [ordered]@{ passed=$true; install='pnpm install --frozen-lockfile'; unit='pnpm test, complete archive test suite'; evaluatorCommands=@('scripts/evaluate.ts','scripts/evaluate-competitive-matching.ts','scripts/evaluate-intergroup-control.ts','scripts/evaluate-traceability-regression.ts'); competitiveSummaryEqualsArchived=$competitiveSame; intergroupSummaryEqualsArchived=$intergroupSame; traceabilityChecks=$traceabilityAfter.checks; metamorphicChecks=$intergroupAfter.metamorphic.checks; algorithmSha256=$offlineSource; frozenInputValidation='9 mandatory +2 present optional input SHA unchanged before/after'; scope='Extracted source workspace, not serving API image' }
  $checks.Add('Fresh lockfile installation, complete unit suite, legacy/competitive/intergroup/traceability offline reproduction; archived summaries match; exact frozen inputs unchanged')
  docker compose -p $projectName --profile full build --no-cache app
  if ($LASTEXITCODE -ne 0) { throw 'Source archive clean build failed' }
  docker compose -p $projectName --profile full up -d
  if ($LASTEXITCODE -ne 0) { throw 'Isolated containers failed to start' }
  $deadline = [DateTime]::UtcNow.AddSeconds(180)
  do {
    try { $health = Invoke-RestMethod "$apiOrigin/healthz"; if ($health.status -eq 'ok') { break } } catch {}
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($health.status -ne 'ok') { throw 'Clean health timeout' }
  $freshDatabase = $true
  $checks.Add('No-cache Docker build, fresh isolated database migrations/seed, HTTP health')
  $page = Invoke-WebRequest 'http://127.0.0.1:4320/'
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'Signal') { throw 'Web document not available' }
  $checks.Add('Built web asset served')
  $programs = Invoke-RestMethod "$apiOrigin/assessments/programs"
  foreach ($programId in $expectedVersions.Keys) {
    $program = @($programs | Where-Object { $_.id -eq $programId })
    if ($program.Count -ne 1 -or -not $program[0].available -or $program[0].version -ne $expectedVersions[$programId]) { throw "Active program/version missing: $programId" }
    $registry = Invoke-RestMethod "$apiOrigin/assessments/programs/$programId/competencies"
    if (($registry | ConvertTo-Json -Depth 12 -Compress) -match '"(answer|oracles|seed)"\s*:') { throw 'Public registry exposed a key' }
    $architecture = @($registry.templates | Where-Object { $_.grade -eq 'Senior' -and $_.slot -eq 4 })
    if ($architecture.Count -lt 2 -or @($architecture | Where-Object { -not $_.critical -or $_.version -ne 2 -or $_.status -ne 'active' }).Count) { throw "Current Senior architecture policy missing: $programId" }
  }
  $checks.Add('Active backend v6/frontend v2; new Senior architecture is critical, template version 2; public registry key-free')
  $demo = Invoke-RestMethod "$apiOrigin/auth/demo-session" -Method Post -ContentType 'application/json' -Body '{"role":"candidate"}' -SessionVariable candidateSession
  $profile = Invoke-RestMethod "$apiOrigin/me/candidate-profile" -WebSession $candidateSession
  if (-not $profile.userId -or $profile.userId -ne $demo.user.id -or $demo.user.role -ne 'candidate' -or -not $demo.user.demoMode) { throw 'Demo candidate seed not working' }
  $pdf = Invoke-WebRequest "$apiOrigin/me/resume/pdf" -WebSession $candidateSession
  if ($pdf.Headers.'Content-Type' -notmatch 'application/pdf' -or $pdf.RawContentLength -lt 100) { throw 'PDF binary not returned' }
  $checks.Add('Candidate Demo isolation, seeded profile and PDF binary (not a browser download event)')
  $null = Invoke-RestMethod "$apiOrigin/auth/demo-session" -Method Post -ContentType 'application/json' -Body '{"role":"employer"}' -SessionVariable employerSession
  $needs = Invoke-RestMethod "$apiOrigin/employer/needs" -WebSession $employerSession
  if (-not $needs.Count) { throw 'Seed needs missing' }
  $comparisonClock = [Diagnostics.Stopwatch]::StartNew()
  $matches = Invoke-RestMethod "$apiOrigin/matches?needId=$($needs[0].id)" -WebSession $employerSession
  if (-not $matches.Count) { throw 'Seed matching empty' }
  if (($matches | ConvertTo-Json -Depth 14 -Compress) -match '"(oracles|answer|correctAnswer|contactEmail|contactPhone|phone|email)"\s*:') { throw 'Matching list exposes keys or personal contact fields' }
  foreach ($match in $matches) {
    if (-not $match.ranking.groupId -or $match.ranking.qualityStatus -notin @('measured','not_measured')) { throw 'Invalid matching provenance group/status' }
    if (-not [double]::IsFinite([double]$match.rankingScore) -or $match.rankingScore -lt 0) { throw 'Invalid finite ranking score' }
    if ($match.ranking.qualityStatus -eq 'not_measured' -and $null -ne $match.ranking.qualityScore) { throw 'Unknown assessment quality was fabricated as a number' }
    if ($match.ranking.qualityStatus -eq 'measured' -and ($null -eq $match.ranking.qualityScore -or $match.ranking.qualityScore -lt 0 -or $match.ranking.qualityScore -gt 100 -or -not $match.ranking.attemptId -or -not $match.ranking.programVersion -or -not $match.ranking.comparisonPolicy -or -not $match.ranking.rubricKey)) { throw 'Measured assessment quality lacks linked immutable provenance' }
  }
  $explanation = Invoke-RestMethod "$apiOrigin/matches/explanation?needId=$($needs[0].id)&candidateId=$($matches[0].candidateId)" -WebSession $employerSession
  $comparisonClock.Stop()
  # V5 uses bounded age bands and canonical10-decimal common fit. The list
  # and explanation must match exactly for the same seeded provenance pool.
  $scoreTolerance = 0
  $scoreDelta = [Math]::Abs([double]$explanation.rankingScore - [double]$matches[0].rankingScore)
  $matchingComparison = [ordered]@{ elapsedMilliseconds=$comparisonClock.Elapsed.TotalMilliseconds; absoluteScoreDelta=$scoreDelta; scoreTolerance=$scoreTolerance; agePolicy='v5 fixed freshness bands'; identityAndProvenanceComparison='exact'; positionAndPoolComparison='exact prepared eligible pool' }
  if ($explanation.algorithmVersion -ne $metadata.matchingAlgorithmVersion -or
      $explanation.candidateId -ne $matches[0].candidateId -or
      $explanation.ranking.groupId -ne $matches[0].ranking.groupId -or
      $explanation.ranking.qualityStatus -ne $matches[0].ranking.qualityStatus -or
      $explanation.ranking.qualityScore -ne $matches[0].ranking.qualityScore -or
      $explanation.ranking.attemptId -ne $matches[0].ranking.attemptId -or
      $explanation.ranking.programVersion -ne $matches[0].ranking.programVersion -or
      $explanation.ranking.rubricKey -ne $matches[0].ranking.rubricKey -or
      $explanation.ranking.position -ne $matches[0].ranking.position -or
      $explanation.ranking.poolSize -ne $matches[0].ranking.poolSize -or
      -not [double]::IsFinite([double]$explanation.rankingScore) -or
      $scoreDelta -gt $scoreTolerance) { throw 'List/explanation provenance, prepared position/pool or current algorithm differs' }
  $null = Invoke-RestMethod "$apiOrigin/employer/jobs" -WebSession $employerSession
  $null = Invoke-RestMethod "$apiOrigin/employer/microtasks" -WebSession $employerSession
  $checks.Add('Employer Demo, current v5 matching metadata; unknown quality stays null; list/explanation score/provenance/position/pool agree exactly; opportunity tables readable')
  $containerId = (docker compose -p $projectName ps -q app).Trim()
  $image = (docker inspect --format '{{.Image}}' $containerId).Trim()
  $runtimeSourceAttestation = docker exec $containerId node scripts/qa-runtime-hashes.mjs --inside | ConvertFrom-Json -AsHashtable
  if ($LASTEXITCODE -ne 0) { throw 'Clean built runtime source attestation unavailable' }
  foreach ($sourcePath in $runtimeSourceAttestation.sourceHashes.Keys) {
    $record = @($manifest | Where-Object path -eq $sourcePath)
    if ($record.Count -ne 1 -or $runtimeSourceAttestation.sourceHashes[$sourcePath] -ne $record[0].sha256) { throw "Clean runtime differs from sealed source input: $sourcePath" }
  }
  if ($runtimeSourceAttestation.deployedAggregateSHA -ne $runtimeSourceAttestation.sourceHashes['artifacts/api-server/src/lib/quality-public-report.json']) { throw 'Clean served aggregate differs from sealed source' }
  $checks.Add('Built runtime explicit source inputs and deployed aggregate match exact sealed source manifest')
  if ((Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceHash) { throw 'Source ZIP changed during clean launch' }
  $passed = $true
} catch { $failure = $_.Exception.Message; throw }
finally {
  # This exact randomly named project owns only this verification run.
  docker compose -p $projectName --profile full down --volumes --remove-orphans
  $cleanup = if ($LASTEXITCODE -eq 0) { 'complete' } else { 'failed' }
  Pop-Location
  try {
    Invoke-SignalProtectedRoot after
    $protectedRootRecords = $true
  } catch { $failure = 'Protected root preservation check failed'; $passed = $false }
  [ordered]@{
    startedAt=$start.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o'); sourceSha256=$sourceHash; expectedSourceSha256=$ExpectedSha256
    applicationVersion=$metadata.applicationVersion; programVersions=$metadata.programVersions; matchingAlgorithmVersion=$metadata.matchingAlgorithmVersion
    project=$projectName; ports=@(4320,55434,8027); image=$image; containerId=$containerId
    imageCommand="docker inspect --format '{{.Image}}' $containerId"; sourceManifestRecords=$manifest.Count
    freshDependencies=$freshDependencies; freshDatabase=$freshDatabase; checks=$checks.ToArray(); passed=($passed -and $cleanup -eq 'complete')
    failure=$failure; containerCleanup=$cleanup; extractedSource=$checkout
    matchingComparison=$matchingComparison
    offlineReproduction=$offlineReproduction; runtimeSourceAttestation=$runtimeSourceAttestation
    protectedRootRecordsPreserved=$protectedRootRecords
    protectedRootPreservationProof='outputs/verification/qa07-clean-preserved-after.json'
    scope='Fresh offline reproduction and isolated rebuild of exact source ZIP; synthetic Demo seed; working Compose project/database untouched'
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8
  foreach ($name in $previousPorts.Keys) { [Environment]::SetEnvironmentVariable($name, $previousPorts[$name], 'Process') }
  if ($cleanup -ne 'complete') { throw 'Isolated Compose cleanup failed' }
  if (-not $protectedRootRecords) { throw 'Protected ordinary root records preservation failed' }
}
