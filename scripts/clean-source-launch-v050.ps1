param(
  [string]$Archive = 'outputs/release-0.5.0/fsp-signal-source-0.5.0.zip',
  [string]$ExpectedSha256 = '',
  [switch]$FreezeReleased
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
if (-not $FreezeReleased) { throw 'Preparation only: explicit release freeze is required before install/build/launch' }
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'outputs/release-0.5.0'))
function Get-SignalSha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-SignalChild([string]$Path,[string]$Parent) {
  $absolute=[IO.Path]::GetFullPath($Path); $base=[IO.Path]::GetFullPath($Parent)
  if (-not $absolute.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Isolated path escapes its exact workspace' }
  return $absolute
}
function Get-SignalProtectedRuntime {
  # Read-only identity witnesses. No old audit account IDs or private main URLs.
  $listeners=@(foreach($port in 4310,4313,4314,4315) {
    foreach($binding in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalAddress,OwningProcess)) {
      $process=Get-Process -Id $binding.OwningProcess -ErrorAction Stop
      [ordered]@{port=$port;address=$binding.LocalAddress;pid=$binding.OwningProcess;startedAt=$process.StartTime.ToUniversalTime().ToString('o')}
    }
  })
  $ids=@(docker ps -q)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Docker protected runtime inventory' }
  $containers=@(foreach($id in $ids) {
    if (-not $id) { continue }
    $item=docker inspect --format '{{json .}}' $id | ConvertFrom-Json
    [ordered]@{id=$item.Id;image=$item.Image;startedAt=$item.State.StartedAt;running=$item.State.Running}
  })
  [ordered]@{listeners=$listeners;containers=@($containers | Sort-Object id)}
}
function Invoke-SignalChecked([string]$Program,[string[]]$Arguments,[string]$Failure) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}
function Read-SignalOwnedApp([string]$Id,[string]$Project,[string]$ExpectedStartedAt='') {
  if([string]::IsNullOrWhiteSpace($Id)){throw 'Clean application container identity missing'}
  $item=docker inspect --format '{{json .}}' $Id | ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $item.Id -ne $Id -or -not $item.State.Running -or $item.Config.Labels.'com.docker.compose.project' -ne $Project -or $item.Config.Labels.'com.docker.compose.service' -ne 'app'){throw 'Clean HTTP target is not the running owned application'}
  $bindings=@($item.NetworkSettings.Ports.'4310/tcp')
  if($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1' -or $bindings[0].HostPort -ne '4330'){throw 'Clean application loopback HTTP binding mismatch'}
  if($ExpectedStartedAt -and ([DateTimeOffset]$item.State.StartedAt).UtcDateTime.ToString('o') -ne ([DateTimeOffset]$ExpectedStartedAt).UtcDateTime.ToString('o')){throw 'Clean application restarted during the verified run'}
  return $item
}
function Get-SignalCanonical($Value) { ConvertTo-Json -InputObject $Value -Depth 70 -Compress }
function Get-SignalUnittestCount([string]$Output) {
  $signalCountMatches=[regex]::Matches($Output,'(?m)^Ran\s+(?<count>\d+)\s+tests?\s+in\s+[^\r\n]+\r?$')
  if($signalCountMatches.Count -ne 1 -or $Output -notmatch '(?m)^OK\s*$' -or $Output -match '(?m)^FAILED\b' -or [int]$signalCountMatches[0].Groups['count'].Value -lt 1){throw 'Cannot derive a successful actual Python unittest count'}
  return [int]$signalCountMatches[0].Groups['count'].Value
}
function Get-SignalRuntimePaths([Collections.IDictionary]$ManifestByPath,[Collections.IDictionary]$AcceptedHashes) {
  if(-not $AcceptedHashes.Count){throw 'Accepted runtime source attestation must be nonempty'}
  foreach($signalPath in $AcceptedHashes.Keys) {
    if(-not $ManifestByPath.Contains($signalPath) -or $ManifestByPath[$signalPath].sha256 -ne $AcceptedHashes[$signalPath]){throw 'Every accepted runtime source must match the sealed manifest'}
  }
  return @(@($ManifestByPath.Keys|Where-Object {$_ -eq 'package.json' -or $_ -eq 'pnpm-lock.yaml' -or $_ -eq 'lib/api-spec/openapi.yaml' -or $_.StartsWith('artifacts/api-server/src/') -or $_.StartsWith('lib/db/src/') -or $_.StartsWith('lib/db/migrations/') -or $_.StartsWith('artifacts/fsp-signal/src/')})+@($AcceptedHashes.Keys)|Sort-Object -Unique)
}
function Refresh-SignalDockerContext([string]$Checkout,[Collections.IDictionary]$ManifestByPath,[DateTime]$Timestamp=[DateTime]::UtcNow) {
  if($Timestamp.Kind -ne [DateTimeKind]::Utc){throw 'Docker context timestamp must be an explicit UTC instant'}
  $signalContextPaths=@($ManifestByPath.Keys|Where-Object {-not $_.StartsWith('outputs/')}|Sort-Object)
  if(-not $signalContextPaths.Count){throw 'Sealed Docker context must be nonempty'}
  # Docker Desktop's context transport reused same-size files with a fixed ZIP
  # mtime despite --no-cache. Refresh only extracted file metadata, never bytes.
  $signalResolved=@(foreach($signalRelative in $signalContextPaths) {
    if($signalRelative.Contains('\') -or $signalRelative.Contains(':') -or [IO.Path]::IsPathRooted($signalRelative) -or @($signalRelative.Split('/')|Where-Object {$_ -in '.', '..',''}).Count){throw 'Unsafe sealed Docker context path'}
    $signalFile=Assert-SignalChild (Join-Path $Checkout $signalRelative) $Checkout
    $signalInfo=Get-Item -LiteralPath $signalFile -ErrorAction Stop
    if($signalInfo.PSIsContainer -or ($signalInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-SignalSha $signalFile) -ne $ManifestByPath[$signalRelative].sha256){throw 'Extracted Docker context differs from sealed bytes before metadata refresh'}
    [ordered]@{path=$signalFile;sha256=$ManifestByPath[$signalRelative].sha256}
  })
  foreach($signalFile in $signalResolved){[IO.File]::SetLastWriteTimeUtc($signalFile.path,$Timestamp)}
  foreach($signalFile in $signalResolved){if((Get-SignalSha $signalFile.path) -ne $signalFile.sha256){throw 'Metadata refresh altered sealed Docker context bytes'}}
  return [ordered]@{files=$signalResolved.Count;lastWriteTimeUtc=$Timestamp.ToString('o');byteHashesVerifiedBeforeAndAfter=$true;scope='Timestamp-only refresh of owned extracted sealed files; outputs are excluded. Source ZIP and file contents remain unchanged.'}
}
function Get-SignalHostRuntimeVersions([string]$ConfiguredPackageManager) {
  if($ConfiguredPackageManager -notmatch '^pnpm@(?<version>\d+\.\d+\.\d+)$'){throw 'Configured package manager is not an explicit pnpm version'}
  $configuredVersion=$Matches.version
  $versions=[ordered]@{}
  foreach($program in 'node','pnpm','python') {
    $output=@(& $program --version);$exit=$LASTEXITCODE;$value=($output -join "`n").Trim()
    $pattern=switch($program){'node'{'^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$'}'pnpm'{'^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$'}'python'{'^Python \d+\.\d+\.\d+(?:[A-Za-z0-9.+-]+)?$'}}
    if($exit -ne 0 -or $value -notmatch $pattern){throw 'Cannot record an actual host tool version'}
    $versions[$program]=$value
  }
  $versions.powershell=$PSVersionTable.PSVersion.ToString()
  $versions.pnpmMatchesConfigured=($versions.pnpm -eq $configuredVersion)
  return $versions
}
function Get-SignalDockerPnpmTarget([string]$Dockerfile,[string]$ConfiguredPackageManager) {
  if($ConfiguredPackageManager -notmatch '^pnpm@(?<version>\d+\.\d+\.\d+)$'){throw 'Configured package manager is not an explicit pnpm version'}
  $configuredVersion=$Matches.version
  $pins=[regex]::Matches($Dockerfile,'(?m)^\s*RUN\s+[^\r\n]*\bcorepack\s+prepare\s+pnpm@(?<version>\d+\.\d+\.\d+)\s+--activate(?:\s|$)')
  if($pins.Count -ne 1 -or $pins[0].Groups['version'].Value -ne $configuredVersion){throw 'Sealed Docker pnpm target differs from configured package manager'}
  return [ordered]@{pnpm=$pins[0].Groups['version'].Value;matchesConfigured=$true;source='Exact sealed Dockerfile; actual container version is recorded separately'}
}

$archivePath=if([IO.Path]::IsPathRooted($Archive)){$Archive}else{Join-Path $taskRoot $Archive}
$sourceZip=(Resolve-Path -LiteralPath $archivePath).Path
Assert-SignalChild $sourceZip $releaseRoot | Out-Null
$sourceHash=Get-SignalSha $sourceZip
if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $sourceHash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Exact new source seal SHA-256 required' }
$privacyPath=Join-Path $releaseRoot 'source-privacy-audit.json'
$privacy=Get-Content -LiteralPath $privacyPath -Raw | ConvertFrom-Json
if (-not $privacy.passed -or $privacy.applicationVersion -ne '0.5.0' -or $privacy.sourceSha256 -ne $sourceHash -or -not $privacy.sealedArchiveUnchanged) { throw 'Exact versioned source privacy PASS is required before clean extraction' }
# Ports are checked again at actual run time; the preparation check reserves none.
foreach($port in 4330,55439,8033) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Clean port $port occupied; never stop a foreign listener" }
}
$runId=[guid]::NewGuid().ToString('N').Substring(0,8)
$projectName="signal-clean-v050-$runId"
$databaseName="signal_clean_v050_$runId"
$cleanRoot=Assert-SignalChild (Join-Path $releaseRoot "clean-$runId") $releaseRoot
$existing=@(docker ps -aq --filter "label=com.docker.compose.project=$projectName")
if ($LASTEXITCODE -ne 0 -or @($existing | Where-Object {$_}).Count) { throw 'Random isolated Compose project already exists; refusing reuse' }
$protectedBefore=Get-SignalProtectedRuntime
$archiveReader=[IO.Compression.ZipFile]::OpenRead($sourceZip)
try {
  $entryNames=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$expandedSize=0
  foreach($entry in $archiveReader.Entries) {
    $name=$entry.FullName; $parts=$name.Split('/')
    if (-not $name.StartsWith('fsp-signal/') -or $name.Contains('\') -or $name.Contains(':') -or $parts -contains '..' -or $parts -contains '.git' -or $parts -contains 'node_modules' -or $parts -contains 'local-backup' -or $parts -contains '.load-runtime' -or $parts -contains 'private' -or ($parts[-1].StartsWith('.env') -and $parts[-1] -ne '.env.example') -or $name -match '\.(dump|sqlite|db|pem|key|cookie|log|zip)$' -or -not $entryNames.Add($name)) { throw 'Unsafe/duplicate source archive entry' }
    $expandedSize+=$entry.Length
    if ($entry.Length -gt 64MB -or $expandedSize -gt 256MB) { throw 'Source archive expanded size exceeds bounded input' }
  }
} finally { $archiveReader.Dispose() }
New-Item -ItemType Directory -Path $cleanRoot | Out-Null
Expand-Archive -LiteralPath $sourceZip -DestinationPath $cleanRoot
$checkout=Join-Path $cleanRoot 'fsp-signal'
$metadata=Get-Content -LiteralPath (Join-Path $checkout 'RELEASE-METADATA.json') -Raw | ConvertFrom-Json -AsHashtable
$manifest=@(Get-Content -LiteralPath (Join-Path $checkout 'SOURCE-MANIFEST.json') -Raw | ConvertFrom-Json -AsHashtable)
if ($metadata.applicationVersion -ne '0.5.0' -or $metadata.acceptedRuntime.applicationVersion -ne '0.5.0' -or $metadata.matchingAlgorithmSha256 -notmatch '^[a-f0-9]{64}$' -or $metadata.acceptedRuntime.bundleSHA -notmatch '^[a-f0-9]{64}$') { throw 'Exact frozen new application/runtime metadata missing' }
if ($manifest.Count+1 -ne $entryNames.Count) { throw 'Manifest does not describe every unique member' }
$manifestByPath=@{}
foreach($item in $manifest) {
  if ($manifestByPath.ContainsKey($item.path)) { throw 'Duplicate source manifest path' }
  $file=Assert-SignalChild (Join-Path $checkout $item.path) $checkout
  if (-not $entryNames.Contains("fsp-signal/$($item.path)") -or (Get-Item -LiteralPath $file).Length -ne $item.bytes -or (Get-SignalSha $file) -ne $item.sha256) { throw 'Manifest member SHA/byte size mismatch' }
  $manifestByPath[$item.path]=$item
}
$package=Get-Content -LiteralPath (Join-Path $checkout 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne '0.5.0' -or $manifestByPath['artifacts/api-server/src/lib/signal-matching.ts'].sha256 -ne $metadata.matchingAlgorithmSha256) { throw 'New package/core metadata differs from sealed source' }
foreach($path in 'lib/db/src/schema/signal-resume.ts','lib/db/migrations/0008_resume_pool_digest.sql') {
  if(-not $manifestByPath.ContainsKey($path)){throw 'Current resume pool schema and digest migration must be sealed before clean launch'}
}
foreach($path in $metadata.acceptedRuntime.sourceHashes.Keys) {
  if (-not $manifestByPath.ContainsKey($path) -or $manifestByPath[$path].sha256 -ne $metadata.acceptedRuntime.sourceHashes[$path]) { throw 'Accepted runtime inputs differ from new sealed source' }
}
if (-not $metadata.acceptedRuntime.sourceHashes.Count) { throw 'Accepted runtime source attestation must be nonempty' }
if (Test-Path -LiteralPath (Join-Path $checkout '.env')) { throw 'Source contains a private environment' }
if (Test-Path -LiteralPath (Join-Path $checkout 'node_modules')) { throw 'Source contains installed dependencies' }
$runtimeVersions=[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');configuredPackageManager=$package.packageManager;host=(Get-SignalHostRuntimeVersions $package.packageManager);dockerfile=(Get-SignalDockerPnpmTarget (Get-Content -LiteralPath (Join-Path $checkout 'Dockerfile') -Raw) $package.packageManager);container=$null;frozenLockfileSha256=$manifestByPath['pnpm-lock.yaml'].sha256;hostFrozenInstallVerified=$false;scope='Host versions are observed independently of packageManager. Frozen host installation verifies the lockfile dependency graph; Docker CLI must match its explicit target.'}
$previous=@{}
foreach($name in 'SIGNAL_HTTP_PORT','SIGNAL_DB_PORT','SIGNAL_MAIL_PORT','DATABASE_URL','POSTGRES_PASSWORD','VERIFICATION_TOKEN_SECRET','CI','DEMO_MODE','SIGNAL_REVIEWER_PROFILE','API_ORIGIN','REVIEWER_DATABASE_NAME','CLEAN_MAIL_ORIGIN','SIGNAL_REVIEWER_HTTP_PROBE') { $previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
$dbPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
$verificationSecret=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$env:SIGNAL_HTTP_PORT='4330';$env:SIGNAL_DB_PORT='55439';$env:SIGNAL_MAIL_PORT='8033'
$env:POSTGRES_PASSWORD=$dbPassword;$env:VERIFICATION_TOKEN_SECRET=$verificationSecret
$env:DATABASE_URL="postgresql://signal:$dbPassword@127.0.0.1:55439/$databaseName"
$env:CI='1';$env:DEMO_MODE='true';$env:SIGNAL_REVIEWER_PROFILE='isolated-local-review'
$env:API_ORIGIN='http://127.0.0.1:4330';$env:REVIEWER_DATABASE_NAME=$databaseName;$env:CLEAN_MAIL_ORIGIN='http://127.0.0.1:8033';$env:SIGNAL_REVIEWER_HTTP_PROBE='true'
$override=Join-Path $cleanRoot 'clean.compose.yaml'
# This file is private, outside the archive; secret variables are expanded by
# Compose only from the current isolated environment. Never copy main .env.
@'
services:
  db:
    environment:
      POSTGRES_DB: __OWNED_DATABASE__
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U signal -d __OWNED_DATABASE__"]
  app:
    environment:
      DATABASE_URL: postgresql://signal:${POSTGRES_PASSWORD}@db:5432/__OWNED_DATABASE__
      PUBLIC_URL: http://127.0.0.1:4330
'@.Replace('__OWNED_DATABASE__',$databaseName) | Set-Content -LiteralPath $override -Encoding utf8
$compose=@('compose','-p',$projectName,'-f',(Join-Path $checkout 'compose.yaml'),'-f',$override,'--profile','full')
$start=[DateTime]::UtcNow;$step='fresh source checks';$passed=$false;$freshInstall=$false;$freshDatabase=$false;$unitSuite=$null;$sourceGuardSuite=$null;$createdProject=$false;$cleanup='not_started';$failure=$null;$image=$null;$runtimeProof=$null;$httpProof=$null;$offline=@();$protectedPreserved=$false;$contextRefreshProof=$null
$reportPath=Join-Path $releaseRoot 'clean-source-launch.json'
if(Test-Path -LiteralPath $reportPath){$history=Join-Path $releaseRoot 'history';New-Item -ItemType Directory -Path $history -Force | Out-Null;$old=Join-Path $history ("clean-source-launch-"+(Get-SignalSha $reportPath).Substring(0,12)+'.json');if(-not(Test-Path -LiteralPath $old)){Copy-Item -LiteralPath $reportPath -Destination $old}}
Push-Location -LiteralPath $checkout
try {
  # Stdlib-only SHA validation, preserving the historical validator contract.
  Invoke-SignalChecked python @('-c','from pathlib import Path; import sys; sys.path.insert(0,"scripts"); from source_qa_inputs import validate_qa_source_inputs_v050; print("Versioned frozen inputs:",len(validate_qa_source_inputs_v050(Path.cwd())))') 'Versioned source QA inputs absent/drifted'
  $guardOutput=@(& python -m unittest discover -s tests -p test_source_v050_policy.py 2>&1);$guardExit=$LASTEXITCODE;$guardOutput|Write-Output
  if($guardExit -ne 0){throw 'Versioned source selection/freeze guard regression failed'}
  $actualPythonGuards=Get-SignalUnittestCount ($guardOutput -join "`n")
  $powershellGuardOutput=@(& (Join-Path $PSHOME 'pwsh.exe') -NoLogo -NoProfile -File scripts/test-clean-source-guards-v050.ps1);$powershellGuardExit=$LASTEXITCODE;$powershellGuardOutput|Write-Output
  if($powershellGuardExit -ne 0){throw 'Versioned PowerShell extraction/owned-runtime guards failed'}
  $actualPowershellGuards=($powershellGuardOutput -join "`n")|ConvertFrom-Json
  if($actualPowershellGuards.passed -ne $true -or -not ($actualPowershellGuards.groups -is [int] -or $actualPowershellGuards.groups -is [long]) -or $actualPowershellGuards.groups -lt 1 -or $actualPowershellGuards.archiveCreated -ne $false -or $actualPowershellGuards.databaseAccess -ne $false -or $actualPowershellGuards.runtimeAction -ne $false){throw 'Invalid actual PowerShell guard receipt'}
  $sourceGuardSuite=@{status='PASS';python=@{command='python -m unittest discover -s tests -p test_source_v050_policy.py';tests=$actualPythonGuards};powershell=@{command='pwsh -NoProfile -File scripts/test-clean-source-guards-v050.ps1';groups=$actualPowershellGuards.groups};countsDerivedFromActualOutput=$true}
  Invoke-SignalChecked pnpm @('install','--frozen-lockfile') 'Fresh dependency installation failed'
  if((Get-SignalSha 'pnpm-lock.yaml') -ne $runtimeVersions.frozenLockfileSha256){throw 'Host install altered the sealed frozen dependency graph'}
  $freshInstall=$true;$runtimeVersions.hostFrozenInstallVerified=$true
  $unitOutput=@(& pnpm test);$unitExit=$LASTEXITCODE;$unitOutput|Write-Output
  if($unitExit -ne 0){throw 'Complete extracted-source unit suite failed'}
  $unitSummary=[regex]::Match(($unitOutput -join "`n"),'(?m)^(?:#|ℹ)\s*tests\s+(\d+)\s*$')
  $unitSuite=@{status='PASS';command='pnpm test';source='fresh extracted source';tests=if($unitSummary.Success){[int]$unitSummary.Groups[1].Value}else{$null};countRecorded=$unitSummary.Success}
  $baselinePaths=@('outputs/quality/matching-competitive-v2-report.json','outputs/quality/qa-cycle-01/intergroup-control-v1-report.json','outputs/quality/qa-cycle-01/traceability-regression-v1-report.json')
  $baselines=@($baselinePaths | ForEach-Object { Get-Content -LiteralPath $_ -Raw | ConvertFrom-Json -AsHashtable })
  foreach($script in 'scripts/evaluate.ts','scripts/evaluate-competitive-matching.ts','scripts/evaluate-intergroup-control.ts','scripts/evaluate-traceability-regression.ts') { Invoke-SignalChecked node @('--import','tsx',$script) 'Extracted-source offline reproduction failed' }
  New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'offline') -Force | Out-Null
  for($index=0;$index -lt $baselinePaths.Count;$index++) {
    $actual=Get-Content -LiteralPath $baselinePaths[$index] -Raw | ConvertFrom-Json -AsHashtable
    if($actual.algorithmSha256 -ne $metadata.matchingAlgorithmSha256 -or $actual.algorithmVersion -ne $metadata.matchingAlgorithmVersion) { throw 'Offline evaluator used a different source than sealed current matcher' }
    $fields=if($index -eq 2){@('checks','originalCases','newCases')}else{@('summary','byQuery')}
    foreach($field in $fields) {if((Get-SignalCanonical $baselines[$index][$field]) -ne (Get-SignalCanonical $actual[$field])) { throw 'Unchanged frozen scenario semantic outcomes drifted' }}
    $checks=if($index -eq 1){$actual.metamorphic.checks}elseif($index -eq 2){$actual.checks}else{@{semanticSummary=$true}}
    if(@($checks.Values|Where-Object {$_ -ne $true}).Count){throw 'Offline semantic/metamorphic regression failed'}
    $copy=Join-Path (Join-Path $releaseRoot 'offline') ([IO.Path]::GetFileName($baselinePaths[$index]));Copy-Item -LiteralPath $baselinePaths[$index] -Destination $copy
    $offline+=@{path=$baselinePaths[$index];actualSourceSHA=$actual.algorithmSha256;baselineSourceSHA=$baselines[$index].algorithmSha256;semanticOutcomesEqual=$true;freshReportSHA=Get-SignalSha $copy;checks=$checks}
  }
  Invoke-SignalChecked python @('-c','from pathlib import Path; import sys; sys.path.insert(0,"scripts"); from source_qa_inputs import validate_qa_source_inputs_v050; print("Frozen inputs unchanged:",len(validate_qa_source_inputs_v050(Path.cwd(),False)))') 'Offline reproduction altered frozen source inputs'
  $step='no-cache Docker build'
  $contextRefreshProof=Refresh-SignalDockerContext $checkout $manifestByPath
  Invoke-SignalChecked docker ($compose+@('build','--no-cache','app')) 'Fresh no-cache source build failed'
  $createdProject=$true
  Invoke-SignalChecked docker ($compose+@('up','-d','db','mail')) 'Fresh isolated database/mail failed to start'
  $dbId=(docker @compose ps -q db).Trim()
  if($LASTEXITCODE -ne 0 -or -not $dbId){throw 'Isolated DB identity missing'}
  $dbInfo=docker inspect --format '{{json .}}' $dbId | ConvertFrom-Json
  if($dbInfo.Config.Labels.'com.docker.compose.project' -ne $projectName -or $dbInfo.Config.Labels.'com.docker.compose.service' -ne 'db' -or -not @($dbInfo.NetworkSettings.Ports.'5432/tcp'|Where-Object {$_.HostIp -eq '127.0.0.1' -and $_.HostPort -eq '55439'}).Count){throw 'Isolated DB target binding mismatch'}
  $deadline=[DateTime]::UtcNow.AddSeconds(90);$empty=$false
  do {
    $tables=docker exec $dbId psql -U signal -d $databaseName -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>$null
    if($LASTEXITCODE -eq 0){if($tables.Trim() -ne '0'){throw 'Clean database already contains tables before migrations'};$empty=$true;break}
    Start-Sleep -Seconds 2
  }while([DateTime]::UtcNow -lt $deadline)
  if(-not $empty){throw 'Fresh empty database not verified'}
  $freshDatabase=$true;$step='new migrations/seed and HTTP'
  Invoke-SignalChecked docker ($compose+@('up','-d','app')) 'Fresh application failed to start'
  $appId=(docker @compose ps -q app).Trim();$appInfo=Read-SignalOwnedApp $appId $projectName;$cleanAppStartedAt=([DateTimeOffset]$appInfo.State.StartedAt).UtcDateTime.ToString('o')
  $deadline=[DateTime]::UtcNow.AddSeconds(180);$health=$null
  do {try{$health=Invoke-RestMethod 'http://127.0.0.1:4330/api/healthz';if($health.status -eq 'ok'){break}}catch{};Start-Sleep -Seconds 2}while([DateTime]::UtcNow -lt $deadline)
  if($health.status -ne 'ok'){throw 'Fresh application health timeout'}
  $appInfo=Read-SignalOwnedApp $appId $projectName $cleanAppStartedAt
  $web=Invoke-WebRequest 'http://127.0.0.1:4330/';if($web.StatusCode -ne 200 -or $web.Content -notmatch 'Signal'){throw 'Built website unavailable'}
  $programs=Invoke-RestMethod 'http://127.0.0.1:4330/api/assessments/programs'
  foreach($id in $metadata.programVersions.Keys){$program=@($programs|Where-Object {$_.id -eq $id});if($program.Count -ne 1 -or $program[0].version -ne $metadata.programVersions[$id] -or -not $program[0].available){throw 'Active program registry differs from source metadata'}}
  Invoke-SignalChecked node @('--import','tsx','scripts/clean-source-http-v050.ts') 'Fresh ordinary/reviewer/qualification/catalog/PDF HTTP acceptance failed'
  $httpProof=Get-Content -LiteralPath 'outputs/release-0.5.0/clean-http.json' -Raw | ConvertFrom-Json -AsHashtable
  if($httpProof.status -ne 'PASS' -or -not $httpProof.realPdf -or -not $httpProof.ordinaryCleanup -or -not $httpProof.reviewerProof.cleanup){throw 'Fresh HTTP proof did not complete exact cleanup'}
  Copy-Item -LiteralPath 'outputs/release-0.5.0/clean-http.json' -Destination (Join-Path $releaseRoot 'clean-http.json')
  Copy-Item -LiteralPath 'outputs/verification/reviewer-http-2026-10-06.json' -Destination (Join-Path $releaseRoot 'clean-reviewer-http.json')
  if((docker @compose ps -q app).Trim() -ne $appId){throw 'Clean application container replaced during HTTP verification'}
  $appInfo=Read-SignalOwnedApp $appId $projectName $cleanAppStartedAt
  $image=$appInfo.Image
  $containerNode=@(docker exec $appId node --version);if($LASTEXITCODE -ne 0 -or ($containerNode -join '').Trim() -notmatch '^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$'){throw 'Cannot record actual clean container Node version'}
  $containerPnpm=@(docker exec $appId pnpm --version);if($LASTEXITCODE -ne 0 -or ($containerPnpm -join '').Trim() -ne $runtimeVersions.dockerfile.pnpm){throw 'Actual clean Docker pnpm differs from the sealed configured target'}
  $runtimeVersions.container=[ordered]@{node=($containerNode -join '').Trim();pnpm=($containerPnpm -join '').Trim();pnpmMatchesConfigured=$true;containerId=$appId;image=$image}
  $runtimePaths=@(Get-SignalRuntimePaths $manifestByPath $metadata.acceptedRuntime.sourceHashes)
  $hashCode='const fs=require("fs"),c=require("crypto");const paths=JSON.parse(fs.readFileSync(0,"utf8").replace(/^\uFEFF/,""));const sha=p=>c.createHash("sha256").update(fs.readFileSync(p)).digest("hex");process.stdout.write(JSON.stringify({sourceHashes:Object.fromEntries(paths.map(p=>[p,sha(p)])),bundleSHA:sha("artifacts/api-server/dist/index.mjs")}));'
  $runtimeProof=(ConvertTo-Json -InputObject $runtimePaths -Compress | docker exec -i $appId node -e $hashCode) | ConvertFrom-Json -AsHashtable
  if($LASTEXITCODE -ne 0){throw 'Fresh runtime source/bundle attestation failed'}
  foreach($path in $runtimeProof.sourceHashes.Keys){if($runtimeProof.sourceHashes[$path] -ne $manifestByPath[$path].sha256){throw 'Fresh runtime source differs from sealed manifest'}}
  if($runtimeProof.bundleSHA -ne $metadata.acceptedRuntime.bundleSHA){throw 'Fresh compiled API differs from accepted frozen runtime bundle'}
  $runtimeProof.applicationVersion='0.5.0';$runtimeProof.image=$image;$runtimeProof.containerId=$appId;$runtimeProof.sourceMatchesSealed=$true;$runtimeProof.bundleMatchesAccepted=$true
  $runtimeProof|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $releaseRoot 'clean-runtime.json') -Encoding utf8
  if((Get-SignalSha $sourceZip) -ne $sourceHash){throw 'Sealed source changed during clean verification'}
  $passed=$true
} catch {$failure="Clean verification failed at $step; sensitive exception details suppressed"}
finally {
  if($createdProject){docker @compose down --volumes --remove-orphans;$cleanup=if($LASTEXITCODE -eq 0){'complete'}else{'failed'}}else{$cleanup='not_created'}
  Pop-Location
  try {
    $protectedAfter=Get-SignalProtectedRuntime
    $protectedPreserved=(Get-SignalCanonical $protectedBefore) -eq (Get-SignalCanonical $protectedAfter)
    if(-not $protectedPreserved){$passed=$false;$failure='Protected working/stage runtime identity changed during clean run'}
  }catch{$protectedPreserved=$false;$passed=$false;$failure='Protected runtime identity read failed'}
  [ordered]@{schemaVersion=1;applicationVersion='0.5.0';startedAt=$start.ToString('o');finishedAt=[DateTime]::UtcNow.ToString('o');passed=($passed -and $cleanup -eq 'complete' -and $protectedPreserved);sourceSha256=$sourceHash;expectedSourceSha256=$ExpectedSha256;privacyProofSha256=Get-SignalSha $privacyPath;sourceManifestRecords=$manifest.Count;project=$projectName;database=$databaseName;ports=@(4330,55439,8033);image=$image;runtimeVersions=$runtimeVersions;dockerContextRefresh=$contextRefreshProof;freshDependencies=$freshInstall;unitSuite=$unitSuite;sourceGuardSuite=$sourceGuardSuite;freshEmptyDatabase=$freshDatabase;offlineReproduction=$offline;http=$httpProof;runtime=$runtimeProof;cleanup=$cleanup;failure=$failure;protectedRuntimePreserved=$protectedPreserved;protectedBefore=$protectedBefore;protectedAfter=$protectedAfter;extractedSource=$checkout;scope='Exact 0.5.0 sealed ZIP; fresh host dependency/unit/offline checks; no-cache Docker build, owned empty DB/migrations/overview seed, ordinary local Mailpit HTTP verification, two real reviewer exam sessions, catalogue/copies/PDF. Main/stage are not queried or mutated. Identity witnesses cannot prove unrelated concurrent row changes. Host pnpm is observed, not relabelled as the configured Docker CLI. No production SMTP, human grade validity or browser UI acceptance claim.'}|ConvertTo-Json -Depth 50|Set-Content -LiteralPath $reportPath -Encoding utf8
  foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
if(-not $passed -or $cleanup -ne 'complete' -or -not $protectedPreserved){throw 'New clean verification did not pass; versioned failure receipt retained'}
Write-Output ([ordered]@{passed=$true;sourceSha256=$sourceHash;report=$reportPath;cleanup=$cleanup;protectedRuntimePreserved=$protectedPreserved}|ConvertTo-Json -Compress)
