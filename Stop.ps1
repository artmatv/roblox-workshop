$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
try { & node --import tsx scripts/stop-service.ts; if($LASTEXITCODE -eq 0){return} } catch {}
$pidFile=Join-Path $PSScriptRoot 'data/service.pid'
if(Test-Path -LiteralPath $pidFile){$servicePid=[int](Get-Content -LiteralPath $pidFile);$process=Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid";if($process -and $process.CommandLine -like ('*'+(Join-Path $PSScriptRoot 'server/index.ts')+'*')){Stop-Process -Id $servicePid;Write-Host 'Сервис остановлен. Состояние сохранено.'}else{Write-Host 'Процесс сервиса уже завершён.'}}
