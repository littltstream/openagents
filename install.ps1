param(
    [string]$ReleaseBase = 'https://github.com/littltstream/openagents/releases/latest/download',
    [string]$ArchivePath,
    [string]$InstallRoot = $(if ($env:CHIPPILOT_INSTALL_ROOT) { $env:CHIPPILOT_INSTALL_ROOT } else { Join-Path $env:USERPROFILE '.openagents' }),
    [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
$taskTemp = Join-Path ([IO.Path]::GetTempPath()) ('chippilot-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskTemp | Out-Null
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if ($nodePath) {
    $nodeVersionText = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersionText.TrimStart('v').Split('.')[0]) -lt 22) { $nodePath = $null }
}
if (-not $nodePath) {
    $nodeVersion = 'v22.22.3'
    $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    if ($architecture -notin @('x64','arm64')) { throw "Unsupported architecture: $architecture" }
    $nodeArchive = "node-$nodeVersion-win-$architecture.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/$nodeArchive" -OutFile (Join-Path $taskTemp $nodeArchive)
    Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -OutFile (Join-Path $taskTemp 'node-shasums.txt')
    $expectedLine = Get-Content (Join-Path $taskTemp 'node-shasums.txt') | Where-Object { $_ -match ([regex]::Escape($nodeArchive) + '$') }
    if (-not $expectedLine -or (Get-FileHash (Join-Path $taskTemp $nodeArchive) -Algorithm SHA256).Hash.ToLowerInvariant() -ne ($expectedLine -split '\s+')[0]) { throw 'Node.js archive checksum mismatch' }
    Expand-Archive (Join-Path $taskTemp $nodeArchive) (Join-Path $taskTemp 'node')
    $portableNode = Join-Path $InstallRoot 'chippilot-runtime'
    New-Item -ItemType Directory -Path $portableNode -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskTemp "node/node-$nodeVersion-win-$architecture/node.exe") -Destination (Join-Path $portableNode 'node.exe')
    $nodePath = Join-Path $portableNode 'node.exe'
}
if (-not $ArchivePath) {
    $manifest = Invoke-RestMethod ($ReleaseBase.TrimEnd('/') + '/release.json')
    $ArchivePath = Join-Path $taskTemp 'chippilot-cli.tgz'
    Invoke-WebRequest ($ReleaseBase.TrimEnd('/') + '/' + $manifest.cliAsset) -OutFile $ArchivePath
    if ((Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'CLI archive checksum mismatch' }
} else { $ArchivePath = (Resolve-Path -LiteralPath $ArchivePath).Path }
& tar -xzf $ArchivePath -C $taskTemp
if ($LASTEXITCODE -ne 0) { throw 'Could not extract CLI archive' }
& $nodePath (Join-Path $taskTemp 'package/installers/install.cjs') $InstallRoot $ArchivePath
if ($LASTEXITCODE -ne 0) { throw 'CLI installation failed' }
$commandDir = Join-Path $InstallRoot 'nodejs/node_modules/.bin'
if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path','User')
    if (($userPath -split ';') -notcontains $commandDir) { [Environment]::SetEnvironmentVariable('Path', "$commandDir;$userPath", 'User') }
    if (($env:PATH -split ';') -notcontains $commandDir) { $env:PATH = "$commandDir;$env:PATH" }
}
Write-Host 'Ready. Run: agn version'
