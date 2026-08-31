# Pure synthetic regression checks; no live server reads, deployment or writes.
# Run this file in Windows PowerShell 5.1 and PowerShell 7 after code review.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'family24-web-common.ps1')

function New-FFFixtureState {
    param($Start)
    return [pscustomobject]@{
        processId = 12345; processStartUtc = $Start; processPath = 'C:\fixture\jellyfin.exe'
        stockVersion = '10.11.5'; pluginSha256 = 'fixture-plugin-hash'
    }
}

function Test-FFComparatorCase {
    param([string]$Name, $BeforeStart, $AfterStart, [switch]$Reject, [string]$ChangedField)
    $ffBefore = New-FFFixtureState -Start $BeforeStart
    $ffAfter = New-FFFixtureState -Start $AfterStart
    if ($ChangedField) { $ffAfter.$ChangedField = 'changed' }
    $ffRejected = $false
    try { Assert-FFSameServer -Before $ffBefore -After $ffAfter }
    catch { $ffRejected = $true }
    if ($ffRejected -ne $Reject.IsPresent) { throw "FAILED: $Name (rejected=$ffRejected; expected=$($Reject.IsPresent))." }
    return [pscustomobject]@{ test = $Name; result = 'passed' }
}

$ffIso = '2026-08-29T21:02:11.0365463Z'
$ffUtc = [DateTime]::ParseExact($ffIso, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
$ffOffset = [DateTimeOffset]::new($ffUtc).ToOffset([TimeSpan]::FromHours(-4))
$ffJsonState = '{"processStartUtc":"2026-08-29T21:02:11.0365463Z"}' | ConvertFrom-Json
$ffInvalid = '2026-02-30T21:02:11.0365463Z'
$ffUnspecified = [DateTime]::SpecifyKind($ffUtc, [DateTimeKind]::Unspecified)
$ffLocal = [DateTime]::SpecifyKind($ffUtc, [DateTimeKind]::Local)
$ffMinUtc = [DateTime]::SpecifyKind([DateTime]::MinValue, [DateTimeKind]::Utc)
$ffMaxUtc = [DateTime]::SpecifyKind([DateTime]::MaxValue, [DateTimeKind]::Utc)

$ffChecks = @(
    Test-FFComparatorCase 'identical strings' $ffIso $ffIso
    Test-FFComparatorCase 'parsed UTC DateTime / string' $ffUtc $ffIso
    Test-FFComparatorCase 'string / parsed UTC DateTime' $ffIso $ffUtc
    Test-FFComparatorCase 'identical UTC DateTime objects' $ffUtc $ffUtc
    Test-FFComparatorCase 'shell-native JSON date / string' $ffJsonState.processStartUtc $ffIso
    Test-FFComparatorCase 'explicit offset object / UTC string' $ffOffset $ffIso
    Test-FFComparatorCase 'explicit offset string / UTC string' '2026-08-29T17:02:11.0365463-04:00' $ffIso
    Test-FFComparatorCase 'one differing string tick' '2026-08-29T21:02:11.0365464Z' $ffIso -Reject
    Test-FFComparatorCase 'one differing DateTime tick' ($ffUtc.AddTicks(1)) $ffIso -Reject
    Test-FFComparatorCase 'invalid calendar date' $ffInvalid $ffInvalid -Reject
    Test-FFComparatorCase 'invalid date text' 'not-a-date' 'not-a-date' -Reject
    Test-FFComparatorCase 'date-only strings' '2026-08-29' '2026-08-29' -Reject
    Test-FFComparatorCase 'timestamp without offset' '2026-08-29T21:02:11.0365463' '2026-08-29T21:02:11.0365463' -Reject
    Test-FFComparatorCase 'invalid UTC offset' '2026-08-29T21:02:11.0365463+25:00' $ffIso -Reject
    Test-FFComparatorCase 'empty timestamp' '' '' -Reject
    Test-FFComparatorCase 'null before timestamp' $null $ffIso -Reject
    Test-FFComparatorCase 'null after timestamp' $ffIso $null -Reject
    Test-FFComparatorCase 'both timestamps null' $null $null -Reject
    Test-FFComparatorCase 'unspecified DateTime kind' $ffUnspecified $ffUnspecified -Reject
    Test-FFComparatorCase 'local DateTime kind' $ffLocal $ffLocal -Reject
    Test-FFComparatorCase 'minimum/default UTC date' $ffMinUtc $ffMinUtc -Reject
    Test-FFComparatorCase 'maximum UTC date' $ffMaxUtc $ffMaxUtc -Reject
    Test-FFComparatorCase 'unsupported integer timestamp' 42 42 -Reject
    Test-FFComparatorCase 'changed process id still fails' $ffUtc $ffIso -ChangedField processId -Reject
    Test-FFComparatorCase 'changed process path still fails' $ffUtc $ffIso -ChangedField processPath -Reject
    Test-FFComparatorCase 'changed stock version still fails' $ffUtc $ffIso -ChangedField stockVersion -Reject
    Test-FFComparatorCase 'changed plugin hash still fails' $ffUtc $ffIso -ChangedField pluginSha256 -Reject
)
$ffChecks | Format-Table -AutoSize
[pscustomobject]@{
    powerShell = $PSVersionTable.PSVersion.ToString(); passed = $ffChecks.Count
    jsonTimestampType = $ffJsonState.processStartUtc.GetType().FullName
    liveServerCalls = 0; writesPerformed = 0
} | ConvertTo-Json -Compress
