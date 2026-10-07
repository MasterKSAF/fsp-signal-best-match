# Pure AST/function guard tests. Docker is mocked; the launch script body is not dot-sourced.
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell7 required'}
$signalSource=Join-Path $PSScriptRoot 'clean-source-launch-v060.ps1'
$signalTokens=$null;$signalErrors=$null
$signalAst=[Management.Automation.Language.Parser]::ParseFile($signalSource,[ref]$signalTokens,[ref]$signalErrors)
if($signalErrors.Count){throw 'New clean script syntax error'}
foreach($signalName in 'Get-SignalSha','Assert-SignalChild','Read-SignalOwnedApp','Get-SignalHostRuntimeVersions','Get-SignalDockerPnpmTarget','Get-SignalUnittestCount','Get-SignalRuntimePaths','Refresh-SignalDockerContext'){
  $signalDefinition=$signalAst.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $signalName},$true)
  if(-not $signalDefinition){throw 'Expected narrow clean guard missing'}
  . ([scriptblock]::Create($signalDefinition.Extent.Text))
}
$signalChecks=0
$signalRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Assert-SignalChild (Join-Path $signalRoot 'outputs/release-0.6.0/clean-owned') (Join-Path $signalRoot 'outputs/release-0.6.0') | Out-Null
$signalRejected=$false;try{Assert-SignalChild (Join-Path $signalRoot '../outside') $signalRoot | Out-Null}catch{$signalRejected=$true}
if(-not $signalRejected){throw 'Path traversal guard did not reject'};$signalChecks++
$signalMockId='a'*64;$signalProject='signal-clean-v060-f00dbabe';$signalStartedAt='2026-10-06T12:00:00Z'
$signalFixture=@{Id=$signalMockId;State=@{Running=$true;StartedAt=$signalStartedAt};Config=@{Labels=@{'com.docker.compose.project'=$signalProject;'com.docker.compose.service'='app'}};NetworkSettings=@{Ports=@{'4310/tcp'=@(@{HostIp='127.0.0.1';HostPort='4334'})}}}
$script:signalMockContainer=$signalFixture|ConvertTo-Json -Depth 12 -Compress
function docker {$global:LASTEXITCODE=0;return $script:signalMockContainer}
try{
  $signalValid=Read-SignalOwnedApp $signalMockId $signalProject $signalStartedAt
  if($signalValid.Id -ne $signalMockId){throw 'Valid mock identity failed'};$signalChecks++
  $signalMutators=@(
    {param($fixture)$fixture.Config.Labels.'com.docker.compose.project'='fsp-signal'},
    {param($fixture)$fixture.Config.Labels.'com.docker.compose.service'='db'},
    {param($fixture)$fixture.State.Running=$false},
    {param($fixture)$fixture.State.StartedAt='2026-10-06T13:00:00Z'},
    {param($fixture)$fixture.NetworkSettings.Ports.'4310/tcp'[0].HostPort='4314'},
    {param($fixture)$fixture.NetworkSettings.Ports.'4310/tcp'[0].HostIp='0.0.0.0'}
  )
  foreach($signalMutator in $signalMutators){
    $signalChanged=($signalFixture|ConvertTo-Json -Depth 12)|ConvertFrom-Json -AsHashtable
    & $signalMutator $signalChanged
    $script:signalMockContainer=$signalChanged|ConvertTo-Json -Depth 12 -Compress
    $signalRejected=$false;try{Read-SignalOwnedApp $signalMockId $signalProject $signalStartedAt | Out-Null}catch{$signalRejected=$true}
    if(-not $signalRejected){throw 'Foreign/stopped/restarted/unbound app was not rejected'};$signalChecks++
  }
  $signalRejected=$false;try{& $signalSource}catch{if($_.Exception.Message -eq 'Preparation only: explicit release freeze is required before install/build/launch'){$signalRejected=$true}else{throw 'Unexpected early release guard error'}}
  if(-not $signalRejected){throw 'Missing release was not rejected before script body'};$signalChecks++
}finally{Remove-Item -LiteralPath function:docker}
function node {$global:LASTEXITCODE=0;return 'v24.14.1'}
function pnpm {$global:LASTEXITCODE=0;return '11.19.0'}
function python {$global:LASTEXITCODE=0;return 'Python 3.11.9'}
try{
  $signalVersions=Get-SignalHostRuntimeVersions 'pnpm@11.25.0'
  if($signalVersions.node -ne 'v24.14.1' -or $signalVersions.pnpm -ne '11.19.0' -or $signalVersions.python -ne 'Python 3.11.9' -or $signalVersions.powershell -ne $PSVersionTable.PSVersion.ToString() -or $signalVersions.pnpmMatchesConfigured){throw 'Host versions were relabelled as configured versions'};$signalChecks++
  function pnpm {$global:LASTEXITCODE=0;return 'unexpected version output'}
  $signalRejected=$false;try{Get-SignalHostRuntimeVersions 'pnpm@11.25.0' | Out-Null}catch{$signalRejected=$true}
  if(-not $signalRejected){throw 'Malformed host version output accepted'};$signalChecks++
  $signalDockerPin=Get-SignalDockerPnpmTarget 'RUN corepack enable && corepack prepare pnpm@11.25.0 --activate' 'pnpm@11.25.0'
  if($signalDockerPin.pnpm -ne '11.25.0' -or -not $signalDockerPin.matchesConfigured){throw 'Valid explicit Docker pnpm target rejected'}
  foreach($signalBadPin in 'RUN corepack prepare pnpm@11.19.0 --activate','# corepack prepare pnpm@11.25.0 --activate',"RUN corepack prepare pnpm@11.25.0 --activate`nRUN corepack prepare pnpm@11.25.0 --activate"){
    $signalRejected=$false;try{Get-SignalDockerPnpmTarget $signalBadPin 'pnpm@11.25.0' | Out-Null}catch{$signalRejected=$true}
    if(-not $signalRejected){throw 'Mismatched/comment-only/ambiguous Docker pnpm pin accepted'}
  };$signalChecks++
}finally{foreach($signalMockName in 'node','pnpm','python'){Remove-Item -LiteralPath "function:$signalMockName"}}
foreach($signalActualCount in 12,15,31) {
  $signalCount=Get-SignalUnittestCount "........`nRan $signalActualCount tests in 0.012s`n`nOK`n"
  if($signalCount -ne $signalActualCount){throw 'Actual unittest count was replaced by a hardcoded expectation'}
};$signalChecks++
foreach($signalBadSummary in "Ran 15 tests in 0.012s`nFAILED (failures=1)","Ran 0 tests in 0.012s`nOK","Ran 15 tests in 0.012s`nRan 12 tests in 0.012s`nOK","OK") {
  $signalRejected=$false;try{Get-SignalUnittestCount $signalBadSummary | Out-Null}catch{$signalRejected=$true}
  if(-not $signalRejected){throw 'Failed/empty/ambiguous unittest count was accepted'}
};$signalChecks++
$signalManifest=@{'artifacts/api-server/src/index.ts'=@{sha256='a'*64};'artifacts/api-server/build.mjs'=@{sha256='b'*64};'lib/api-zod/src/generated/api.ts'=@{sha256='c'*64};'pnpm-workspace.yaml'=@{sha256='d'*64}}
$signalAccepted=@{'artifacts/api-server/build.mjs'='b'*64;'lib/api-zod/src/generated/api.ts'='c'*64;'pnpm-workspace.yaml'='d'*64}
$signalPaths=@(Get-SignalRuntimePaths $signalManifest $signalAccepted)
if($signalPaths.Count -ne 4 -or @($signalAccepted.Keys|Where-Object {$_ -notin $signalPaths}).Count){throw 'Full accepted runtime build/generated/workspace inputs were omitted by the old directory filter'};$signalChecks++
foreach($signalBadAccepted in @{},@{'missing.ts'='a'*64},@{'artifacts/api-server/build.mjs'='e'*64}) {
  $signalRejected=$false;try{Get-SignalRuntimePaths $signalManifest $signalBadAccepted | Out-Null}catch{$signalRejected=$true}
  if(-not $signalRejected){throw 'Empty/missing/drifted accepted runtime source was accepted'}
};$signalChecks++
$signalTempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$signalTempRoot=Assert-SignalChild (Join-Path $signalTempParent ('signal-context-guard-'+[guid]::NewGuid().ToString('N'))) $signalTempParent
New-Item -ItemType Directory -Path $signalTempRoot|Out-Null
$signalTempFiles=@((Join-Path $signalTempRoot 'package.json'),(Join-Path $signalTempRoot 'type.ts'))
try{
  [IO.File]::WriteAllText($signalTempFiles[0],'{"version":"0.6.0"}',[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($signalTempFiles[1],'// OpenAPI spec version: 0.6.0',[Text.UTF8Encoding]::new($false))
  $signalMetadataManifest=@{'package.json'=@{sha256=Get-SignalSha $signalTempFiles[0]};'type.ts'=@{sha256=Get-SignalSha $signalTempFiles[1]};'outputs/not-in-context.json'=@{sha256='f'*64}}
  $signalKnownUtc=[DateTime]::SpecifyKind([DateTime]::new(2026,10,7,1,2,3),[DateTimeKind]::Utc)
  $signalRefresh=Refresh-SignalDockerContext $signalTempRoot $signalMetadataManifest $signalKnownUtc
  if($signalRefresh.files -ne 2 -or -not $signalRefresh.byteHashesVerifiedBeforeAndAfter){throw 'Metadata-only context refresh omitted source or included outputs'}
  foreach($signalFile in $signalTempFiles){if([IO.File]::GetLastWriteTimeUtc($signalFile) -ne $signalKnownUtc){throw 'Actual owned file timestamp did not refresh'}};$signalChecks++
  $signalBadContextFixtures=@(@{},@{'../outside'=@{sha256='f'*64}},@{'package.json'=@{sha256='f'*64}},@{'package.json'=$signalMetadataManifest['package.json'];'type.ts'=@{sha256='f'*64}})
  foreach($signalBadContext in $signalBadContextFixtures){
    $signalRejected=$false;try{Refresh-SignalDockerContext $signalTempRoot $signalBadContext ([DateTime]::UtcNow)|Out-Null}catch{$signalRejected=$true}
    if(-not $signalRejected){throw 'Empty/escaping/drifted sealed context was accepted'}
    foreach($signalFile in $signalTempFiles){if([IO.File]::GetLastWriteTimeUtc($signalFile) -ne $signalKnownUtc){throw 'Invalid context modified file metadata before checking all hashes'}}
  };$signalChecks++
}finally{
  foreach($signalFile in $signalTempFiles){Assert-SignalChild $signalFile $signalTempRoot|Out-Null;if(Test-Path -LiteralPath $signalFile){Remove-Item -LiteralPath $signalFile}}
  Assert-SignalChild $signalTempRoot $signalTempParent|Out-Null;Remove-Item -LiteralPath $signalTempRoot
}
[ordered]@{passed=$true;groups=$signalChecks;scope='Only narrow guard function ASTs and two owned temporary metadata-only files. Docker mocked; missing-release launch rejects before side effects.';archiveCreated=$false;databaseAccess=$false;runtimeAction=$false}|ConvertTo-Json -Compress
