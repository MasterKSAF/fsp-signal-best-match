param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$privateDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex/private'
$envPath = Join-Path $privateDir 'signal-v060-check.env'
$manifestPath = Join-Path $privateDir 'signal-v060-check-process.json'
$nodePath = (Get-Command node -ErrorAction Stop).Source
if ($Stop) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No owned process manifest.' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $owned = Get-Process -Id $manifest.pid -ErrorAction SilentlyContinue
    if ($owned) {
        $commandLine = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $manifest.pid)).CommandLine
        if ($owned.StartTime.ToUniversalTime().Ticks -ne ([datetime]$manifest.startedAt).ToUniversalTime().Ticks -or -not $commandLine.Contains($envPath) -or -not $commandLine.Contains('artifacts/api-server/src/index.ts')) { throw 'Owned API identity differs; will not stop it.' }
        Stop-Process -Id $manifest.pid
    }
    if (Get-NetTCPConnection -LocalPort 4363 -State Listen -ErrorAction SilentlyContinue) { throw 'Listener remains; no foreign process will be stopped.' }
    Write-Output 'Owned v060 API stopped; isolated database retained.'
    return
}
if (Get-NetTCPConnection -LocalPort 4363 -State Listen -ErrorAction SilentlyContinue) { throw '4363 already occupied.' }
Push-Location $taskRoot
try {
    & $nodePath 'scripts/prepare-v060-check.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Owned database preparation failed.' }
    $child = Start-Process -FilePath $nodePath -ArgumentList @('--env-file=' + $envPath, '--import', 'tsx', 'artifacts/api-server/src/index.ts') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDir 'signal-v060-check-api.log') -RedirectStandardError (Join-Path $privateDir 'signal-v060-check-api-error.log') -PassThru
    $child.Refresh()
    @{ schemaVersion = 1; pid = $child.Id; startedAt = $child.StartTime.ToUniversalTime().ToString('o'); apiOrigin = 'http://127.0.0.1:4363'; database = 'signal_resume_v060_check' } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $child.Refresh()
        if ($child.HasExited) { throw 'Owned source API exited; private log retained.' }
        try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4363/api/healthz' -TimeoutSec 2; if ($health) { $healthy = $true; break } } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) { throw 'Owned source API health timeout; no foreign process touched.' }
    @{ schemaVersion = 1; passed = $true; startedAt = (Get-Date).ToUniversalTime().ToString('o'); pid = $child.Id; processStartedAt = $child.StartTime.ToUniversalTime().ToString('o'); apiOrigin = 'http://127.0.0.1:4363'; database = 'signal_resume_v060_check'; runtimeKind = 'source-tsx-targeted-only'; seeded = $false; existingStageTouched = $false; proofScope = 'Targeted functional tests; no performance or release binary claim.' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'outputs/verification/release-0.6.0/stand-ready.json') -Encoding utf8
    Write-Output ('Owned v060 source API ready on4363, PID ' + $child.Id + '; private environment outside source.')
} finally { Pop-Location }
