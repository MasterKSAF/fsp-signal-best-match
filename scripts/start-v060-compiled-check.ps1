param([switch]$Stop, [string]$ExpectedBundleSha256)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$privateDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex/private'
$envPath = Join-Path $privateDir 'signal-v060-compiled-check.env'
$manifestPath = Join-Path $privateDir 'signal-v060-compiled-check-process.json'
$entry = 'artifacts/api-server/dist/index.mjs'
$bundlePath = Join-Path $taskRoot $entry
$nodePath = (Get-Command node -ErrorAction Stop).Source
if ($Stop) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No owned compiled process manifest.' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.runtimeKind -ne 'normal-delivery-targeted' -or $manifest.apiOrigin -ne 'http://127.0.0.1:4365' -or $manifest.database -ne 'signal_resume_v060_compiled_check') { throw 'Owned compiled target differs.' }
    $ownedEntry = $entry
    if ($manifest.runtimeEntryPath) {
        $ownedEntry = [IO.Path]::GetFullPath([string]$manifest.runtimeEntryPath)
        $ownedRelative = [IO.Path]::GetRelativePath($taskRoot, $ownedEntry)
        if ($ownedRelative -notmatch '^outputs[\\/]local-backup[\\/]v060-compiled-runtime-[a-f0-9]{12}[\\/]dist[\\/]index\.mjs$') { throw 'Owned runtime snapshot path differs.' }
    }
    $owned = Get-Process -Id $manifest.pid -ErrorAction SilentlyContinue
    if ($owned) {
        $line = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $manifest.pid)).CommandLine
        if ($owned.StartTime.ToUniversalTime().Ticks -ne ([datetime]$manifest.startedAt).ToUniversalTime().Ticks -or -not $line.Contains($envPath) -or -not $line.Contains($ownedEntry) -or $line.Contains('--import')) { throw 'Owned compiled API identity differs; no foreign process stopped.' }
        Stop-Process -Id $manifest.pid
    }
    if (Get-NetTCPConnection -LocalPort 4365 -State Listen -ErrorAction SilentlyContinue) { throw 'Listener remains; no foreign process will be stopped.' }
    Write-Output 'Owned compiled API stopped; isolated database retained.'
    return
}
if ($env:SIGNAL_V060_COMPILED_RELEASE -ne '1') { throw 'Explicit root-owned compiled check release required.' }
if ($ExpectedBundleSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Exact expected normal bundle SHA256 required.' }
if (Get-NetTCPConnection -LocalPort 4365 -State Listen -ErrorAction SilentlyContinue) { throw '4365 already occupied.' }
if ((Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedBundleSha256) { throw 'Normal compiled bundle differs before start.' }
$assets = @{}
foreach ($file in Get-ChildItem -LiteralPath (Split-Path $bundlePath) -File) { $assets[$file.Name] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
foreach ($worker in @('pino-file.mjs','pino-pretty.mjs','pino-worker.mjs','thread-stream-worker.mjs','quality-public-report.json')) { if (-not $assets.ContainsKey($worker)) { throw 'Required normal adjacent asset missing.' } }
Push-Location $taskRoot
try {
    & $nodePath 'scripts/prepare-v060-compiled-check.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Owned compiled database preparation failed.' }
    if ((Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedBundleSha256) { throw 'Bundle changed during preparation.' }
    $runtimeDir = Join-Path $taskRoot ('outputs/local-backup/v060-compiled-runtime-' + [Guid]::NewGuid().ToString('N').Substring(0,12) + '/dist')
    if (Test-Path -LiteralPath $runtimeDir) { throw 'New owned runtime snapshot unexpectedly exists.' }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    foreach ($file in $assets.Keys) {
        Copy-Item -LiteralPath (Join-Path (Split-Path $bundlePath) $file) -Destination (Join-Path $runtimeDir $file)
        if ((Get-FileHash -LiteralPath (Join-Path $runtimeDir $file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $assets[$file]) { throw 'Normal delivery copy differs.' }
    }
    # Normal delivery deliberately externalises nodemailer and its peers. The
    # private byte-identical snapshot needs the same dependency ancestor as the
    # normal api-server/dist directory; no dependency or bundle is rewritten.
    $dependencyTarget = (Resolve-Path -LiteralPath (Join-Path $taskRoot 'artifacts/api-server/node_modules')).Path
    $dependencyLink = Join-Path (Split-Path $runtimeDir) 'node_modules'
    if (Test-Path -LiteralPath $dependencyLink) { throw 'New owned dependency junction unexpectedly exists.' }
    New-Item -ItemType Junction -Path $dependencyLink -Target $dependencyTarget | Out-Null
    $linkInfo = Get-Item -LiteralPath $dependencyLink
    if ($linkInfo.LinkType -ne 'Junction' -or @($linkInfo.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string](@($linkInfo.Target)[0])) -ne [IO.Path]::GetFullPath($dependencyTarget)) { throw 'Owned dependency ancestor differs.' }
    $runtimeEntry = Join-Path $runtimeDir 'index.mjs'
    $child = Start-Process -FilePath $nodePath -ArgumentList @('--env-file=' + $envPath, ('"' + $runtimeEntry + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDir 'signal-v060-compiled-check-api.log') -RedirectStandardError (Join-Path $privateDir 'signal-v060-compiled-check-api-error.log') -PassThru
    $child.Refresh()
    $identity = @{schemaVersion=1;pid=$child.Id;startedAt=$child.StartTime.ToUniversalTime().ToString('o');apiOrigin='http://127.0.0.1:4365';database='signal_resume_v060_compiled_check';runtimeKind='normal-delivery-targeted';apiBundleSha256=$ExpectedBundleSha256;deliveryFiles=$assets;runtimeEntryPath=$runtimeEntry;normalDeliveryByteIdenticalSnapshot=$true;externalDependencies='Owned snapshot junction to the unchanged normal api-server/node_modules'}
    $identity | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $child.Refresh()
        if ($child.HasExited) { throw 'Owned compiled API exited; private log retained.' }
        try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4365/api/healthz' -TimeoutSec 2; if ($health) { $healthy=$true; break } } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) { throw 'Owned compiled API health timeout.' }
    foreach ($file in $assets.Keys) { if ((Get-FileHash -LiteralPath (Join-Path $runtimeDir $file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $assets[$file]) { throw 'Adjacent snapshot asset changed during startup.' } }
    $identity.passed=$true; $identity.generatedAt=(Get-Date).ToUniversalTime().ToString('o'); $identity.seededByRestart=$false; $identity.databaseReset=$false; $identity.existingStageTouched=$false; $identity.sourceBrowserStandTouched=$false
    if(Test-Path -LiteralPath (Join-Path $taskRoot 'outputs/verification/release-0.6.0/compiled-overview-seed.json')){$identity.priorOverviewSeedProof='outputs/verification/release-0.6.0/compiled-overview-seed.json'}
    $identity.proofScope='Normal compiled bundle executed on separate newly owned DB for targeted HTTP. No full load, browser, source ZIP or production acceptance claim.'
    $publicIdentity = $identity.Clone(); $publicIdentity.Remove('runtimeEntryPath'); $publicIdentity.runtimeSnapshotRelative=[IO.Path]::GetRelativePath($taskRoot,$runtimeDir).Replace('\','/')
    $publicIdentity | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot 'outputs/verification/release-0.6.0/compiled-stand-ready.json') -Encoding utf8
    Write-Output ('Owned normal compiled API ready on4365, PID ' + $child.Id + '; private environment outside source.')
} finally { Pop-Location }
