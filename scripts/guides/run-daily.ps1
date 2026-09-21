$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectPath
$logDirectory = Join-Path $PSScriptRoot 'output/logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.log')
try {
  $nodePath = (Get-Command node.exe).Source
  & $nodePath --import ./scripts/guides/typescript-loader.mjs scripts/guides/index.ts --daily *> $logPath
  $resultCode = $LASTEXITCODE
} catch {
  $_.Exception.Message | Out-File -LiteralPath $logPath -Append
  $resultCode = 1
}
exit $resultCode
