param(
  [switch]$StaticOnly,
  [switch]$FunctionsOnly
)

$ErrorActionPreference = 'Stop'

if ($StaticOnly -and $FunctionsOnly) {
  throw 'StaticOnly and FunctionsOnly cannot be used together.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentId = if ($env:TCB_ENV_ID) {
  $env:TCB_ENV_ID
} else {
  'chulink-legacy-d8god1687a5d60743'
}
$cloudbaseCliVersion = '3.6.4'
$nodeCommand = Get-Command node -ErrorAction Stop
$localTcb = Join-Path $projectRoot 'node_modules\.bin\tcb.cmd'
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue

function Invoke-CloudBaseCli {
  param([Parameter(Mandatory = $true)][string[]]$CliArguments)

  if (Test-Path -LiteralPath $localTcb) {
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

Push-Location $projectRoot
try {
  & $nodeCommand.Source 'tools\validate-cloudbase-build.js'
  if ($LASTEXITCODE -ne 0) {
    throw 'CloudBase pre-deployment validation failed.'
  }

  & $nodeCommand.Source --check 'static\cloudbase-app.js'
  & $nodeCommand.Source --check 'cloudfunctions\appCore\index.js'
  & $nodeCommand.Source --check 'cloudfunctions\adminSubmissions\index.js'
  if ($LASTEXITCODE -ne 0) {
    throw 'JavaScript syntax validation failed.'
  }

  if (-not $StaticOnly) {
    Write-Host 'Deploying appCore...'
    Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'appCore', '-e', $environmentId, '--deployMode', 'zip', '--force')

    Write-Host 'Deploying adminSubmissions...'
    Invoke-CloudBaseCli -CliArguments @('fn', 'deploy', 'adminSubmissions', '-e', $environmentId, '--deployMode', 'zip', '--force')
  }

  if (-not $FunctionsOnly) {
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $hostingDirectory = Join-Path $temporaryParent ("chulink-cloudbase-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $hostingDirectory 'static') -Force | Out-Null

    try {
      Copy-Item -LiteralPath 'index.html','admin.html','hubei_boundary.geojson' -Destination $hostingDirectory
      Copy-Item -LiteralPath 'static\cloudbase-app.js','static\logo.png','static\map-config.js' -Destination (Join-Path $hostingDirectory 'static')

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
  Write-Host 'Site: https://chulink-legacy-d8god1687a5d60743-1458884983.tcloudbaseapp.com/'
} finally {
  Pop-Location
}
