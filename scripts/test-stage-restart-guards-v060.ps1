# No stage/SQL/process access: import only pure guard function ASTs.
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell7 required'}
$signalPath=Join-Path $PSScriptRoot 'restart-owned-stage-v060.ps1'
$signalTokens=$null;$signalErrors=$null;$signalAst=[Management.Automation.Language.Parser]::ParseFile($signalPath,[ref]$signalTokens,[ref]$signalErrors)
if($signalErrors.Count){throw 'Prepared stage restart syntax error'}
foreach($signalName in 'Assert-SignalStageV060Version','Assert-SignalStageV060Process'){
  $signalNode=$signalAst.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $signalName},$true)
  . ([scriptblock]::Create($signalNode.Extent.Text))
}
$signalVersion=@{version='0.6.0'};$signalSha='a'*64
$signalUpgrade=@{applicationVersion='0.6.0';status='PASS';passed=$true;businessStatePreserved=$true;migration=@{exitCode=0;withoutSeedOrReset=$true};target=@{database='signal_resume_stage';host='127.0.0.1';port=55435;containerName='signal-qa-cycle-01-db-1';containerId='b'*64;databaseOid=12345};backup=@{sha256='c'*64;bytes=101;private=$true;sameExportedSnapshotAsBeforeHash=$true};signatures=@{allLiveAndDeletedRowsSigned32Bytes=$true;exactDigestFunctionMatches=$true}}
Assert-SignalStageV060Version $signalVersion $signalUpgrade $signalSha $signalSha
$signalChecks=1
foreach($signalMutator in @({param($v)$v.applicationVersion='0.5.0'},{param($v)$v.businessStatePreserved=$false},{param($v)$v.backup.sameExportedSnapshotAsBeforeHash=$false},{param($v)$v.target.port=55433},{param($v)$v.signatures.allLiveAndDeletedRowsSigned32Bytes=$false})){
  $signalChanged=$signalUpgrade|ConvertTo-Json -Depth 10|ConvertFrom-Json -AsHashtable;&$signalMutator $signalChanged
  $signalRejected=$false;try{Assert-SignalStageV060Version $signalVersion $signalChanged $signalSha $signalSha}catch{$signalRejected=$true};if(-not $signalRejected){throw 'Unsafe migration witness passed restart guard'};$signalChecks++
}
$signalRejected=$false;try{Assert-SignalStageV060Version @{version='0.5.0'} $signalUpgrade $signalSha $signalSha}catch{$signalRejected=$true};if(-not $signalRejected){throw 'Historical source version accepted'};$signalChecks++
$signalRejected=$false;try{Assert-SignalStageV060Version $signalVersion $signalUpgrade ('d'*64) $signalSha}catch{$signalRejected=$true};if(-not $signalRejected){throw 'Different private runner accepted'};$signalChecks++
$signalStart='2026-10-07T10:00:00Z';$signalRunner='C:\synthetic\private\signal-stage-api.cjs'
$signalProcess=@{Name='node.exe';ProcessId=123;CommandLine='node --import tsx '+$signalRunner;CreationDate=[datetime]$signalStart};$signalBinding=@{OwningProcess=123;LocalPort=4313;LocalAddress='127.0.0.1'}
Assert-SignalStageV060Process $signalProcess @($signalBinding) 123 $signalStart $signalRunner;$signalChecks++
# Windows command lines may use either separator; only the whole argument is accepted.
foreach($signalCommand in @('node --import tsx C:/synthetic/private/signal-stage-api.cjs','node --import tsx "C:/synthetic/private/signal-stage-api.cjs" --flag')){
  $signalEquivalent=$signalProcess.Clone();$signalEquivalent.CommandLine=$signalCommand
  Assert-SignalStageV060Process $signalEquivalent @($signalBinding) 123 $signalStart $signalRunner;$signalChecks++
}
foreach($signalCommand in @('node C:/synthetic/private/signal-stage-api.cjs-foreign','node prefixC:/synthetic/private/signal-stage-api.cjs','node C:/foreign/private/signal-stage-api.cjs','node --comment="C:/synthetic/private/signal-stage-api.cjs-foreign"','node --comment="C:/synthetic/private/signal-stage-api.cjs"','node signal-stage-api.cjs')){
  $signalForeign=$signalProcess.Clone();$signalForeign.CommandLine=$signalCommand
  $signalRejected=$false;try{Assert-SignalStageV060Process $signalForeign @($signalBinding) 123 $signalStart $signalRunner}catch{$signalRejected=$true};if(-not $signalRejected){throw 'Similar foreign script argument accepted'};$signalChecks++
}
foreach($signalChange in @(@{OwningProcess=124;LocalPort=4313;LocalAddress='127.0.0.1'},@{OwningProcess=123;LocalPort=4310;LocalAddress='127.0.0.1'},@{OwningProcess=123;LocalPort=4313;LocalAddress='0.0.0.0'})){
  $signalRejected=$false;try{Assert-SignalStageV060Process $signalProcess @($signalChange) 123 $signalStart $signalRunner}catch{$signalRejected=$true};if(-not $signalRejected){throw 'Foreign listener accepted'};$signalChecks++
}
$signalRejected=$false;try{Assert-SignalStageV060Process $signalProcess @($signalBinding) 123 '2026-10-07T10:00:01Z' $signalRunner}catch{$signalRejected=$true};if(-not $signalRejected){throw 'PID reuse accepted'};$signalChecks++
& $signalPath -CheckOnly|Out-Null
[ordered]@{passed=$true;groups=$signalChecks;stageAccess=$false;processAction=$false;migrationRun=$false;scope='Narrow pure AST guard functions with synthetic identity and backup witnesses only'}|ConvertTo-Json -Compress
