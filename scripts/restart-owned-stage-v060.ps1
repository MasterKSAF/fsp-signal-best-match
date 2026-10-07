param(
  [switch]$CheckOnly,
  [int]$ExpectedPid,
  [string]$ExpectedStartedAt,
  [string]$ExpectedRunnerSha256,
  [string]$UpgradeProofSha256
)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell7 required'}
$signalRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$signalRunner=Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex/private/signal-stage-api.cjs'
$signalUpgradePath=Join-Path $signalRoot 'outputs/verification/release-0.6.0/stage-upgrade-0009.json'
function Assert-SignalStageV060Version($Package,$Upgrade,[string]$ActualRunnerSha,[string]$ExpectedRunnerSha) {
  if($Package.version -ne '0.6.0'){throw 'Version0.6.0 must be verified BEFORE stopping the existing stage'}
  if($Upgrade.applicationVersion -ne '0.6.0' -or $Upgrade.status -ne 'PASS' -or $Upgrade.passed -ne $true -or $Upgrade.businessStatePreserved -ne $true -or $Upgrade.migration.exitCode -ne 0 -or $Upgrade.migration.withoutSeedOrReset -ne $true){throw 'Actual preserved0009 migration PASS is required before stage restart'}
  if($Upgrade.target.database -ne 'signal_resume_stage' -or $Upgrade.target.host -ne '127.0.0.1' -or $Upgrade.target.port -ne 55435 -or $Upgrade.target.containerName -ne 'signal-qa-cycle-01-db-1' -or $Upgrade.target.containerId -notmatch '^[a-f0-9]{64}$' -or $Upgrade.target.databaseOid -lt 1){throw 'Actual exact owned stage migration target is required'}
  if($Upgrade.backup.sha256 -notmatch '^[a-f0-9]{64}$' -or $Upgrade.backup.bytes -le 100 -or $Upgrade.backup.private -ne $true -or $Upgrade.backup.sameExportedSnapshotAsBeforeHash -ne $true -or $Upgrade.signatures.allLiveAndDeletedRowsSigned32Bytes -ne $true -or $Upgrade.signatures.exactDigestFunctionMatches -ne $true){throw 'Actual same-snapshot backup and valid preserved resume digests are required'}
  if($ExpectedRunnerSha -notmatch '^[a-f0-9]{64}$' -or $ActualRunnerSha -ne $ExpectedRunnerSha){throw 'Exact private existing stage runner differs'}
}
function Assert-SignalStageV060Process($Process,$Bindings,[int]$Expected,[string]$Started,[string]$Runner) {
  if($Expected -lt 1 -or [string]::IsNullOrEmpty($Started)){throw 'Actual current stage PID/start identity required; historical PID is insufficient'}
  # Slash equivalence is limited to the exact script argument. A matching
  # substring, suffix, filename or different directory is never an owner proof.
  $normalizedCommand=([string]$Process.CommandLine).Replace('\','/')
  $normalizedRunner=$Runner.Replace('\','/')
  $runnerArgument='(?:^|\s)(?:"'+[regex]::Escape($normalizedRunner)+'"|'+[regex]::Escape($normalizedRunner)+')(?=$|\s)'
  if(-not $Process -or $Process.Name -ne 'node.exe' -or $Process.ProcessId -ne $Expected -or [string]::IsNullOrEmpty($normalizedRunner) -or $normalizedCommand -notmatch $runnerArgument){throw 'Exact owned private stage runner identity changed'}
  if(([datetime]$Process.CreationDate).ToUniversalTime().Ticks -ne ([datetime]$Started).ToUniversalTime().Ticks){throw 'Owned stage process start identity differs'}
  $list=@($Bindings)
  if($list.Count -ne 1 -or $list[0].OwningProcess -ne $Expected -or $list[0].LocalPort -ne 4313 -or $list[0].LocalAddress -ne '127.0.0.1'){throw 'Exact single stage loopback API binding differs'}
}
if($CheckOnly){
  [ordered]@{schemaVersion=1;applicationVersion='0.6.0';preparationOnly=$true;stageAccess=$false;processAction=$false;migrationRun=$false;requiresActual0009Proof=$true}|ConvertTo-Json -Compress
  return
}
if($env:SIGNAL_STAGE_V060_RESTART_RELEASE -ne '1'){throw 'Explicit root release required before stage reads or process control'}
if($UpgradeProofSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $signalUpgradePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $UpgradeProofSha256){throw 'Exact actual0009 upgrade receipt SHA required'}
$signalPackage=Get-Content -LiteralPath (Join-Path $signalRoot 'package.json') -Raw|ConvertFrom-Json
$signalUpgrade=Get-Content -LiteralPath $signalUpgradePath -Raw|ConvertFrom-Json
$signalRunnerSha=(Get-FileHash -LiteralPath $signalRunner -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-SignalStageV060Version $signalPackage $signalUpgrade $signalRunnerSha $ExpectedRunnerSha256
foreach($signalPath in 'scripts/upgrade-owned-stage-v060.cjs','scripts/migrate.ts','lib/db/migrations/meta/_journal.json','lib/db/migrations/0009_microtask_resume.sql','lib/db/src/schema/signal-opportunities.ts'){
  if($signalUpgrade.sourceHashes.$signalPath -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath (Join-Path $signalRoot $signalPath) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $signalUpgrade.sourceHashes.$signalPath){throw 'Preserved migration source no longer matches current stage source'}
}
$signalDbInfo=docker inspect --format '{{json .}}' $signalUpgrade.target.containerId|ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or $signalDbInfo.Name -ne '/signal-qa-cycle-01-db-1' -or $signalDbInfo.Id -ne $signalUpgrade.target.containerId -or -not $signalDbInfo.State.Running -or $signalDbInfo.Config.Labels.'com.docker.compose.project' -ne 'signal-qa-cycle-01' -or $signalDbInfo.Config.Labels.'com.docker.compose.service' -ne 'db'){throw 'Preserved stage DB container identity differs before API stop'}
$signalDbBindings=@($signalDbInfo.NetworkSettings.Ports.'5432/tcp')
if($signalDbBindings.Count -ne 1 -or $signalDbBindings[0].HostIp -ne '127.0.0.1' -or $signalDbBindings[0].HostPort -ne '55435'){throw 'Stage DB loopback binding differs before API stop'}
$signalOid=(docker exec $signalDbInfo.Id psql -U signal -d signal_resume_stage -Atc "SELECT oid FROM pg_database WHERE datname=current_database()").Trim()
if($LASTEXITCODE -ne 0 -or $signalOid -notmatch '^\d+$' -or [long]$signalOid -ne $signalUpgrade.target.databaseOid){throw 'Preserved named stage DB OID differs before API stop'}
# All guards, including application version and migration preservation, run
# before Stop-Process. This helper never migrates, seeds or resets a database.
$signalProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ExpectedPid)
$signalBindings=@(Get-NetTCPConnection -LocalPort 4313 -State Listen -ErrorAction SilentlyContinue)
Assert-SignalStageV060Process $signalProcess $signalBindings $ExpectedPid $ExpectedStartedAt $signalRunner
Push-Location -LiteralPath $signalRoot
try{$signalPaths=@('package.json','pnpm-lock.yaml','artifacts/api-server/build.mjs','artifacts/api-server/build-portability.mjs')+@(rg --files artifacts/api-server/src lib/db/src lib/db/migrations lib/api-zod/src lib/api-client-react/src lib/api-spec artifacts/fsp-signal/src);if($LASTEXITCODE -ne 0){throw 'Current stage source inventory failed'}}finally{Pop-Location}
$signalBefore=@($signalPaths|Sort-Object -Unique|ForEach-Object{[ordered]@{path=$_.Replace('\','/');sha256=(Get-FileHash -LiteralPath (Join-Path $signalRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant()}})
$signalNode=(Get-Command node -ErrorAction Stop).Source
$signalLoader=(Resolve-Path -LiteralPath (Join-Path $signalRoot 'node_modules/tsx/dist/loader.mjs')).Path
$signalLoaderUri=([Uri]$signalLoader).AbsoluteUri
if(-not $signalLoaderUri.StartsWith('file:///') -or $signalLoaderUri -notmatch '/tsx/dist/loader\.mjs$'){throw 'Actual Windows ESM loader must be a file URL'}
$signalPrivateDir=Split-Path $signalRunner
$signalRunId=[guid]::NewGuid().ToString('N').Substring(0,12)
foreach($signalLog in 'out','error'){
  $signalLogPath=Join-Path $signalPrivateDir ('signal-stage-api-'+$signalLog+'.log')
  if(Test-Path -LiteralPath $signalLogPath){Copy-Item -LiteralPath $signalLogPath -Destination (Join-Path $signalPrivateDir ('signal-stage-v060-before-'+$ExpectedPid+'-'+$signalRunId+'-'+$signalLog+'.log'))}
}
Stop-Process -Id $ExpectedPid
if(Get-NetTCPConnection -LocalPort 4313 -State Listen -ErrorAction SilentlyContinue){throw 'Stage listener remains; no foreign process will be stopped'}
$signalChild=Start-Process -FilePath $signalNode -ArgumentList @('--import',$signalLoaderUri,('"'+$signalRunner+'"')) -WorkingDirectory $signalRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $signalPrivateDir 'signal-stage-api-out.log') -RedirectStandardError (Join-Path $signalPrivateDir 'signal-stage-api-error.log') -PassThru
$signalChild.Refresh();$signalReady=$false
for($signalTry=0;$signalTry -lt 30;$signalTry++){
  $signalChild.Refresh();if($signalChild.HasExited){throw 'Owned stage exited; private diagnostic log retained'}
  try{$signalHealth=Invoke-RestMethod 'http://127.0.0.1:4313/api/healthz' -TimeoutSec 2;if($signalHealth.status -eq 'ok'){$signalReady=$true;break}}catch{}
  Start-Sleep -Milliseconds 300
}
if(-not $signalReady){throw 'Owned stage health timeout; private log retained'}
$signalActual=Get-CimInstance Win32_Process -Filter ('ProcessId='+$signalChild.Id)
Assert-SignalStageV060Process $signalActual @(Get-NetTCPConnection -LocalPort 4313 -State Listen) $signalChild.Id ([datetime]$signalActual.CreationDate).ToUniversalTime().ToString('o') $signalRunner
$signalAfter=@($signalBefore|ForEach-Object{[ordered]@{path=$_.path;sha256=(Get-FileHash -LiteralPath (Join-Path $signalRoot $_.path) -Algorithm SHA256).Hash.ToLowerInvariant()}})
if(($signalBefore|ConvertTo-Json -Depth 5 -Compress) -ne ($signalAfter|ConvertTo-Json -Depth 5 -Compress) -or (Get-FileHash -LiteralPath $signalRunner -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedRunnerSha256){throw 'Stage sources or private runner changed during restart'}
$signalReceipt=[ordered]@{schemaVersion=1;applicationVersion='0.6.0';passed=$true;recordedAt=[DateTime]::UtcNow.ToString('o');previousPid=$ExpectedPid;pid=$signalChild.Id;processStartedAt=([datetime]$signalActual.CreationDate).ToUniversalTime().ToString('o');processStartSource='Win32_Process.CreationDate before/after';apiOrigin='http://127.0.0.1:4313';uiOrigin='http://127.0.0.1:4314';database='signal_resume_stage';upgradeProofSha256=$UpgradeProofSha256;versionVerifiedBeforeStop=$true;sourcesUnchangedDuringRestart=$true;runtimeSourceFiles=$signalAfter;execution='Native existing private source-tsx stage runner. Migration/business preservation is an independently verified prerequisite; no compiled/load/clean or after-restart business-row equality claim.'}
$signalReceipt|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $signalRoot 'outputs/verification/release-0.6.0/stage-runtime-restart.json') -Encoding utf8
Write-Output ('Owned Signal0.6 stage ready; PID '+$signalChild.Id+'; source inputs '+$signalAfter.Count)
