param([int]$Port=4317,[switch]$NoBrowser,[ValidateSet('codex','claude')][string]$Agent)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
Set-Location -LiteralPath $projectRoot
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw 'Установите Node.js 24.13 или новее.'}
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))){& npm.cmd ci --no-audit --no-fund;if($LASTEXITCODE){throw 'Не удалось установить зависимости'}}
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))){& npm.cmd run build;if($LASTEXITCODE){throw 'Сборка не прошла'}}
try{$health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2}catch{$health=$null}
if(-not $health){
 $env:AUTOMATION_PORT="$Port"
 if($Agent){$env:WORKSHOP_AGENT=$Agent}
 $nodePath=(Get-Command node).Source
 $tsxPath=Join-Path $projectRoot 'node_modules/tsx/dist/cli.mjs'
 $serverPath=Join-Path $projectRoot 'server/index.ts'
 New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'data') | Out-Null
 $process=Start-Process -FilePath $nodePath -ArgumentList @(('"'+$tsxPath+'"'),('"'+$serverPath+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data/service.log') -RedirectStandardError (Join-Path $projectRoot 'data/service-error.log') -PassThru
 $process.Id | Set-Content -LiteralPath (Join-Path $projectRoot 'data/service.pid')
 for($attempt=0;$attempt -lt 60;$attempt++){Start-Sleep -Milliseconds 500;try{$health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5;break}catch{}}
 if(-not $health){throw 'Сервис не запустился. Откройте data/service-error.log'}
}
if(-not $NoBrowser){& node --import tsx scripts/open-dashboard.ts $Port}
Write-Host "Мастерская работает: http://127.0.0.1:$Port. Закрытие окна не останавливает сервис."
