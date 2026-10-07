param([switch]$Build)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$signalQaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signalQaProject = 'signal-qa-cycle-01'
$signalQaEnv = Join-Path $signalQaRoot '.env.qa-cycle-01.local'
Push-Location -LiteralPath $signalQaRoot
try {
  if (-not (Test-Path -LiteralPath $signalQaEnv)) {
    foreach ($signalQaPort in 4321,55435,8028) {
      if (Get-NetTCPConnection -LocalPort $signalQaPort -State Listen -ErrorAction SilentlyContinue) { throw "Isolated port $signalQaPort already occupied" }
    }
    $signalQaSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    @("SIGNAL_HTTP_PORT=4321", "SIGNAL_DB_PORT=55435", "SIGNAL_MAIL_PORT=8028", "POSTGRES_PASSWORD=signal-qa-local", "VERIFICATION_TOKEN_SECRET=$signalQaSecret") | Set-Content -LiteralPath $signalQaEnv -Encoding utf8
  }
  $signalQaConfig = docker compose --env-file $signalQaEnv -p $signalQaProject --profile full config --format json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Invalid isolated Compose config' }
  if ($signalQaConfig.services.app.ports[0].published -ne '4321' -or $signalQaConfig.services.db.ports[0].published -ne '55435' -or $signalQaConfig.services.mail.ports[0].published -ne '8028') { throw 'Isolated config points at unexpected ports' }
  if ($Build) {
    docker compose --env-file $signalQaEnv -p $signalQaProject --profile full build app
    if ($LASTEXITCODE -ne 0) { throw 'Isolated build failed' }
  }
  docker compose --env-file $signalQaEnv -p $signalQaProject --profile full up -d
  if ($LASTEXITCODE -ne 0) { throw 'Isolated startup failed' }
  Write-Output 'Isolated QA app: http://127.0.0.1:4321; DB:55435; Mailpit:8028. Working 4310 project not addressed.'
} finally { Pop-Location }
