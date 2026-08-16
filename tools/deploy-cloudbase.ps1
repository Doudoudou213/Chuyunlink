param(
  [switch]$StaticOnly,
  [switch]$FunctionsOnly,
  [switch]$FullFunctionDeploy
)

$ErrorActionPreference = 'Stop'

if ($StaticOnly -and $FunctionsOnly) {
  throw 'StaticOnly and FunctionsOnly cannot be used together.'
}
if ($StaticOnly -and $FullFunctionDeploy) {
  throw 'FullFunctionDeploy cannot be combined with StaticOnly.'
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

function Invoke-CloudBaseCliCapture {
  param([Parameter(Mandatory = $true)][string[]]$CliArguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # CloudBase CLI writes progress messages to stderr even when the command succeeds.
    # Capture both streams without allowing PowerShell to promote those messages to terminating errors.
    $ErrorActionPreference = 'Continue'
    if ($localTcb) {
      $output = & $localTcb @CliArguments 2>&1
    } elseif ($npxCommand) {
      $output = & $npxCommand.Source --yes --package "@cloudbase/cli@$cloudbaseCliVersion" tcb @CliArguments 2>&1
    } else {
      throw 'CloudBase CLI was not found. Install Node.js/npm or add @cloudbase/cli as a dev dependency.'
    }
    $cliExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($cliExitCode -ne 0) {
    throw "CloudBase CLI failed with exit code $cliExitCode."
  }
  return $output
}

function Test-CloudBaseFunctionExists {
  param([Parameter(Mandatory = $true)][string]$FunctionName)

  $output = Invoke-CloudBaseCliCapture -CliArguments @('fn', 'list', '-e', $environmentId, '--json', '--yes')
  return (($output | Out-String) -match [regex]::Escape($FunctionName))
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
  $storyWorkerScript = Join-Path (Join-Path $cloudFunctionsDirectory 'storyWorker') 'index.js'
  $materialWorkerScript = Join-Path (Join-Path $cloudFunctionsDirectory 'materialWorker') 'index.js'

  Test-JavaScriptSyntax -ScriptPath $cloudbaseAppScript
  Test-JavaScriptSyntax -ScriptPath $appCoreScript
  Test-JavaScriptSyntax -ScriptPath $adminSubmissionsScript
  Test-JavaScriptSyntax -ScriptPath $storyWorkerScript
  Test-JavaScriptSyntax -ScriptPath $materialWorkerScript

  if (-not $StaticOnly) {
    if ($FullFunctionDeploy) {
      Write-Warning 'Full function deployment may update runtime configuration. Confirm cloud environment variables before using this mode.'
      Write-Host 'Fully deploying appCore...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'appCore', '-e', $environmentId, '--deployMode', 'zip', '--force')

      Write-Host 'Fully deploying adminSubmissions...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'adminSubmissions', '-e', $environmentId, '--deployMode', 'zip', '--force')
    } else {
      Write-Host 'Updating appCore code while preserving cloud configuration...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'code', 'update', 'appCore', '-e', $environmentId, '--deployMode', 'zip', '--yes')

      Write-Host 'Updating adminSubmissions code while preserving cloud configuration...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'code', 'update', 'adminSubmissions', '-e', $environmentId, '--deployMode', 'zip', '--yes')
    }

    if (Test-CloudBaseFunctionExists -FunctionName 'storyWorker') {
      Write-Host 'Updating storyWorker code while preserving its API key and cloud configuration...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'code', 'update', 'storyWorker', '-e', $environmentId, '--deployMode', 'zip', '--yes')
    } else {
      Write-Warning 'storyWorker is not initialized yet. Existing deployment continues without it.'
    }

    if (Test-CloudBaseFunctionExists -FunctionName 'materialWorker') {
      Write-Host 'Updating materialWorker code while preserving cloud configuration...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'code', 'update', 'materialWorker', '-e', $environmentId, '--deployMode', 'zip', '--yes')
    } else {
      Write-Host 'Creating materialWorker with its safe mock-only configuration...'
      Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'materialWorker', '-e', $environmentId, '--deployMode', 'zip', '--force')
    }
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
