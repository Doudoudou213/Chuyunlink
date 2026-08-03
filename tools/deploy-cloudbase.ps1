param(
  [switch]$StaticOnly,
  [switch]$FunctionsOnly
)

$ErrorActionPreference = 'Stop'

if ($StaticOnly -and $FunctionsOnly) {
  throw 'StaticOnly and FunctionsOnly cannot be used together.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cloudbaseConfigPath = Join-Path $projectRoot 'cloudbaserc.json'
$cloudbaseConfig = Get-Content -LiteralPath $cloudbaseConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$environmentId = if ($env:TCB_ENV_ID) {
  $env:TCB_ENV_ID
} else {
  [string]$cloudbaseConfig.envId
}
if ([string]::IsNullOrWhiteSpace($environmentId)) {
  throw 'CloudBase environment ID is missing. Set TCB_ENV_ID or cloudbaserc.json envId.'
}

$cloudbaseCliVersion = '3.6.4'
$nodeCommand = Get-Command node -ErrorAction Stop
$isWindowsHost = $env:OS -eq 'Windows_NT'
$localBinDirectory = Join-Path (Join-Path $projectRoot 'node_modules') '.bin'
$localTcb = $null
$localTcbNames = if ($isWindowsHost) { @('tcb.cmd', 'tcb') } else { @('tcb', 'tcb.cmd') }
foreach ($commandName in $localTcbNames) {
  $candidate = Join-Path $localBinDirectory $commandName
  if (Test-Path -LiteralPath $candidate) {
    $localTcb = $candidate
    break
  }
}

$npxCommand = $null
$npxCommandNames = if ($isWindowsHost) { @('npx.cmd', 'npx') } else { @('npx', 'npx.cmd') }
foreach ($commandName in $npxCommandNames) {
  $candidate = Get-Command $commandName -ErrorAction SilentlyContinue
  if ($candidate) {
    $npxCommand = $candidate
    break
  }
}

function Invoke-CloudBaseCli {
  param([Parameter(Mandatory = $true)][string[]]$CliArguments)

  if ($localTcb) {
    & $localTcb @CliArguments
  } elseif ($npxCommand) {
    & $npxCommand.Source --yes --package "@cloudbase/cli@$cloudbaseCliVersion" tcb @CliArguments
  } else {
    throw 'CloudBase CLI was not found. Install Node.js/npm or add @cloudbase/cli as a dev dependency.'
  }

  if ($LASTEXITCODE -ne 0) {
    throw "CloudBase CLI failed with exit code $LASTEXITCODE."
  }
}

function Test-JavaScriptSyntax {
  param([Parameter(Mandatory = $true)][string]$ScriptPath)

  & $nodeCommand.Source --check $ScriptPath
  if ($LASTEXITCODE -ne 0) {
    throw "JavaScript syntax validation failed: $ScriptPath"
  }
}

Push-Location $projectRoot
try {
  $validateScript = Join-Path $PSScriptRoot 'validate-cloudbase-build.js'
  & $nodeCommand.Source $validateScript
  if ($LASTEXITCODE -ne 0) {
    throw 'CloudBase pre-deployment validation failed.'
  }

  $staticDirectory = Join-Path $projectRoot 'static'
  $cloudFunctionsDirectory = Join-Path $projectRoot 'cloudfunctions'
  $cloudbaseAppScript = Join-Path $staticDirectory 'cloudbase-app.js'
  $appCoreScript = Join-Path (Join-Path $cloudFunctionsDirectory 'appCore') 'index.js'
  $adminSubmissionsScript = Join-Path (Join-Path $cloudFunctionsDirectory 'adminSubmissions') 'index.js'

  Test-JavaScriptSyntax -ScriptPath $cloudbaseAppScript
  Test-JavaScriptSyntax -ScriptPath $appCoreScript
  Test-JavaScriptSyntax -ScriptPath $adminSubmissionsScript

  if (-not $StaticOnly) {
    Write-Host 'Deploying appCore...'
    Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'appCore', '-e', $environmentId, '--deployMode', 'zip', '--force')

    Write-Host 'Deploying adminSubmissions...'
    Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'adminSubmissions', '-e', $environmentId, '--deployMode', 'zip', '--force')
  }

  if (-not $FunctionsOnly) {
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $hostingDirectory = Join-Path $temporaryParent ("chulink-cloudbase-" + [guid]::NewGuid().ToString('N'))
    $hostingStaticDirectory = Join-Path $hostingDirectory 'static'
    New-Item -ItemType Directory -Path $hostingStaticDirectory -Force | Out-Null

    try {
      $hostingRootFiles = @(
        (Join-Path $projectRoot 'index.html'),
        (Join-Path $projectRoot 'admin.html'),
        (Join-Path $projectRoot 'hubei_boundary.geojson')
      )
      $hostingStaticFiles = @(
        (Join-Path $staticDirectory 'cloudbase-app.js'),
        (Join-Path $staticDirectory 'logo.png'),
        (Join-Path $staticDirectory 'map-config.js')
      )
      Copy-Item -LiteralPath $hostingRootFiles -Destination $hostingDirectory
      Copy-Item -LiteralPath $hostingStaticFiles -Destination $hostingStaticDirectory

      Write-Host 'Deploying static hosting...'
      Invoke-CloudBaseCli -CliArguments @('hosting', 'deploy', $hostingDirectory, '-e', $environmentId, '--concurrency', '2', '--retry-count', '3')
    } finally {
      $resolvedHosting = [IO.Path]::GetFullPath($hostingDirectory)
      if ($resolvedHosting.StartsWith($temporaryParent, [StringComparison]::OrdinalIgnoreCase) -and
          (Split-Path $resolvedHosting -Leaf).StartsWith('chulink-cloudbase-')) {
        Remove-Item -LiteralPath $resolvedHosting -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }

  Write-Host 'CloudBase deployment completed.'
  Write-Host "Environment: $environmentId"
  if ($env:TCB_SITE_URL) {
    Write-Host "Site: $($env:TCB_SITE_URL)"
  }
} finally {
  Pop-Location
}
