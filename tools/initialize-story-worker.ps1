param()

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectRoot 'cloudbaserc.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$environmentId = if ($env:TCB_ENV_ID) { $env:TCB_ENV_ID } else { [string]$config.envId }
if ([string]::IsNullOrWhiteSpace($environmentId)) {
  throw 'CloudBase environment ID is missing.'
}

$npxName = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
$npxCommand = Get-Command $npxName -ErrorAction Stop
$cliPrefix = @('--yes', '--package', '@cloudbase/cli@3.6.4', 'tcb')

Push-Location $projectRoot
try {
  & node (Join-Path $PSScriptRoot 'validate-cloudbase-build.js')
  if ($LASTEXITCODE -ne 0) { throw 'CloudBase build validation failed.' }

  $listOutput = & $npxCommand.Source @cliPrefix 'fn' 'list' '-e' $environmentId '--json' '--yes' 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the CloudBase function list.' }
  $listText = ($listOutput | Out-String)
  if ($listText -match '(?i)storyWorker') {
    throw 'storyWorker already exists. Initialization stopped to preserve its cloud environment variables.'
  }

  Write-Host 'Creating storyWorker with AI disabled and without an API key...'
  & $npxCommand.Source @cliPrefix 'fn' 'deploy' 'storyWorker' '-e' $environmentId '--deployMode' 'zip' '--force' '--yes'
  if ($LASTEXITCODE -ne 0) { throw "storyWorker initialization failed with exit code $LASTEXITCODE." }

  Write-Host 'storyWorker initialized safely.'
  Write-Host 'AI_ENABLED is false. Add TOKENHUB_API_KEY in the CloudBase console before enabling it.'
} finally {
  Pop-Location
}
