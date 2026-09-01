[CmdletBinding()]
param([switch]$VerifyOnly, [switch]$BuildVerifiedStable)
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
if (-not $VerifyOnly -and -not $BuildVerifiedStable) {
    throw 'First finish and verify the final production build. Then explicitly supply -BuildVerifiedStable to create a package.'
}

Write-Host 'Reading the pinned live state and final build. No server files are changed by preparation.'
$ffServerBefore = Get-FFServerState -PreparationBaseline
$ffPackageJson = Join-FFRelativePath -Root $ffConfig.RepoRoot -Relative 'package.json' -MustExist -Kind File
if (([IO.File]::ReadAllText($ffPackageJson) | ConvertFrom-Json).version -ne $ffConfig.StockVersion) { throw 'Source web package is not pinned to 10.11.5.' }
$ffLiveIndex = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative 'index.html' -MustExist -Kind File
if ((Get-FFSha256 $ffLiveIndex) -ne $ffConfig.OriginalIndexSha256) { throw 'Live entry page is not the reviewed original.' }
$ffBuiltIndex = Join-FFRelativePath -Root $ffConfig.DistRoot -Relative 'index.html' -MustExist -Kind File
$ffHtml = Get-FFStagedHtml -BuiltHtml ([IO.File]::ReadAllText($ffBuiltIndex)) -OriginalHtml ([IO.File]::ReadAllText($ffLiveIndex))
$ffDist = @(Get-FFFileInventory -Root $ffConfig.DistRoot)
$ffLive = @(Get-FFFileInventory -Root $ffConfig.WebRoot)
$ffAssets = @($ffDist | Where-Object { $ffConfig.Excluded -notcontains $_.path })
$ffExcluded = @($ffDist | Where-Object { $ffConfig.Excluded -contains $_.path })
if ($ffAssets.Count -eq 0 -or $ffExcluded.Count -ne 4) { throw 'Expected a full build with exactly the four excluded root files.' }
$ffPlan = Get-FFCollisionPlan -Assets $ffAssets -LiveFiles $ffLive -WebRoot $ffConfig.WebRoot
Assert-FFHtmlReferences -Html $ffHtml -Assets $ffAssets
Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState -PreparationBaseline)
$ffSummary = [ordered]@{
    release = $ffConfig.Release; stockVersion = $ffConfig.StockVersion
    newAssets = $ffPlan.newFiles.Count; identicalExistingAssets = $ffPlan.sameFiles.Count
    excluded = $ffConfig.Excluded; originalIndexSha256 = $ffConfig.OriginalIndexSha256
    stagedIndexSha256 = (Get-FFTextSha256 $ffHtml); server = $ffServerBefore
}
if ($VerifyOnly) {
    Write-Host 'Read-only verification passed. No package, result, backup or live file was written.'
    $ffSummary | ConvertTo-Json -Depth 8
    return
}

$ffStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$ffPackagePath = Join-FFRelativePath -Root $ffConfig.DeploymentRoot -Relative ('family28-package-' + $ffStamp) -Kind Directory
New-FFDirectory -Root $ffConfig.DeploymentRoot -Path $ffPackagePath -MustBeNew
$ffAssetsRoot = Join-FFRelativePath -Root $ffPackagePath -Relative 'assets' -Kind Directory
New-FFDirectory -Root $ffPackagePath -Path $ffAssetsRoot -MustBeNew
Write-Host ("Freezing {0} build assets into {1}" -f $ffAssets.Count, $ffPackagePath)
$ffCount = 0
foreach ($ffAsset in $ffAssets) {
    $ffSource = Join-FFRelativePath -Root $ffConfig.DistRoot -Relative $ffAsset.path -MustExist -Kind File
    $ffTarget = Join-FFRelativePath -Root $ffAssetsRoot -Relative $ffAsset.path -Kind File
    Copy-FFNewFile -SourceRoot $ffConfig.DistRoot -Source $ffSource -TargetRoot $ffAssetsRoot -Target $ffTarget -ExpectedHash $ffAsset.sha256
    $ffCount++
    if ($ffCount % 250 -eq 0) { Write-Host ("Frozen and verified {0}/{1} assets." -f $ffCount, $ffAssets.Count) }
}
Copy-FFNewFile -SourceRoot $ffConfig.WebRoot -Source $ffLiveIndex -TargetRoot $ffPackagePath -Target (Join-Path $ffPackagePath 'index.original.html') -ExpectedHash $ffConfig.OriginalIndexSha256
$ffBuiltHash = @($ffDist | Where-Object path -eq 'index.html')[0].sha256
Copy-FFNewFile -SourceRoot $ffConfig.DistRoot -Source $ffBuiltIndex -TargetRoot $ffPackagePath -Target (Join-Path $ffPackagePath 'index.built.html') -ExpectedHash $ffBuiltHash
Write-FFNewText -Root $ffPackagePath -Path (Join-Path $ffPackagePath 'index.html') -Text $ffHtml

# A completed manifest is published only after all frozen files and the unchanged
# live snapshot have been verified. An interrupted/failed package has no manifest.
Assert-FFOriginalFilesUnchanged -Original $ffAssets -Current @(Get-FFFileInventory -Root $ffAssetsRoot) -Root $ffAssetsRoot
Assert-FFOriginalFilesUnchanged -Original $ffLive -Current @(Get-FFFileInventory -Root $ffConfig.WebRoot) -Root $ffConfig.WebRoot
Assert-FFSameServer -Before $ffServerBefore -After (Get-FFServerState -PreparationBaseline)
$ffManifest = [ordered]@{
    schema = 1; release = $ffConfig.Release; createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    webRoot = $ffConfig.WebRoot; stockVersion = $ffConfig.StockVersion
    originalIndexSha256 = $ffConfig.OriginalIndexSha256; builtIndexSha256 = $ffBuiltHash
    stagedIndexSha256 = $ffSummary.stagedIndexSha256
    exactPreservedV4Tags = $ffConfig.V4Tags; protectedFiles = $ffConfig.ProtectedFiles
    serverBefore = $ffServerBefore; excludedDistFiles = $ffExcluded
    assets = $ffAssets; originalWebFiles = $ffLive
    newAssetCountAtPreparation = $ffPlan.newFiles.Count; sameAssetCountAtPreparation = $ffPlan.sameFiles.Count
}
Write-FFNewText -Root $ffPackagePath -Path (Join-Path $ffPackagePath 'preparation-summary.json') -Text ($ffSummary | ConvertTo-Json -Depth 8)
Write-FFNewText -Root $ffPackagePath -Path (Join-Path $ffPackagePath 'manifest.json') -Text ($ffManifest | ConvertTo-Json -Depth 12)
$ffVerified = Get-FFVerifiedPackage -PackagePath $ffPackagePath
Write-Host 'Package complete; no live files were changed. Review this manifest and then run the installer with -VerifyOnly.'
[pscustomobject]@{ packagePath = $ffPackagePath; manifestSha256 = $ffVerified.manifestSha256; summary = $ffSummary } | ConvertTo-Json -Depth 9
