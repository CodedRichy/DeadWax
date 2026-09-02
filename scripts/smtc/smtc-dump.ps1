<#
.SYNOPSIS
    Records what Windows' global media session (SMTC) actually reports, per source
    application, so the release-resolution work is designed against measured fields
    rather than assumed ones.

.DESCRIPTION
    DeadWax presses one record per album. That requires a trustworthy album title.
    Nobody has measured how often SMTC supplies one, or what shape it is in when it
    does -- Apple Music for Windows is suspected of packing "Artist - Album" into a
    single field, and browser tabs are suspected of supplying nothing at all.

    This script polls every media session on the machine and appends one JSON line
    each time a source's reported track changes. It never writes audio, never
    touches the network, and never sends anything anywhere. The output contains
    your listening, so it is gitignored -- see scripts/smtc/dump/.

    Run it, then listen normally across as many different players as you can:
    Spotify, Apple Music, a browser tab, a local file in foobar2000/MusicBee/VLC,
    YouTube, SoundCloud. The more sources, the more useful the report.

.PARAMETER Minutes
    Stop automatically after this many minutes. 0 (the default) runs until Ctrl-C.

.PARAMETER IntervalSeconds
    Seconds between polls. 2 is plenty; a track change is not a fast event.

.PARAMETER OutFile
    Override the output path. Defaults to scripts/smtc/dump/smtc-<timestamp>.jsonl

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\smtc\smtc-dump.ps1 -Minutes 60
#>

[CmdletBinding()]
param(
    [int]    $Minutes         = 0,
    [double] $IntervalSeconds = 2,
    [string] $OutFile
)

$ErrorActionPreference = 'Stop'

# --- WinRT async bridge -----------------------------------------------------
# PowerShell 5.1 cannot await an IAsyncOperation<T> directly. Reflect out the
# single-argument AsTask overload and drive it synchronously.
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await {
    param($Operation, [Type] $ResultType)
    $task = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait(-1) | Out-Null
    $task.Result
}

# Force the projected WinRT types to load before first use.
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession,        Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

$MgrType   = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

# --- Output -----------------------------------------------------------------
$dumpDir = Join-Path $PSScriptRoot 'dump'
if (-not (Test-Path $dumpDir)) { New-Item -ItemType Directory -Path $dumpDir | Out-Null }

if (-not $OutFile) {
    $stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutFile = Join-Path $dumpDir "smtc-$stamp.jsonl"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Line {
    param([hashtable] $Record)
    $json = ($Record | ConvertTo-Json -Compress -Depth 6)
    [System.IO.File]::AppendAllText($OutFile, $json + "`r`n", $utf8NoBom)
}

# --- Poll loop --------------------------------------------------------------
$manager  = Await ($MgrType::RequestAsync()) $MgrType
$lastSeen = @{}   # sourceAppId -> identity string of the last record written
$written  = 0
$deadline = if ($Minutes -gt 0) { (Get-Date).AddMinutes($Minutes) } else { [DateTime]::MaxValue }

Write-Host "SMTC field dump running."
Write-Host "  out      : $OutFile"
Write-Host "  interval : $IntervalSeconds s"
Write-Host ("  until    : {0}" -f $(if ($Minutes -gt 0) { $deadline.ToString('HH:mm:ss') } else { 'Ctrl-C' }))
Write-Host ""
Write-Host "Play music from as many different apps as you can. Spotify, Apple Music,"
Write-Host "a browser tab, YouTube, SoundCloud, a local file. Sources are the point."
Write-Host ""

while ((Get-Date) -lt $deadline) {

    $sessions = @()
    try { $sessions = $manager.GetSessions() } catch { $sessions = @() }

    foreach ($session in $sessions) {

        $sourceApp = $session.SourceAppUserModelId

        # Media properties can throw transiently while a source is starting up.
        $props = $null
        try { $props = Await ($session.TryGetMediaPropertiesAsync()) $PropsType } catch { continue }
        if (-not $props) { continue }

        # An identity that changes exactly when the reported track changes.
        $identity = "$sourceApp|$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
        if ($lastSeen[$sourceApp] -eq $identity) { continue }
        $lastSeen[$sourceApp] = $identity

        # Genres is an IReadOnlyList<string>; flatten it for JSON.
        $genres = @()
        try { if ($props.Genres) { $genres = @($props.Genres) } } catch { }

        $status   = $null
        $duration = $null
        $position = $null
        try {
            $playback = $session.GetPlaybackInfo()
            if ($playback) { $status = $playback.PlaybackStatus.ToString() }
        } catch { }
        try {
            $timeline = $session.GetTimelineProperties()
            if ($timeline) {
                $duration = [math]::Round($timeline.EndTime.TotalSeconds, 1)
                $position = [math]::Round($timeline.Position.TotalSeconds, 1)
            }
        } catch { }

        Write-Line @{
            ts              = (Get-Date).ToString('o')
            sourceApp       = $sourceApp
            title           = $props.Title
            artist          = $props.Artist
            albumTitle      = $props.AlbumTitle
            albumArtist     = $props.AlbumArtist
            subtitle        = $props.Subtitle
            trackNumber     = $props.TrackNumber
            albumTrackCount = $props.AlbumTrackCount
            genres          = $genres
            playbackType    = $(if ($props.PlaybackType) { $props.PlaybackType.ToString() } else { $null })
            playbackStatus  = $status
            durationSec     = $duration
            positionSec     = $position
        }

        $written++
        $album = if ([string]::IsNullOrWhiteSpace($props.AlbumTitle)) { '<no album>' } else { $props.AlbumTitle }
        Write-Host ("[{0,3}] {1,-34} {2} - {3}  ({4})" -f $written, $sourceApp, $props.Artist, $props.Title, $album)
    }

    Start-Sleep -Seconds $IntervalSeconds
}

Write-Host ""
Write-Host "Done. $written records -> $OutFile"
Write-Host "Report with: node scripts/smtc/smtc-report.js"
