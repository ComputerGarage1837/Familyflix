[CmdletBinding()]
param([switch]$VerifyOnly, [switch]$ElevatedChild)

$ErrorActionPreference = 'Stop'
$ffExpectedRoot = 'C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom\deployment'
$ffExpectedPackage = Join-Path $ffExpectedRoot 'family29-package-20260901-174741-958-bb96896a'
$ffExpectedManifestHash = 'A3029683F645EED8505E5DE0047444E32CC13A74D72B35DD83417CA97A16C9EB'
$ffExpectedStagedIndexHash = 'EEA93D55BBE07DE744D7299FA49123677756D4484F531B8BDC38B38213A1B1F0'
$ffExpectedFiles = @(
    [pscustomobject]@{ path = (Join-Path $ffExpectedRoot 'family29-web-common.ps1'); sha256 = 'B3D1CB3FDD6476792AB9994789CDCD07F42C2C66121E9040598128C1730A76B7' }
    [pscustomobject]@{ path = (Join-Path $ffExpectedRoot 'install-family29-web.ps1'); sha256 = '1E4D6A1BB4EA2B5AFA5E78C19D6EDF6A67F80453A45C0F99163B6E4BBFB6C920' }
)

if ($PSScriptRoot -ne $ffExpectedRoot) { throw 'Unexpected reviewed-wrapper location.' }
foreach ($ffPath in @($PSScriptRoot, $ffExpectedPackage)) {
    $ffItem = Get-Item -LiteralPath $ffPath -Force
    if (($ffItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ffItem.LinkType) {
        throw 'Linked deployment paths are not allowed.'
    }
}
foreach ($ffExpected in $ffExpectedFiles) {
    $ffItem = Get-Item -LiteralPath $ffExpected.path -Force
    if (($ffItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ffItem.LinkType -or
        (Get-FileHash -LiteralPath $ffItem.FullName -Algorithm SHA256).Hash -ne $ffExpected.sha256) {
        throw ('A reviewed deployment script changed: ' + $ffItem.Name)
    }
}
$ffManifestPath = Join-Path $ffExpectedPackage 'manifest.json'
$ffIndexPath = Join-Path $ffExpectedPackage 'index.html'
if ((Get-FileHash -LiteralPath $ffManifestPath -Algorithm SHA256).Hash -ne $ffExpectedManifestHash -or
    (Get-FileHash -LiteralPath $ffIndexPath -Algorithm SHA256).Hash -ne $ffExpectedStagedIndexHash) {
    throw 'The reviewed Family .29 package changed.'
}
$ffManifest = Get-Content -LiteralPath $ffManifestPath -Raw | ConvertFrom-Json
if ($ffManifest.release -ne '0.19.10-family.29' -or
    $ffManifest.stagedIndexSha256 -ne $ffExpectedStagedIndexHash -or
    $ffManifest.originalIndexSha256 -ne 'B8499B8E2252AEB66A52CB25B671ED93F437FD442F4F668C1F7E194E95B713A7') {
    throw 'The reviewed manifest target is not Family .28 to Family .29.'
}

$ffInstaller = Join-Path $ffExpectedRoot 'install-family29-web.ps1'

function Get-FFInstallResults {
    return @(Get-ChildItem -LiteralPath $ffExpectedRoot -File | Where-Object {
        $_.Name -match '^install-family29-\d{8}-\d{6}-\d{3}-[a-f0-9]{8}(?:-failure)?\.json$'
    } | Select-Object -ExpandProperty FullName)
}

function Get-FFNewInstallResults([string[]]$Before) {
    $ffKnown = @{}
    foreach ($ffPath in $Before) { $ffKnown[$ffPath] = $true }
    return @(Get-FFInstallResults | Where-Object { -not $ffKnown.ContainsKey($_) })
}

function Assert-FFInstallResult([string]$ResultPath) {
    if ((Split-Path -Leaf $ResultPath) -match '-failure\.json$') { throw ('Installer recorded a failure: ' + $ResultPath) }
    $ffResult = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json
    if ($ffResult.success -ne $true -or $ffResult.release -ne '0.19.10-family.29' -or
        $ffResult.packagePath -ne $ffExpectedPackage -or $ffResult.manifestSha256 -ne $ffExpectedManifestHash -or
        $ffResult.originalIndexSha256 -ne $ffManifest.originalIndexSha256 -or
        $ffResult.installedIndexSha256 -ne $ffExpectedStagedIndexHash -or $ffResult.serverRestarted -ne $false -or
        $ffResult.existingAssetsPreserved -ne $true -or @($ffResult.deletedFiles).Count -ne 0) {
        throw 'The Family .29 installation result failed validation.'
    }
    foreach ($ffServer in @($ffResult.serverBefore, $ffResult.serverAfter)) {
        if ($ffServer.processId -ne 21324 -or $ffServer.stockVersion -ne '10.11.5' -or
            $ffServer.pluginSha256 -ne 'A90F7A91C26684F9A22AFB0F0EA7D81C0D643DEA871271C48EFCE98D86BD4745') {
            throw 'The recorded Jellyfin process, version, or plugin differs from the reviewed target.'
        }
    }
    if (([DateTimeOffset]([string]$ffResult.serverBefore.processStartUtc)).UtcTicks -ne
        ([DateTimeOffset]([string]$ffResult.serverAfter.processStartUtc)).UtcTicks) {
        throw 'The installation result reports a Jellyfin restart.'
    }
    $ffBackupRoot = 'C:\ProgramData\Jellyfin\Server\data\FamilyFlixWebBackups'
    $ffBackupPath = [IO.Path]::GetFullPath([string]$ffResult.backupPath).TrimEnd('\')
    if ((Split-Path -Parent $ffBackupPath) -ne $ffBackupRoot -or
        (Split-Path -Leaf $ffBackupPath) -notmatch '^web-family29-\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$') {
        throw 'The Family .29 result contains an unexpected backup path.'
    }
    $ffBackup = Get-Item -LiteralPath $ffBackupPath -Force
    if (-not $ffBackup.PSIsContainer -or ($ffBackup.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ffBackup.LinkType) {
        throw 'The Family .29 backup is missing or linked.'
    }
    $ffBackupResult = Join-Path $ffBackupPath 'install-result.json'
    if (-not (Test-Path -LiteralPath $ffBackupResult -PathType Leaf) -or
        (Get-FileHash -LiteralPath $ffBackupResult -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $ResultPath -Algorithm SHA256).Hash) {
        throw 'The local and rollback-copy installation results differ.'
    }
    if ((Get-FileHash -LiteralPath 'C:\Program Files\Jellyfin\Server\jellyfin-web\index.html' -Algorithm SHA256).Hash -ne
        $ffExpectedStagedIndexHash) { throw 'The live Family .29 entry page does not match the result.' }
    return [pscustomobject]@{ resultPath = $ResultPath; backupPath = $ffBackupPath; result = $ffResult }
}

function Invoke-FFInstallerVerification([string]$ExpectedState) {
    $ffLines = @(& $ffInstaller -PackagePath $ffExpectedPackage -VerifyOnly)
    $ffVerification = ($ffLines -join "`n") | ConvertFrom-Json
    if ($ffVerification.state -ne $ExpectedState -or $ffVerification.manifestSha256 -ne $ffExpectedManifestHash -or
        $ffVerification.indexSha256 -ne $(if ($ExpectedState -eq 'already-installed') {
            $ffExpectedStagedIndexHash
        } else { $ffManifest.originalIndexSha256 })) {
        throw ('Family .29 verification returned an unexpected state: ' + $ffVerification.state)
    }
    return $ffVerification
}

$ffLiveIndex = 'C:\Program Files\Jellyfin\Server\jellyfin-web\index.html'
$ffLiveHash = (Get-FileHash -LiteralPath $ffLiveIndex -Algorithm SHA256).Hash
if ($VerifyOnly) {
    $ffExpectedState = if ($ffLiveHash -eq $ffExpectedStagedIndexHash) { 'already-installed' }
        elseif ($ffLiveHash -eq $ffManifest.originalIndexSha256) { 'ready' }
        else { throw 'The live entry page is neither the reviewed Family .28 nor Family .29 page.' }
    Invoke-FFInstallerVerification $ffExpectedState | ConvertTo-Json -Depth 8
    return
}
if ($ffLiveHash -eq $ffExpectedStagedIndexHash) {
    [void](Invoke-FFInstallerVerification 'already-installed')
    [ordered]@{ success = $true; state = 'already-installed'; release = '0.19.10-family.29';
        installedIndexSha256 = $ffLiveHash } | ConvertTo-Json
    return
}
if ($ffLiveHash -ne $ffManifest.originalIndexSha256) { throw 'The live entry page is no longer the reviewed Family .28 baseline.' }

$ffResultsBefore = @(Get-FFInstallResults)

$ffIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$ffPrincipal = New-Object Security.Principal.WindowsPrincipal($ffIdentity)
$ffIsAdmin = $ffPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ffIsAdmin) {
    if ($ElevatedChild) { throw 'Elevation did not produce an administrator process.' }
    $ffPowerShell = Join-Path $PSHOME 'pwsh.exe'
    if (-not (Test-Path -LiteralPath $ffPowerShell -PathType Leaf)) { throw 'PowerShell 7 executable is unavailable.' }
    $ffArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath.Replace('"', '""') + '" -ElevatedChild'
    $ffChild = Start-Process -FilePath $ffPowerShell -ArgumentList $ffArguments -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    $ffNewResults = @(Get-FFNewInstallResults $ffResultsBefore)
    if ($ffChild.ExitCode -ne 0) {
        throw ('Elevated Family .29 installation failed with exit code ' + $ffChild.ExitCode +
            '. New result record(s): ' + $(if ($ffNewResults.Count) { $ffNewResults -join ', ' } else { 'none' }))
    }
} else {
    & $ffInstaller -PackagePath $ffExpectedPackage
    $ffNewResults = @(Get-FFNewInstallResults $ffResultsBefore)
}

if ($ffNewResults.Count -ne 1) { throw ('Expected exactly one new Family .29 result; found ' + $ffNewResults.Count) }
$ffValidated = Assert-FFInstallResult $ffNewResults[0]
if ($ElevatedChild) { return }
[void](Invoke-FFInstallerVerification 'already-installed')
[ordered]@{
    success = $true; state = 'installed-and-verified'; release = '0.19.10-family.29'
    resultPath = $ffValidated.resultPath; backupPath = $ffValidated.backupPath
    installedIndexSha256 = $ffExpectedStagedIndexHash; serverRestarted = $false
} | ConvertTo-Json
