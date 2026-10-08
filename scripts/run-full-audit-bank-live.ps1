param(
  [ValidateSet('on','off')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$BundlePath,
  [Parameter(Mandatory=$true)][string]$BundleSha,
  [int]$MainPid = 45980,
  [Parameter(Mandatory=$true)][string]$RunName
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$auditRoot='C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008'
if ((Get-Location).Path.Replace('\','/') -ne $auditRoot) { throw 'Wrong isolated workdir' }
if ($BundleSha -ne (Get-FileHash -LiteralPath $BundlePath -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Wrong immutable bundle SHA' }
$auditEnvPath='C:/Users/Misha/.codex/private/signal-full-audit-a10-20261008.env'
$auditDir=Join-Path $auditRoot 'outputs/verification/full-audit-a01-a11-20261008/bank'
$auditEnvKeys=[IO.File]::ReadAllLines($auditEnvPath) | ForEach-Object { if ($_ -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=') { $Matches[1] } }
foreach ($auditEnvKey in $auditEnvKeys) { Remove-Item -LiteralPath ('Env:'+$auditEnvKey) -ErrorAction SilentlyContinue }
$auditNode=(Get-Command node).Source
function New-AuditNodeInfo([string[]]$Arguments) {
  $auditInfo=[Diagnostics.ProcessStartInfo]::new($auditNode)
  $auditInfo.UseShellExecute=$false
  $auditInfo.CreateNoWindow=$true
  $auditInfo.RedirectStandardOutput=$true
  $auditInfo.RedirectStandardError=$true
  $auditInfo.WorkingDirectory=$auditRoot
  foreach ($auditArgument in $Arguments) { $auditInfo.ArgumentList.Add($auditArgument) }
  return $auditInfo
}
$auditOffProcess=$null
$auditExit=1
try {
  $auditPid=$MainPid
  if ($Mode -eq 'off') {
    if (@(Get-NetTCPConnection -LocalPort 4385 -State Listen -ErrorAction SilentlyContinue).Count) { throw '4385 already owned; refuse launch' }
    $auditOffInfo=New-AuditNodeInfo @("--env-file=$auditEnvPath",$BundlePath)
    $auditOffInfo.Environment['PORT']='4385'
    $auditOffInfo.Environment['SIGNAL_SKILL_MODULES_ENABLED']='false'
    $auditOffProcess=[Diagnostics.Process]::Start($auditOffInfo)
    $auditOffStdout=$auditOffProcess.StandardOutput.ReadToEndAsync()
    $auditOffStderr=$auditOffProcess.StandardError.ReadToEndAsync()
    $auditPid=$auditOffProcess.Id
    $auditListening=$false
    for ($auditPoll=0;$auditPoll -lt 40;$auditPoll++) {
      if ($auditOffProcess.HasExited) { throw 'Owned off-mode API exited before ready' }
      if (@(Get-NetTCPConnection -LocalPort 4385 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -EQ $auditPid).Count) { $auditListening=$true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $auditListening) { throw 'Owned off-mode API never listened' }
  }
  $auditInfo=New-AuditNodeInfo @("--env-file=$auditEnvPath",'--import','tsx','scripts/full-audit-bank-live.ts',$BundlePath,$BundleSha,"$auditPid",$Mode,'900008301')
  if ($Mode -eq 'off') { $auditInfo.Environment['SIGNAL_SKILL_MODULES_ENABLED']='false' }
  $auditProcess=[Diagnostics.Process]::Start($auditInfo)
  $auditOut=$auditProcess.StandardOutput.ReadToEndAsync()
  $auditErr=$auditProcess.StandardError.ReadToEndAsync()
  $auditProcess.WaitForExit()
  [IO.File]::WriteAllText((Join-Path $auditDir "$RunName.stdout.log"),$auditOut.Result)
  [IO.File]::WriteAllText((Join-Path $auditDir "$RunName.stderr.log"),$auditErr.Result)
  $auditExit=$auditProcess.ExitCode
  Write-Output $auditOut.Result
  if ($auditExit -ne 0) { Write-Output $auditErr.Result }
} finally {
  if ($null -ne $auditOffProcess) {
    if (-not $auditOffProcess.HasExited) {
      $auditOffActual=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$auditOffProcess.Id)
      if ($auditOffActual.CommandLine.Replace('\','/').Contains($BundlePath.Replace('\','/'))) { $auditOffProcess.Kill(); $auditOffProcess.WaitForExit() }
      else { throw 'Owned off-mode PID command changed; refuse termination' }
    }
    [IO.File]::WriteAllText((Join-Path $auditDir "$RunName.api.stdout.log"),$auditOffStdout.Result)
    [IO.File]::WriteAllText((Join-Path $auditDir "$RunName.api.stderr.log"),$auditOffStderr.Result)
    @{pid=$auditOffProcess.Id;stopped=$auditOffProcess.HasExited;bundleSha256=$BundleSha;port4385Free=(@(Get-NetTCPConnection -LocalPort 4385 -State Listen -ErrorAction SilentlyContinue).Count -eq 0)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $auditDir "$RunName.owned-off-cleanup.json") -Encoding utf8
  }
}
exit $auditExit
