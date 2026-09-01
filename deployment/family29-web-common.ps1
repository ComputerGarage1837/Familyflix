# Shared guards only. Dot-sourcing this file does not write files or contact Jellyfin.
Set-StrictMode -Version Latest

function Get-FFDeploymentConfig {
    $ffRepo = 'C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom'
    [pscustomobject]@{
        Release = '0.19.10-family.29'
        RepoRoot = $ffRepo
        DeploymentRoot = (Join-Path $ffRepo 'deployment')
        DistRoot = (Join-Path $ffRepo 'dist')
        WebRoot = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
        ServerRoot = 'C:\Program Files\Jellyfin\Server'
        PluginRoot = 'C:\ProgramData\Jellyfin\Server\plugins\Family Flix Watchlists_1.0.0.4'
        PluginName = 'Jellyfin.Plugin.FamilyWatchlist.dll'
        PluginSha256 = 'A90F7A91C26684F9A22AFB0F0EA7D81C0D643DEA871271C48EFCE98D86BD4745'
        BackupRoot = 'C:\ProgramData\Jellyfin\Server\data\FamilyFlixWebBackups'
        StockVersion = '10.11.5'
        ProcessId = 21324
        OriginalIndexSha256 = 'B8499B8E2252AEB66A52CB25B671ED93F437FD442F4F668C1F7E194E95B713A7'
        Excluded = @('config.json', 'index.html', 'manifest.json', 'robots.txt')
        V4Tags = @('<link rel="stylesheet" href="familyflix-watchlist-v4.css?v=4">', '<script defer src="familyflix-watchlist-v4.js?v=4"></script>')
        ProtectedFiles = @(
            [pscustomobject]@{ path = 'config.json'; sha256 = '4C68B3678DA63EED7BD3E0E324D46D64B7040D10E491742FD807BC135CAD982C' }
            [pscustomobject]@{ path = 'manifest.json'; sha256 = '2671DD8F189C9190A71F9D32EDD721C07DFF4609237404C03E8F7741A16A376D' }
            [pscustomobject]@{ path = 'robots.txt'; sha256 = '331EA9090DB0C9F6F597BD9840FD5B171830F6E0B3BA1CB24DFA91F0C95AEDC1' }
            [pscustomobject]@{ path = 'familyflix-watchlist-v4.js'; sha256 = '3CA8F54AAAF9D39DB20DF9D5EE5390E780A941F6F83F09A3A9DBDF156C4350EC' }
            [pscustomobject]@{ path = 'familyflix-watchlist-v4.css'; sha256 = '91EF3982D468F0E2431A8AFC0F27C199656FBFCC59EA786BCEDEDEA6FAC0ABA5' }
        )
    }
}

function Get-FFSafePath {
    param([string]$Root, [string]$Path, [switch]$AllowRoot, [switch]$MustExist,
        [ValidateSet('Any', 'File', 'Directory')][string]$Kind = 'Any')
    foreach ($ffValue in @($Root, $Path)) {
        if ([string]::IsNullOrWhiteSpace($ffValue) -or $ffValue -notmatch '^[A-Za-z]:\\' -or
            $ffValue -match '[<>"|*?\x00-\x1f]' -or $ffValue.Substring(2).Contains(':')) {
            throw "A normal absolute drive path is required: $ffValue"
        }
        foreach ($ffPart in $ffValue.Substring(3).Split('\')) {
            if ($ffPart -eq '.' -or $ffPart -eq '..' -or $ffPart -match '[ .]$') {
                throw "Ambiguous path component rejected: $ffValue"
            }
        }
    }
    $ffRootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $ffFull = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $ffIsRoot = $ffFull.Equals($ffRootPath, [StringComparison]::OrdinalIgnoreCase)
    if (($ffIsRoot -and -not $AllowRoot) -or (-not $ffIsRoot -and
        -not $ffFull.StartsWith($ffRootPath + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw "Path escapes its intended directory: $ffFull"
    }
    # Check every existing ancestor, not only the final file. Never follow junctions,
    # symlinks or surfaced hard links, including links inside a staging package.
    $ffWalk = [IO.Path]::GetPathRoot($ffFull)
    $ffParts = @('') + @($ffFull.Substring($ffWalk.Length).Split('\'))
    $ffLeaf = $null
    foreach ($ffPart in $ffParts) {
        if ($ffPart) { $ffWalk = Join-Path $ffWalk $ffPart }
        $ffLeaf = Get-Item -LiteralPath $ffWalk -Force -ErrorAction SilentlyContinue
        if ($null -ne $ffLeaf) {
            if (($ffLeaf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                ($ffLeaf.PSObject.Properties['LinkType'] -and $ffLeaf.LinkType)) {
                throw "Linked/reparse paths are not allowed: $ffWalk"
            }
            if (-not $ffWalk.Equals($ffFull, [StringComparison]::OrdinalIgnoreCase) -and -not $ffLeaf.PSIsContainer) {
                throw "Non-directory ancestor: $ffWalk"
            }
        }
    }
    if ($MustExist -and $null -eq $ffLeaf) { throw "Required path is missing: $ffFull" }
    if ($null -ne $ffLeaf -and (($Kind -eq 'File' -and $ffLeaf.PSIsContainer) -or
        ($Kind -eq 'Directory' -and -not $ffLeaf.PSIsContainer))) { throw "Unexpected path type: $ffFull" }
    return $ffFull
}

function Join-FFRelativePath {
    param([string]$Root, [string]$Relative, [switch]$MustExist, [string]$Kind = 'Any')
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative.Contains('\') -or
        $Relative -match '(^/|//|[<>:"|*?\x00-\x1f])') { throw "Unsafe relative path: $Relative" }
    foreach ($ffPart in $Relative.Split('/')) {
        if ($ffPart -eq '.' -or $ffPart -eq '..' -or $ffPart -match '[ .]$' -or
            $ffPart -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw "Unsafe relative component: $Relative"
        }
    }
    return Get-FFSafePath -Root $Root -Path (Join-Path $Root $Relative.Replace('/', '\')) -MustExist:$MustExist -Kind $Kind
}

function Assert-FFScriptRoot {
    param([string]$ScriptRoot)
    $ffConfig = Get-FFDeploymentConfig
    $ffResolved = Get-FFSafePath -Root $ffConfig.DeploymentRoot -Path $ScriptRoot -AllowRoot -MustExist -Kind Directory
    if (-not $ffResolved.Equals($ffConfig.DeploymentRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Run the reviewed scripts from the expected deployment directory.'
    }
}

function Get-FFSha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-FFTextSha256 {
    param([string]$Text)
    $ffHasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($ffHasher.ComputeHash(([Text.UTF8Encoding]::new($false)).GetBytes($Text))).Replace('-', '') }
    finally { $ffHasher.Dispose() }
}

function New-FFDirectory {
    param([string]$Root, [string]$Path, [switch]$MustBeNew)
    $ffSafe = Get-FFSafePath -Root $Root -Path $Path -AllowRoot -Kind Directory
    if ($MustBeNew -and (Test-Path -LiteralPath $ffSafe)) { throw "Directory already exists: $ffSafe" }
    [void][IO.Directory]::CreateDirectory($ffSafe)
    [void](Get-FFSafePath -Root $Root -Path $ffSafe -AllowRoot -MustExist -Kind Directory)
}

function Write-FFNewText {
    param([string]$Root, [string]$Path, [string]$Text)
    $ffSafe = Get-FFSafePath -Root $Root -Path $Path -Kind File
    New-FFDirectory -Root $Root -Path (Split-Path -Parent $ffSafe)
    $ffStream = [IO.File]::Open($ffSafe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $ffBytes = ([Text.UTF8Encoding]::new($false)).GetBytes($Text)
        $ffStream.Write($ffBytes, 0, $ffBytes.Length)
        $ffStream.Flush($true)
    } finally { $ffStream.Dispose() }
}

function Copy-FFNewFile {
    param([string]$SourceRoot, [string]$Source, [string]$TargetRoot, [string]$Target, [string]$ExpectedHash)
    $ffSourcePath = Get-FFSafePath -Root $SourceRoot -Path $Source -MustExist -Kind File
    $ffTargetPath = Get-FFSafePath -Root $TargetRoot -Path $Target -Kind File
    if ((Get-FFSha256 $ffSourcePath) -ne $ExpectedHash) { throw "Source hash changed: $ffSourcePath" }
    New-FFDirectory -Root $TargetRoot -Path (Split-Path -Parent $ffTargetPath)
    $ffInput = [IO.File]::Open($ffSourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        # CreateNew, never Copy-Item -Force: even a file appearing after preflight
        # cannot be overwritten. A failed partial new file is retained for review.
        $ffOutput = [IO.File]::Open($ffTargetPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $ffInput.CopyTo($ffOutput); $ffOutput.Flush($true) }
        finally { $ffOutput.Dispose() }
    } finally { $ffInput.Dispose() }
    [void](Get-FFSafePath -Root $TargetRoot -Path $ffTargetPath -MustExist -Kind File)
    if ((Get-FFSha256 $ffTargetPath) -ne $ExpectedHash) { throw "Copied file hash mismatch: $ffTargetPath" }
}

function Get-FFFileInventory {
    param([string]$Root)
    $ffSafeRoot = Get-FFSafePath -Root $Root -Path $Root -AllowRoot -MustExist -Kind Directory
    $ffQueue = New-Object 'System.Collections.Generic.Queue[string]'
    $ffQueue.Enqueue($ffSafeRoot)
    $ffRows = New-Object 'System.Collections.Generic.List[object]'
    while ($ffQueue.Count -gt 0) {
        $ffDirectory = $ffQueue.Dequeue()
        [void](Get-FFSafePath -Root $Root -Path $ffDirectory -AllowRoot -MustExist -Kind Directory)
        foreach ($ffItem in @(Get-ChildItem -LiteralPath $ffDirectory -Force)) {
            $ffFull = Get-FFSafePath -Root $Root -Path $ffItem.FullName -MustExist
            if ($ffItem.PSIsContainer) { $ffQueue.Enqueue($ffFull) }
            else {
                $ffRows.Add([pscustomobject]@{
                    path = $ffFull.Substring($ffSafeRoot.Length + 1).Replace('\', '/')
                    length = [long]$ffItem.Length
                    sha256 = Get-FFSha256 $ffFull
                })
            }
        }
    }
    return $ffRows | Sort-Object path
}

function Get-FFRecordMap {
    param([object[]]$Records, [string]$Root)
    $ffMap = @{}
    foreach ($ffRecord in $Records) {
        [void](Join-FFRelativePath -Root $Root -Relative ([string]$ffRecord.path))
        if ($ffMap.ContainsKey([string]$ffRecord.path) -or $ffRecord.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
            [long]$ffRecord.length -lt 0) { throw "Invalid or duplicate manifest record: $($ffRecord.path)" }
        $ffMap[[string]$ffRecord.path] = $ffRecord
    }
    return $ffMap
}

function Assert-FFOriginalFilesUnchanged {
    param([object[]]$Original, [object[]]$Current, [string]$Root, [switch]$IgnoreIndex)
    $ffMap = Get-FFRecordMap -Records $Current -Root $Root
    foreach ($ffRecord in $Original) {
        if ($IgnoreIndex -and $ffRecord.path -eq 'index.html') { continue }
        if (-not $ffMap.ContainsKey([string]$ffRecord.path) -or
            $ffMap[[string]$ffRecord.path].sha256 -ne $ffRecord.sha256 -or
            [long]$ffMap[[string]$ffRecord.path].length -ne [long]$ffRecord.length) {
            throw "An existing file changed or disappeared: $($ffRecord.path)"
        }
    }
}

function Get-FFCollisionPlan {
    param([object[]]$Assets, [object[]]$LiveFiles, [string]$WebRoot)
    $ffMap = Get-FFRecordMap -Records $LiveFiles -Root $WebRoot
    $ffConflicts = @()
    $ffNew = @()
    $ffSame = @()
    foreach ($ffAsset in $Assets) {
        # Validate directories even when there is no destination file in inventory.
        [void](Join-FFRelativePath -Root $WebRoot -Relative $ffAsset.path -Kind File)
        if (-not $ffMap.ContainsKey([string]$ffAsset.path)) { $ffNew += $ffAsset }
        elseif ($ffMap[[string]$ffAsset.path].sha256 -eq $ffAsset.sha256 -and
            [long]$ffMap[[string]$ffAsset.path].length -eq [long]$ffAsset.length) { $ffSame += $ffAsset }
        else { $ffConflicts += $ffAsset.path }
    }
    if ($ffConflicts.Count) { throw ('Existing assets have different hashes; nothing may be copied: ' + ($ffConflicts -join ', ')) }
    return [pscustomobject]@{ newFiles = @($ffNew); sameFiles = @($ffSame) }
}

function Get-FFServerState {
    $ffConfig = Get-FFDeploymentConfig
    [void](Get-FFSafePath -Root $ffConfig.WebRoot -Path $ffConfig.WebRoot -AllowRoot -MustExist -Kind Directory)
    $ffExe = Join-FFRelativePath -Root $ffConfig.ServerRoot -Relative 'jellyfin.exe' -MustExist -Kind File
    $ffPlugin = Join-FFRelativePath -Root $ffConfig.PluginRoot -Relative $ffConfig.PluginName -MustExist -Kind File
    $ffProcesses = @(Get-Process -Name jellyfin -ErrorAction Stop)
    if ($ffProcesses.Count -ne 1 -or $ffProcesses[0].Id -ne $ffConfig.ProcessId) {
        throw 'The reviewed Jellyfin process changed. Stop and obtain a fresh operator review.'
    }
    $ffObservedProcessPath = $ffProcesses[0].Path
    $ffProcessPathObserved = -not [string]::IsNullOrWhiteSpace($ffObservedProcessPath)
    if ($ffProcessPathObserved -and -not $ffObservedProcessPath.Equals($ffExe, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The reviewed Jellyfin executable path changed.'
    }
    # A process started from an elevated tray hides Path from a normal token.
    # In that narrow case the exact PID/start instant, process name, pinned on-disk
    # executable version, protected-file fingerprints, and plugin hash remain the guard.
    if (-not $ffProcessPathObserved) { $ffObservedProcessPath = $ffExe }
    $ffVersion = (Get-Item -LiteralPath $ffExe).VersionInfo.ProductVersion
    if ($ffVersion -ne $ffConfig.StockVersion) { throw "Stock Jellyfin version changed: $ffVersion" }
    $ffPluginHash = Get-FFSha256 $ffPlugin
    if ($ffPluginHash -ne $ffConfig.PluginSha256) { throw 'The Family Watchlist plugin hash changed.' }
    $ffProtected = foreach ($ffExpected in $ffConfig.ProtectedFiles) {
        $ffPath = Join-FFRelativePath -Root $ffConfig.WebRoot -Relative $ffExpected.path -MustExist -Kind File
        $ffHash = Get-FFSha256 $ffPath
        if ($ffHash -ne $ffExpected.sha256) { throw "Protected live file changed: $($ffExpected.path)" }
        [pscustomobject]@{ path = $ffExpected.path; sha256 = $ffHash }
    }
    return [pscustomobject]@{
        processId = $ffProcesses[0].Id
        processStartUtc = $ffProcesses[0].StartTime.ToUniversalTime().ToString('o')
        processPath = $ffObservedProcessPath
        processPathObserved = $ffProcessPathObserved
        stockVersion = $ffVersion
        pluginSha256 = $ffPluginHash
        protectedFiles = @($ffProtected)
    }
}

function Assert-FFSameServer {
    param($Before, $After)
    # PS5 keeps JSON timestamps as strings; PS7 can deserialize them as UTC
    # DateTime objects. Compare exact instants, never localized date strings.
    $ffStartTicks = @(foreach ($ffState in @($Before, $After)) {
        $ffStart = $ffState.processStartUtc
        if ($ffStart -is [DateTime]) {
            if ($ffStart.Kind -ne [DateTimeKind]::Utc) { throw 'Process start DateTime must explicitly be UTC.' }
            $ffTicks = $ffStart.Ticks
        } elseif ($ffStart -is [DateTimeOffset]) {
            $ffTicks = $ffStart.UtcDateTime.Ticks
        } elseif ($ffStart -is [string]) {
            $ffParsed = [DateTimeOffset]::MinValue
            $ffFormats = [string[]]@("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", "yyyy-MM-dd'T'HH:mm:ss.fffffffzzz")
            if (-not [DateTimeOffset]::TryParseExact($ffStart, $ffFormats,
                [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$ffParsed)) {
                throw 'Process start timestamp must be a valid round-trip date with an explicit UTC offset.'
            }
            $ffTicks = $ffParsed.UtcDateTime.Ticks
        } else { throw 'Process start timestamp is missing or has an unsupported type.' }
        if ($ffTicks -eq [DateTime]::MinValue.Ticks -or $ffTicks -eq [DateTime]::MaxValue.Ticks) {
            throw 'A boundary/default date is not a valid recorded process start.'
        }
        [long]$ffTicks
    })
    if ($Before.processId -ne $After.processId -or $ffStartTicks[0] -ne $ffStartTicks[1] -or
        $Before.processPath -ne $After.processPath -or $Before.stockVersion -ne $After.stockVersion -or
        $Before.pluginSha256 -ne $After.pluginSha256) { throw 'Jellyfin process/version/plugin changed during the operation.' }
}

function Get-FFStagedHtml {
    param([string]$BuiltHtml, [string]$OriginalHtml)
    $ffConfig = Get-FFDeploymentConfig
    if ($BuiltHtml -notmatch '<meta\s+name="familyflix-web-build"\s+content="0\.19\.10-family\.29"\s*/?>' -or
        $BuiltHtml.Contains('familyflix-watchlist-v4')) { throw 'Unexpected build marker or pre-existing v4 injection in built HTML.' }
    $ffTags = @()
    foreach ($ffExpected in $ffConfig.V4Tags) {
        $ffMatches = [regex]::Matches($OriginalHtml, [regex]::Escape($ffExpected))
        if ($ffMatches.Count -ne 1) { throw 'The exact reviewed v4 link/script is not present once in the old entry page.' }
        $ffTags += $ffMatches[0].Value
    }
    if ([regex]::Matches($OriginalHtml, 'familyflix-watchlist-v4').Count -ne 2) { throw 'Unexpected additional v4 references.' }
    $ffFirst = [regex]::Match($BuiltHtml, '(?is)<script\b(?=[^>]*\bdefer(?:\s|=|>))[^>]*>')
    if (-not $ffFirst.Success) { throw 'No first deferred bundle script was found.' }
    return $BuiltHtml.Insert($ffFirst.Index, ($ffTags -join "`n") + "`n")
}

function Assert-FFHtmlReferences {
    param([string]$Html, [object[]]$Assets)
    $ffConfig = Get-FFDeploymentConfig
    $ffAvailable = @{}
    foreach ($ffAsset in $Assets) { $ffAvailable[[string]$ffAsset.path] = $true }
    foreach ($ffProtected in $ffConfig.ProtectedFiles) { $ffAvailable[[string]$ffProtected.path] = $true }
    foreach ($ffMatch in [regex]::Matches($Html, '(?is)<(?:script|link)\b[^>]*?\b(?:src|href)=["'']([^"'']+)["''][^>]*>')) {
        $ffReference = $ffMatch.Groups[1].Value
        if ($ffReference -match '^(?:[a-z]+:|//|/)') { throw "Unexpected non-local entry-page reference: $ffReference" }
        $ffRelative = [Uri]::UnescapeDataString(($ffReference -split '[?#]', 2)[0])
        [void](Join-FFRelativePath -Root $ffConfig.WebRoot -Relative $ffRelative)
        if (-not $ffAvailable.ContainsKey($ffRelative)) { throw "Entry page references an unstaged asset: $ffRelative" }
    }
}

function Get-FFVerifiedPackage {
    param([string]$PackagePath)
    $ffConfig = Get-FFDeploymentConfig
    $ffPackage = Get-FFSafePath -Root $ffConfig.DeploymentRoot -Path $PackagePath -MustExist -Kind Directory
    if ((Split-Path -Parent $ffPackage) -ne $ffConfig.DeploymentRoot -or
        (Split-Path -Leaf $ffPackage) -notmatch '^family29-package-\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$') {
        throw 'Choose a timestamped family29 package directly inside the reviewed deployment directory.'
    }
    $ffManifestPath = Join-FFRelativePath -Root $ffPackage -Relative 'manifest.json' -MustExist -Kind File
    $ffManifest = [IO.File]::ReadAllText($ffManifestPath) | ConvertFrom-Json
    if ($ffManifest.schema -ne 1 -or $ffManifest.release -ne $ffConfig.Release -or
        $ffManifest.webRoot -ne $ffConfig.WebRoot -or $ffManifest.stockVersion -ne $ffConfig.StockVersion -or
        $ffManifest.originalIndexSha256 -ne $ffConfig.OriginalIndexSha256 -or
        $ffManifest.stagedIndexSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Unexpected package schema, target or pinned version/hash.' }
    $ffAssetsRoot = Join-FFRelativePath -Root $ffPackage -Relative 'assets' -MustExist -Kind Directory
    $ffAssets = @($ffManifest.assets)
    if ($ffAssets.Count -eq 0) { throw 'Empty asset manifest.' }
    [void](Get-FFRecordMap -Records $ffAssets -Root $ffAssetsRoot)
    foreach ($ffAsset in $ffAssets) {
        if ($ffConfig.Excluded -contains $ffAsset.path) { throw "Protected file must never appear in the copy manifest: $($ffAsset.path)" }
    }
    $ffActualAssets = @(Get-FFFileInventory -Root $ffAssetsRoot)
    if ($ffActualAssets.Count -ne $ffAssets.Count) { throw 'The staged asset set has changed.' }
    Assert-FFOriginalFilesUnchanged -Original $ffAssets -Current $ffActualAssets -Root $ffAssetsRoot
    [void](Get-FFRecordMap -Records @($ffManifest.originalWebFiles) -Root $ffConfig.WebRoot)
    $ffOriginalPath = Join-FFRelativePath -Root $ffPackage -Relative 'index.original.html' -MustExist -Kind File
    $ffBuiltPath = Join-FFRelativePath -Root $ffPackage -Relative 'index.built.html' -MustExist -Kind File
    $ffIndexPath = Join-FFRelativePath -Root $ffPackage -Relative 'index.html' -MustExist -Kind File
    if ((Get-FFSha256 $ffOriginalPath) -ne $ffConfig.OriginalIndexSha256 -or
        (Get-FFSha256 $ffBuiltPath) -ne $ffManifest.builtIndexSha256 -or
        (Get-FFSha256 $ffIndexPath) -ne $ffManifest.stagedIndexSha256) { throw 'A packaged entry page hash changed.' }
    $ffExpectedHtml = Get-FFStagedHtml -BuiltHtml ([IO.File]::ReadAllText($ffBuiltPath)) -OriginalHtml ([IO.File]::ReadAllText($ffOriginalPath))
    if ((Get-FFTextSha256 $ffExpectedHtml) -ne $ffManifest.stagedIndexSha256) { throw 'Staged entry page is not exactly the built page plus the two preserved v4 tags.' }
    Assert-FFHtmlReferences -Html $ffExpectedHtml -Assets $ffAssets
    return [pscustomobject]@{
        path = $ffPackage; manifest = $ffManifest; manifestSha256 = (Get-FFSha256 $ffManifestPath)
        assetsRoot = $ffAssetsRoot; indexPath = $ffIndexPath
    }
}
