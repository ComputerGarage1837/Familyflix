[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackagePath, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$ffExpectedDeployment = 'C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom\deployment'
if ($PSScriptRoot -ne $ffExpectedDeployment) { throw 'Unexpected script directory.' }
for ($ffGuard = $PSScriptRoot; $ffGuard; $ffGuard = [IO.Path]::GetDirectoryName($ffGuard)) {
    if (((Get-Item -LiteralPath $ffGuard -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked script directory rejected.' }
}
$ffHelper = Get-Item -LiteralPath (Join-Path $PSScriptRoot 'family28-web-common.ps1') -Force
if (($ffHelper.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ffHelper.LinkType) { throw 'Linked helper rejected.' }
. $ffHelper.FullName
Assert-FFScriptRoot $PSScriptRoot
$ffConfig = Get-FFDeploymentConfig
$ffStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$ffBackupPath = $null
$ffServerBefore = $null
$ffServerAfter = $null
$ffIndexReplaced = $false
$ffCopied = New-Object 'System.Collections.Generic.List[string]'
$ffPhase = 'read-only preflight'

try {
    Write-Host 'Verifying the frozen package, every collision, protected files and the running Jellyfin process.'
    $ffPackage = Get-FFVerifiedPackage -PackagePath $PackagePath
    $ffManifest = $ffPackage.manifest
    $ffServerBefore = Get-FFServerState
    $ffLiveIndex = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative 'index.html' -MustExist -Kind File
    $ffIndexHash = Get-FFSha256 $ffLiveIndex
    $ffAlreadyInstalled = $ffIndexHash -eq $ffManifest.stagedIndexSha256
    if (-not $ffAlreadyInstalled -and $ffIndexHash -ne $ffConfig.OriginalIndexSha256) { throw 'The entry page changed since review.' }
    $ffBeforeFiles = @(Get-FFFileInventory -Root $ffConfig.WebRoot)
    Assert-FFOriginalFilesUnchanged -Original @($ffManifest.originalWebFiles) -Current $ffBeforeFiles -Root $ffConfig.WebRoot -IgnoreIndex:$ffAlreadyInstalled
    $ffPlan = Get-FFCollisionPlan -Assets @($ffManifest.assets) -LiveFiles $ffBeforeFiles -WebRoot $ffConfig.WebRoot
    if ($ffAlreadyInstalled -and $ffPlan.newFiles.Count -ne 0) { throw 'Installed entry page has missing assets.' }
    if ($VerifyOnly -or $ffAlreadyInstalled) {
        Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState)
        Write-Host 'Read-only verification passed. No result, package, backup or live file was written.'
        [pscustomobject]@{
            state = $(if ($ffAlreadyInstalled) { 'already-installed' } else { 'ready' })
            packagePath = $ffPackage.path; manifestSha256 = $ffPackage.manifestSha256
            newAssetCount = $ffPlan.newFiles.Count; identicalAssetCount = $ffPlan.sameFiles.Count
            indexSha256 = $ffIndexHash; server = $ffServerBefore
        } | ConvertTo-Json -Depth 8
        return
    }
    $ffIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $ffPrincipal = New-Object Security.Principal.WindowsPrincipal($ffIdentity)
    if (-not $ffPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Installation requires an operator-reviewed elevated PowerShell session. Verification does not.'
    }

    $ffPhase = 'verified rollback backup'
    $ffBackupPath = Join-FFRelativePath -Root $ffConfig.BackupRoot -Relative ('web-family28-' + $ffStamp) -Kind Directory
    New-FFDirectory -Root $ffConfig.BackupRoot -Path $ffBackupPath -MustBeNew
    $ffRollbackIndex = Join-FFRelativePath -Root $ffBackupPath -Relative 'index.html' -Kind File
    Copy-FFNewFile -SourceRoot $ffConfig.WebRoot -Source $ffLiveIndex -TargetRoot $ffBackupPath -Target $ffRollbackIndex -ExpectedHash $ffConfig.OriginalIndexSha256
    Copy-FFNewFile -SourceRoot $ffPackage.path -Source (Join-Path $ffPackage.path 'manifest.json') -TargetRoot $ffBackupPath -Target (Join-Path $ffBackupPath 'manifest.json') -ExpectedHash $ffPackage.manifestSha256
    $ffInventoryPath = Join-FFRelativePath -Root $ffBackupPath -Relative 'before-web-inventory.json' -Kind File
    # A named array member avoids Windows PowerShell 5's non-enumerating
    # ConvertFrom-Json behavior for a top-level JSON array during rollback.
    Write-FFNewText -Root $ffBackupPath -Path $ffInventoryPath -Text (@{ files = $ffBeforeFiles } | ConvertTo-Json -Depth 5)
    $ffBackupPlan = [ordered]@{
        schema = 1; release = $ffConfig.Release; packagePath = $ffPackage.path
        manifestSha256 = $ffPackage.manifestSha256; backupPath = $ffBackupPath
        originalIndexSha256 = $ffConfig.OriginalIndexSha256; installedIndexSha256 = $ffManifest.stagedIndexSha256
        beforeInventorySha256 = (Get-FFSha256 $ffInventoryPath); serverBefore = $ffServerBefore
    }
    Write-FFNewText -Root $ffBackupPath -Path (Join-Path $ffBackupPath 'deployment-plan.json') -Text ($ffBackupPlan | ConvertTo-Json -Depth 9)
    if ((Get-FFSha256 $ffRollbackIndex) -ne $ffConfig.OriginalIndexSha256) { throw 'Rollback copy did not verify.' }

    $ffPhase = 'copying new assets only'
    Write-Host ("Rollback verified at {0}. Copying at most {1} new assets; no existing asset is overwritten." -f $ffBackupPath, $ffPlan.newFiles.Count)
    foreach ($ffAsset in @($ffPlan.newFiles)) {
        $ffTarget = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative $ffAsset.path -Kind File
        if (Test-Path -LiteralPath $ffTarget) {
            if ((Get-FFSha256 $ffTarget) -ne $ffAsset.sha256) { throw "An asset collision appeared after preflight: $($ffAsset.path)" }
            continue
        }
        $ffSource = Join-FFRelativePath -Root $ffPackage.assetsRoot -Relative $ffAsset.path -MustExist -Kind File
        Copy-FFNewFile -SourceRoot $ffPackage.assetsRoot -Source $ffSource -TargetRoot $ffConfig.WebRoot -Target $ffTarget -ExpectedHash $ffAsset.sha256
        $ffCopied.Add([string]$ffAsset.path)
        if ($ffCopied.Count % 50 -eq 0) { Write-Host ("Copied and verified {0} new assets." -f $ffCopied.Count) }
    }
    $ffPendingIndex = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative ('familyflix-entry-family28-' + $ffStamp + '.pending') -Kind File
    Copy-FFNewFile -SourceRoot $ffPackage.path -Source $ffPackage.indexPath -TargetRoot $ffConfig.WebRoot -Target $ffPendingIndex -ExpectedHash $ffManifest.stagedIndexSha256
    $ffPhase = 'pre-commit verification'
    $ffPreCommitFiles = @(Get-FFFileInventory -Root $ffConfig.WebRoot)
    Assert-FFOriginalFilesUnchanged -Original $ffBeforeFiles -Current $ffPreCommitFiles -Root $ffConfig.WebRoot
    Assert-FFOriginalFilesUnchanged -Original @($ffManifest.assets) -Current $ffPreCommitFiles -Root $ffConfig.WebRoot
    Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState)
    [void](Get-FFSafePath -Root $ffConfig.WebRoot -Path $ffLiveIndex -MustExist -Kind File)
    [void](Get-FFSafePath -Root $ffConfig.WebRoot -Path $ffPendingIndex -MustExist -Kind File)
    $ffAtomicBackup = Join-FFRelativePath -Root $ffBackupPath -Relative 'index.atomic-rollback.html' -Kind File
    if (Test-Path -LiteralPath $ffAtomicBackup) { throw 'Atomic rollback destination already exists.' }
    if ((Get-FFSha256 $ffLiveIndex) -ne $ffConfig.OriginalIndexSha256 -or
        (Get-FFSha256 $ffRollbackIndex) -ne $ffConfig.OriginalIndexSha256 -or
        (Get-FFSha256 $ffPendingIndex) -ne $ffManifest.stagedIndexSha256) { throw 'Final entry-page/rollback hashes changed.' }

    $ffPhase = 'atomic entry-page replacement'
    # Never pass $null here: Windows PowerShell 5 can marshal it as an empty
    # filename. The explicit same-volume backup preserves a second old index.
    [IO.File]::Replace($ffPendingIndex, $ffLiveIndex, $ffAtomicBackup)
    $ffIndexReplaced = $true
    $ffPhase = 'post-install verification'
    if ((Get-FFSha256 $ffLiveIndex) -ne $ffManifest.stagedIndexSha256 -or
        (Get-FFSha256 $ffAtomicBackup) -ne $ffConfig.OriginalIndexSha256 -or
        (Get-FFSha256 $ffRollbackIndex) -ne $ffConfig.OriginalIndexSha256) { throw 'Installed/rollback entry-page verification failed.' }
    $ffAfterFiles = @(Get-FFFileInventory -Root $ffConfig.WebRoot)
    Assert-FFOriginalFilesUnchanged -Original $ffBeforeFiles -Current $ffAfterFiles -Root $ffConfig.WebRoot -IgnoreIndex
    Assert-FFOriginalFilesUnchanged -Original @($ffManifest.assets) -Current $ffAfterFiles -Root $ffConfig.WebRoot
    $ffServerAfter = Get-FFServerState
    Assert-FFSameServer -Before $ffServerBefore -After $ffServerAfter
    $ffResult = [ordered]@{
        success = $true; release = $ffConfig.Release; installedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        packagePath = $ffPackage.path; manifestSha256 = $ffPackage.manifestSha256; backupPath = $ffBackupPath
        originalIndexSha256 = $ffConfig.OriginalIndexSha256; installedIndexSha256 = (Get-FFSha256 $ffLiveIndex)
        copiedNewAssets = @($ffCopied.ToArray()); existingAssetsPreserved = $true
        serverBefore = $ffServerBefore; serverAfter = $ffServerAfter; serverRestarted = $false
        replacedFile = $ffLiveIndex; deletedFiles = @()
    }
    $ffResultText = $ffResult | ConvertTo-Json -Depth 12
    Write-FFNewText -Root $ffBackupPath -Path (Join-Path $ffBackupPath 'install-result.json') -Text $ffResultText
    Write-FFNewText -Root $ffConfig.DeploymentRoot -Path (Join-Path $ffConfig.DeploymentRoot ('install-family28-' + $ffStamp + '.json')) -Text $ffResultText
    Write-Host 'Installation verified. The Jellyfin process, stock version, configuration, existing assets and watchlist plugin are unchanged.'
    $ffResultText
} catch {
    $ffFailure = [ordered]@{
        success = $false; failedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); phase = $ffPhase
        backupPath = $ffBackupPath; indexReplaced = $ffIndexReplaced; copiedNewAssets = @($ffCopied.ToArray())
        serverBefore = $ffServerBefore; serverAfter = $ffServerAfter; message = $_.Exception.Message
        recovery = 'Nothing is deleted automatically. If indexReplaced is true, review the verified backup and rollback script before taking further action.'
    }
    if (-not $VerifyOnly) {
        $ffFailureText = $ffFailure | ConvertTo-Json -Depth 12
        try {
            Write-FFNewText -Root $ffConfig.DeploymentRoot -Path (Join-Path $ffConfig.DeploymentRoot ('install-family28-' + $ffStamp + '-failure.json')) -Text $ffFailureText
            if ($ffBackupPath -and (Test-Path -LiteralPath $ffBackupPath)) {
                Write-FFNewText -Root $ffBackupPath -Path (Join-Path $ffBackupPath 'install-failure.json') -Text $ffFailureText
            }
        } catch { Write-Warning ('Could not write every failure report: ' + $_.Exception.Message) }
    }
    throw
}
