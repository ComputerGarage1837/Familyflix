[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BackupPath, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$ffExpectedDeployment = 'C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom\deployment'
if ($PSScriptRoot -ne $ffExpectedDeployment) { throw 'Unexpected script directory.' }
for ($ffGuard = $PSScriptRoot; $ffGuard; $ffGuard = [IO.Path]::GetDirectoryName($ffGuard)) {
    if (((Get-Item -LiteralPath $ffGuard -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked script directory rejected.' }
}
$ffHelper = Get-Item -LiteralPath (Join-Path $PSScriptRoot 'family29-web-common.ps1') -Force
if (($ffHelper.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ffHelper.LinkType) { throw 'Linked helper rejected.' }
. $ffHelper.FullName
Assert-FFScriptRoot $PSScriptRoot
$ffConfig = Get-FFDeploymentConfig
$ffStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$ffValidatedBackup = $null
$ffServerBefore = $null
$ffServerAfter = $null
$ffRestored = $false

try {
    $ffValidatedBackup = Get-FFSafePath -Root $ffConfig.BackupRoot -Path $BackupPath -MustExist -Kind Directory
    if ((Split-Path -Parent $ffValidatedBackup) -ne $ffConfig.BackupRoot -or
        (Split-Path -Leaf $ffValidatedBackup) -notmatch '^web-family29-\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$') {
        throw 'Choose the exact timestamped family29 backup directory recorded by the installer.'
    }
    $ffPlanPath = Join-FFRelativePath -Root $ffValidatedBackup -Relative 'deployment-plan.json' -MustExist -Kind File
    $ffPlan = [IO.File]::ReadAllText($ffPlanPath) | ConvertFrom-Json
    if ($ffPlan.schema -ne 1 -or $ffPlan.release -ne $ffConfig.Release -or
        $ffPlan.backupPath -ne $ffValidatedBackup -or $ffPlan.originalIndexSha256 -ne $ffConfig.OriginalIndexSha256 -or
        $ffPlan.installedIndexSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Unexpected rollback plan.' }
    $ffManifestPath = Join-FFRelativePath -Root $ffValidatedBackup -Relative 'manifest.json' -MustExist -Kind File
    $ffInventoryPath = Join-FFRelativePath -Root $ffValidatedBackup -Relative 'before-web-inventory.json' -MustExist -Kind File
    if ((Get-FFSha256 $ffManifestPath) -ne $ffPlan.manifestSha256 -or
        (Get-FFSha256 $ffInventoryPath) -ne $ffPlan.beforeInventorySha256) { throw 'Backup manifest/inventory changed.' }
    $ffManifest = [IO.File]::ReadAllText($ffManifestPath) | ConvertFrom-Json
    if ($ffManifest.stagedIndexSha256 -ne $ffPlan.installedIndexSha256 -or
        $ffManifest.originalIndexSha256 -ne $ffConfig.OriginalIndexSha256) { throw 'Backup manifest and plan disagree.' }
    $ffOriginalIndex = Join-FFRelativePath -Root $ffValidatedBackup -Relative 'index.html' -MustExist -Kind File
    $ffLiveIndex = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative 'index.html' -MustExist -Kind File
    if ((Get-FFSha256 $ffOriginalIndex) -ne $ffConfig.OriginalIndexSha256) { throw 'The rollback entry page does not match the pinned original.' }
    $ffLiveHash = Get-FFSha256 $ffLiveIndex
    $ffAlreadyRestored = $ffLiveHash -eq $ffConfig.OriginalIndexSha256
    if (-not $ffAlreadyRestored -and $ffLiveHash -ne $ffPlan.installedIndexSha256) { throw 'Another deployment changed the live entry page; rollback is blocked.' }
    $ffServerBefore = Get-FFServerState
    Assert-FFSameServer -Before $ffPlan.serverBefore -After $ffServerBefore
    $ffBeforeFiles = @(Get-FFFileInventory -Root $ffConfig.WebRoot)
    $ffOldInventoryDocument = [IO.File]::ReadAllText($ffInventoryPath) | ConvertFrom-Json
    $ffOldInventory = @($ffOldInventoryDocument.files)
    [void](Get-FFRecordMap -Records $ffOldInventory -Root $ffConfig.WebRoot)
    Assert-FFOriginalFilesUnchanged -Original $ffOldInventory -Current $ffBeforeFiles -Root $ffConfig.WebRoot -IgnoreIndex
    if ($VerifyOnly -or $ffAlreadyRestored) {
        Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState)
        Write-Host 'Rollback verification passed. No file or result was written.'
        [pscustomobject]@{
            state = $(if ($ffAlreadyRestored) { 'already-restored' } else { 'ready-to-restore-index-only' })
            backupPath = $ffValidatedBackup; liveIndexSha256 = $ffLiveHash; restoreIndexSha256 = $ffConfig.OriginalIndexSha256
            server = $ffServerBefore
        } | ConvertTo-Json -Depth 8
        return
    }
    $ffIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $ffPrincipal = New-Object Security.Principal.WindowsPrincipal($ffIdentity)
    if (-not $ffPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Rollback requires an operator-reviewed elevated PowerShell session.' }
    $ffPending = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative ('familyflix-rollback-family29-' + $ffStamp + '.pending') -Kind File
    Copy-FFNewFile -SourceRoot $ffValidatedBackup -Source $ffOriginalIndex -TargetRoot $ffConfig.WebRoot -Target $ffPending -ExpectedHash $ffConfig.OriginalIndexSha256
    $ffRetiredIndex = Join-FFRelativePath -Root $ffValidatedBackup -Relative ('index.family29-before-rollback-' + $ffStamp + '.html') -Kind File
    if (Test-Path -LiteralPath $ffRetiredIndex) { throw 'Rollback safety-copy destination already exists.' }
    Assert-FFOriginalFilesUnchanged -Original $ffBeforeFiles -Current @(Get-FFFileInventory -Root $ffConfig.WebRoot) -Root $ffConfig.WebRoot
    Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState)
    [void](Get-FFSafePath -Root $ffConfig.WebRoot -Path $ffLiveIndex -MustExist -Kind File)
    [void](Get-FFSafePath -Root $ffConfig.WebRoot -Path $ffPending -MustExist -Kind File)
    [void](Get-FFSafePath -Root $ffValidatedBackup -Path $ffRetiredIndex -Kind File)
    if ((Get-FFSha256 $ffLiveIndex) -ne $ffPlan.installedIndexSha256 -or
        (Get-FFSha256 $ffPending) -ne $ffConfig.OriginalIndexSha256) { throw 'Entry-page hashes changed immediately before rollback.' }
    [IO.File]::Replace($ffPending, $ffLiveIndex, $ffRetiredIndex)
    $ffRestored = $true
    if ((Get-FFSha256 $ffLiveIndex) -ne $ffConfig.OriginalIndexSha256 -or
        (Get-FFSha256 $ffRetiredIndex) -ne $ffPlan.installedIndexSha256) { throw 'Restored and retired entry-page hashes did not verify.' }
    Assert-FFOriginalFilesUnchanged -Original $ffBeforeFiles -Current @(Get-FFFileInventory -Root $ffConfig.WebRoot) -Root $ffConfig.WebRoot -IgnoreIndex
    $ffServerAfter = Get-FFServerState
    Assert-FFSameServer -Before $ffServerBefore -After $ffServerAfter
    $ffResult = [ordered]@{
        success = $true; restoredAtUtc = (Get-Date).ToUniversalTime().ToString('o'); backupPath = $ffValidatedBackup
        restoredIndexSha256 = (Get-FFSha256 $ffLiveIndex); retiredFamily29Index = $ffRetiredIndex
        serverBefore = $ffServerBefore; serverAfter = $ffServerAfter; serverRestarted = $false
        existingAssetsPreserved = $true; deletedFiles = @()
    }
    $ffText = $ffResult | ConvertTo-Json -Depth 10
    Write-FFNewText -Root $ffValidatedBackup -Path (Join-Path $ffValidatedBackup ('rollback-result-' + $ffStamp + '.json')) -Text $ffText
    Write-FFNewText -Root $ffConfig.DeploymentRoot -Path (Join-Path $ffConfig.DeploymentRoot ('rollback-family29-' + $ffStamp + '.json')) -Text $ffText
    Write-Host 'The original entry page is restored. All new and old assets were retained; Jellyfin was not restarted.'
    $ffText
} catch {
    if (-not $VerifyOnly) {
        $ffFailure = [ordered]@{
            success = $false; failedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
            backupPath = $ffValidatedBackup; indexRestored = $ffRestored
            serverBefore = $ffServerBefore; serverAfter = $ffServerAfter; message = $_.Exception.Message
        }
        try {
            $ffText = $ffFailure | ConvertTo-Json -Depth 10
            Write-FFNewText -Root $ffConfig.DeploymentRoot -Path (Join-Path $ffConfig.DeploymentRoot ('rollback-family29-' + $ffStamp + '-failure.json')) -Text $ffText
            if ($ffValidatedBackup) {
                Write-FFNewText -Root $ffValidatedBackup -Path (Join-Path $ffValidatedBackup ('rollback-failure-' + $ffStamp + '.json')) -Text $ffText
            }
        } catch { Write-Warning ('Could not write every failure report: ' + $_.Exception.Message) }
    }
    throw
}
