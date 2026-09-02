<#
.SYNOPSIS
    DeadWax listening collector. Sits in the system tray, records every track
    Windows reports, and does nothing else.

.DESCRIPTION
    A stand-in for the real app while the real app does not exist yet. It exists
    to produce the one dataset nothing else can give us:

      * Last.fm gives LIFETIME TOTALS with no timestamps, so the shelf cannot be
        simulated accruing over time.
      * This gives TIMESTAMPED PLAYS WITH DWELL TIME, so we can finally ask
        "when would this record have pressed, and what did it look like a week
        in" -- and can tell a real listen from a four-second skip.

    Everything stays on this machine. No network calls of any kind. Output lands
    in scripts/smtc/dump/, which is gitignored.

    A play is counted as REAL using the standard scrobble rule: it played for at
    least half its duration, or four minutes, whichever comes first. Anything
    shorter is recorded but flagged, because pressing records off accidental
    skips would put albums on the shelf that were never listened to.

.PARAMETER IntervalSeconds
    Poll interval. 2 is plenty.

.PARAMETER Install
    Create a Startup shortcut so the collector runs at login. Remove it with
    -Uninstall, or by deleting the shortcut from shell:startup.

.PARAMETER Uninstall
    Remove the Startup shortcut.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\smtc\tray.ps1
#>

[CmdletBinding()]
param(
    [double] $IntervalSeconds = 2,
    [switch] $Install,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RepoRoot   = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'DeadWax Collector.lnk'

# --- install / uninstall the autostart shortcut ----------------------------
if ($Install) {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    # Through launch.vbs, never powershell.exe directly. powershell.exe is a
    # console app: Windows shows its console before the process can read
    # -WindowStyle Hidden, so that flag cannot prevent the flash. wscript.exe is
    # windowless and can. See the comment at the top of launch.vbs.
    $sc.TargetPath = 'wscript.exe'
    $sc.Arguments  = "`"$(Join-Path $PSScriptRoot 'launch.vbs')`""
    $sc.WorkingDirectory = $RepoRoot
    $sc.Description = 'DeadWax listening collector'
    $sc.Save()
    Write-Host "Installed. Runs at login."
    Write-Host "  $ShortcutPath"
    exit
}
if ($Uninstall) {
    if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force; Write-Host "Removed autostart shortcut." }
    else { Write-Host "No autostart shortcut was installed." }
    exit
}

# --- WinRT async bridge ----------------------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await {
    param($Operation, [Type] $ResultType)
    $task = $script:asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait(-1) | Out-Null
    $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$script:MgrType   = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$script:PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$script:Manager   = Await ($script:MgrType::RequestAsync()) $script:MgrType

# --- output ----------------------------------------------------------------
$script:DumpDir = Join-Path $PSScriptRoot "dump"
if (-not (Test-Path $script:DumpDir)) { New-Item -ItemType Directory -Path $script:DumpDir | Out-Null }
$script:OutFile  = Join-Path $script:DumpDir ("listens-" + (Get-Date -Format 'yyyyMMdd') + ".jsonl")
$script:Utf8     = New-Object System.Text.UTF8Encoding($false)

# --- uptime ledger ---------------------------------------------------------
# A listen file records what was heard. It cannot record what was MISSED, and
# without that the dataset quietly lies: a stretch with no plays reads the same
# whether nothing was playing or the collector was dead. On 2026-08-19 alone it
# was down across several windows and nothing on disk said so, which would have
# made every later claim about pressing rates unfalsifiable.
#
# So: one heartbeat file holding the last moment capture was known alive, and an
# append-only event log of starts, stops, pauses and the gaps between them. Any
# window not covered by a live collector is written down as a KNOWN BLIND SPOT
# rather than left to look like silence.
#
# Heartbeat resolution is $script:HeartbeatSec, so a gap is accurate to within
# that. Writing every poll would be exact and pointless -- 15s is far finer than
# any track.
$script:SessionFile   = Join-Path $script:DumpDir ("sessions-" + (Get-Date -Format 'yyyyMMdd') + ".jsonl")
$script:HeartbeatFile = Join-Path $script:DumpDir 'heartbeat.json'
$script:HeartbeatSec  = 15
$script:LastBeat      = [DateTime]::MinValue

function Write-Event {
    param([hashtable] $Record)
    try {
        $Record['ts'] = (Get-Date).ToString('o')
        $json = ($Record | ConvertTo-Json -Compress -Depth 4)
        [System.IO.File]::AppendAllText($script:SessionFile, $json + "`r`n", $script:Utf8)
    } catch { }
}

function Write-Heartbeat {
    param([switch] $Final)
    $stamp = Get-Date
    if (-not $Final -and ($stamp - $script:LastBeat).TotalSeconds -lt $script:HeartbeatSec) { return }
    $script:LastBeat = $stamp
    try {
        $beat = @{
            alive     = $stamp.ToString('o')
            collector = $PID
            cleanStop = [bool]$Final
            paused    = [bool]$script:Paused
        }
        [System.IO.File]::WriteAllText($script:HeartbeatFile,
            ($beat | ConvertTo-Json -Compress), $script:Utf8)
    } catch { }
}

# Everything between the previous collector's last breath and this one's first
# is a blind window. Recorded whether or not the stop was clean -- a deliberate
# quit still means listening went unrecorded, and the analysis has to know.
$script:BootGapFrom = $null
$script:BootGapWhy  = $null
if (Test-Path $script:HeartbeatFile) {
    try {
        $prev = Get-Content $script:HeartbeatFile -Raw | ConvertFrom-Json
        $script:BootGapFrom = [DateTime]::Parse($prev.alive, $null,
            [System.Globalization.DateTimeStyles]::RoundtripKind)
        $script:BootGapWhy = if ($prev.cleanStop) { 'collector was stopped' }
                             else { 'collector died, or the machine was off' }
    } catch { }
}
if ($script:BootGapFrom) {
    Write-Event @{
        event   = 'gap'
        from    = $script:BootGapFrom.ToString('o')
        to      = (Get-Date).ToString('o')
        seconds = [Math]::Round(((Get-Date) - $script:BootGapFrom).TotalSeconds, 1)
        reason  = $script:BootGapWhy
    }
}
Write-Event @{ event = 'start'; collector = $PID; intervalSec = $IntervalSeconds; heartbeatSec = $script:HeartbeatSec }
Write-Heartbeat

function Write-Listen {
    param([hashtable] $Record)
    $json = ($Record | ConvertTo-Json -Compress -Depth 6)
    [System.IO.File]::AppendAllText($script:OutFile, $json + "`r`n", $script:Utf8)
}

# --- state -----------------------------------------------------------------
# One in-flight entry per source app. Dwell is accumulated only while the
# session actually reports Playing, so leaving something paused for an hour does
# not manufacture a listen.
$script:Live      = @{}
$script:Written   = 0
$script:Skipped   = 0
$script:Recent    = New-Object System.Collections.ArrayList
$script:Paused    = $false

# Chrome does not hold a media session steady. A track can vanish and come back
# within a second or two, which splits one listen into two stub records --
# observed 2026-08-19, "PARTYNEXTDOOR- Something New" written twice, 2s then 14s.
# Anything too short to be a real listen is parked here rather than written, and
# either resumed by the next poll or retired by the sweep.
$script:Limbo     = @{}
$script:LimboSec  = 20.0
$script:StubSec   = 5.0
$script:StartedAt = Get-Date

function Flush-Entry {
    param($Entry, [string] $Why, [switch] $Final)
    if (-not $Entry) { return }

    # See $script:Limbo above. -Final is set only when there is no next poll to
    # resume from: the sweep giving up, or the collector shutting down.
    if (-not $Final -and $Entry.dwell -lt $script:StubSec) {
        $Entry.parkedAt = Get-Date
        $Entry.parkWhy  = $Why
        $script:Limbo[$Entry.identity] = $Entry
        return
    }
    $script:Limbo.Remove($Entry.identity)

    # Standard scrobble rule: half the track, or four minutes, whichever first.
    $threshold = if ($Entry.duration -gt 0) { [Math]::Min($Entry.duration / 2.0, 240.0) } else { 30.0 }
    $counted   = $Entry.dwell -ge $threshold

    Write-Listen @{
        ts              = $Entry.startedAt.ToString('o')
        endedAt         = (Get-Date).ToString('o')
        sourceApp       = $Entry.sourceApp
        title           = $Entry.title
        artist          = $Entry.artist
        albumTitle      = $Entry.albumTitle
        albumArtist     = $Entry.albumArtist
        trackNumber     = $Entry.trackNumber
        albumTrackCount = $Entry.albumTrackCount
        genres          = $Entry.genres
        playbackType    = $Entry.playbackType
        durationSec     = $Entry.duration
        dwellSec        = [Math]::Round($Entry.dwell, 1)
        counted         = $counted
        endReason       = $Why
    }

    if ($counted) { $script:Written++ } else { $script:Skipped++ }

    [void]$script:Recent.Insert(0, @{
        time    = (Get-Date -Format 'HH:mm')
        artist  = $Entry.artist
        title   = $Entry.title
        dwell   = $Entry.dwell
        counted = $counted
    })
    while ($script:Recent.Count -gt 12) { $script:Recent.RemoveAt($script:Recent.Count - 1) }
}

# SMTC hands over the album art as a WinRT stream reference. Pulling it into a
# .NET Bitmap is the only way to show the sleeve and to extract an accent colour
# from it. Failure here must never stop capture -- artwork is decoration, the
# listen is the data -- so every step is guarded and a miss returns $null.
# Resolve once: the single-argument AsStreamForRead overload.
$script:AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1

function Get-Thumbnail {
    param($Props)
    try {
        $ref = $Props.Thumbnail
        if (-not $ref) { return $null }
        $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if (-not $stream) { return $null }
        # PowerShell hands back a bare __ComObject with no WinRT projection, so
        # calling GetInputStreamAt on it fails outright. Reflection-invoking
        # AsStreamForRead marshals it to a real .NET Stream, which is the only
        # route that works from PowerShell.
        $net = $script:AsStreamForRead.Invoke($null, @($stream))
        if (-not $net) { return $null }
        return [System.Drawing.Image]::FromStream($net)
    } catch { return $null }
}

# A record is only written when a track ENDS, because dwell time is the point.
# That leaves in-flight tracks invisible and unrecoverable if the collector dies,
# so mirror live state to a snapshot on every poll. Overwritten, never appended.
function Write-Live {
    $live = @()
    foreach ($e in $script:Live.Values) {
        $live += @{
            sourceApp = $e.sourceApp
            artist    = $e.artist
            title     = $e.title
            album     = $e.albumTitle
            dwellSec  = [Math]::Round($e.dwell, 1)
            duration  = $e.duration
            startedAt = $e.startedAt.ToString('o')
        }
    }
    $snap = @{
        updatedAt = (Get-Date).ToString('o')
        counted   = $script:Written
        skipped   = $script:Skipped
        tracking  = $live
    }
    try {
        [System.IO.File]::WriteAllText(
            (Join-Path $script:DumpDir 'live.json'),
            ($snap | ConvertTo-Json -Depth 6),
            $script:Utf8)
    } catch { }
}

function Poll {
    if ($script:Paused) { return }

    $sessions = @()
    try { $sessions = @($script:Manager.GetSessions()) } catch { return }

    $seen = @{}

    foreach ($s in $sessions) {
        $app = $s.SourceAppUserModelId
        $seen[$app] = $true

        $p = $null
        try { $p = Await ($s.TryGetMediaPropertiesAsync()) $script:PropsType } catch { continue }
        if (-not $p -or -not $p.Title) { continue }

        $status = 'Unknown'
        try { $status = $s.GetPlaybackInfo().PlaybackStatus.ToString() } catch { }

        $duration = 0
        try { $duration = [Math]::Round($s.GetTimelineProperties().EndTime.TotalSeconds, 1) } catch { }

        $identity = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
        $entry = $script:Live[$app]

        if ($entry -and $entry.identity -ne $identity) {
            Flush-Entry $entry 'track changed'
            $entry = $null
        }

        # A parked stub for this exact track means the session flapped. Resume
        # it so the dwell keeps accumulating on one record.
        if (-not $entry -and $script:Limbo.ContainsKey($identity)) {
            $entry = $script:Limbo[$identity]
            $script:Limbo.Remove($identity)
            $entry.Remove('parkedAt'); $entry.Remove('parkWhy')
            $script:Live[$app] = $entry
        }

        if (-not $entry) {
            $genres = @()
            try { if ($p.Genres) { $genres = @($p.Genres) } } catch { }
            $entry = @{
                identity        = $identity
                sourceApp       = $app
                title           = $p.Title
                artist          = $p.Artist
                albumTitle      = $p.AlbumTitle
                albumArtist     = $p.AlbumArtist
                trackNumber     = $p.TrackNumber
                albumTrackCount = $p.AlbumTrackCount
                genres          = $genres
                playbackType    = $(if ($p.PlaybackType) { $p.PlaybackType.ToString() } else { $null })
                duration        = $duration
                dwell           = 0.0
                startedAt       = Get-Date
                art             = Get-Thumbnail $p
            }
            $script:Live[$app] = $entry
        }

        if ($status -eq 'Playing') { $entry.dwell += $IntervalSeconds }
        if ($duration -gt 0) { $entry.duration = $duration }
    }

    # A source that vanished (app closed) still owes us its final record.
    foreach ($app in @($script:Live.Keys)) {
        if (-not $seen.ContainsKey($app)) {
            Flush-Entry $script:Live[$app] 'source closed'
            $script:Live.Remove($app)
        }
    }

    Sweep-Limbo
    Write-Heartbeat
    Write-Live
    Update-Tip
}

# A stub nobody came back for was a genuine skip. Write it, uncounted.
function Sweep-Limbo {
    $now = Get-Date
    foreach ($k in @($script:Limbo.Keys)) {
        $e = $script:Limbo[$k]
        if (($now - $e.parkedAt).TotalSeconds -ge $script:LimboSec) {
            $why = $e.parkWhy
            $script:Limbo.Remove($k)
            $e.Remove('parkedAt'); $e.Remove('parkWhy')
            Flush-Entry $e $why -Final
        }
    }
}

function Update-Tip {
    $now = $null
    foreach ($e in $script:Live.Values) { if (-not $now -or $e.dwell -gt $now.dwell) { $now = $e } }
    $line = if ($now) { "{0} - {1}" -f $now.artist, $now.title } else { 'nothing playing' }
    # NotifyIcon text is capped at 63 characters and throws above it.
    $text = "DeadWax - $line"
    if ($text.Length -gt 62) { $text = $text.Substring(0, 59) + '...' }
    $script:Tray.Text = $text
}

# --- tray icon -------------------------------------------------------------
# Drawn rather than loaded. favicon-64.png is a web asset built to be read at
# 64px and downscaling it to a 16px tray slot turns the label ring into mush --
# at that size only about three shapes survive, so only three are drawn: a dark
# disc, one bone groove, and the orange spindle.
#
# Rendered at 32px and handed to Windows to scale down, because 32 is the size
# actually requested on a 150% display; drawing at 16 and letting it scale UP is
# what makes tray icons look chewed.
#
# The record dot goes grey while capture is paused, so the tray itself says
# whether anything is being recorded without opening the window.
function Get-TrayIcon {
    param([switch] $Paused)
    try {
        $size = 32
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = 'AntiAlias'
        $g.Clear([System.Drawing.Color]::Transparent)

        # the disc
        $disc = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 27, 25))
        $g.FillEllipse($disc, 1, 1, $size - 3, $size - 3)
        $disc.Dispose()

        # rim and one groove, in the app's bone
        $rim = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(232, 230, 227), 2)
        $g.DrawEllipse($rim, 1, 1, $size - 3, $size - 3)
        $rim.Dispose()
        $groove = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 232, 230, 227), 1)
        $g.DrawEllipse($groove, 7, 7, $size - 15, $size - 15)
        $groove.Dispose()

        # the spindle, orange while recording
        $col = if ($Paused) { [System.Drawing.Color]::FromArgb(120, 116, 110) }
               else { [System.Drawing.Color]::FromArgb(255, 90, 20) }
        $hub = New-Object System.Drawing.SolidBrush($col)
        $g.FillEllipse($hub, ($size / 2) - 4, ($size / 2) - 4, 8, 8)
        $hub.Dispose()
        $g.Dispose()

        $h = $bmp.GetHicon()
        return [System.Drawing.Icon]::FromHandle($h)
    } catch {
        return [System.Drawing.SystemIcons]::Application
    }
}

$script:Tray = New-Object System.Windows.Forms.NotifyIcon
$script:Tray.Icon = Get-TrayIcon
$script:Tray.Text = 'DeadWax - starting'
$script:Tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miStatus = $menu.Items.Add('Show status')
$miStatus.Add_Click({ try { Show-Status } catch { Write-Fault 'Show-Status' $_ } })

$miOpen = $menu.Items.Add('Open capture folder')
$miOpen.Add_Click({ Start-Process explorer.exe $script:DumpDir })

$miPause = $menu.Items.Add('Pause capture')
$miPause.Add_Click({
    $script:Paused = -not $script:Paused
    $miPause.Text = if ($script:Paused) { 'Resume capture' } else { 'Pause capture' }
    if ($script:Paused) { $script:Tray.Text = 'DeadWax - paused' }
    $script:Tray.Icon = Get-TrayIcon -Paused:$script:Paused
    Write-Event @{ event = $(if ($script:Paused) { 'pause' } else { 'resume' }) }
    Write-Heartbeat -Final:$false
})

[void]$menu.Items.Add('-')

$miQuit = $menu.Items.Add('Quit')
$miQuit.Add_Click({
    foreach ($app in @($script:Live.Keys)) { Flush-Entry $script:Live[$app] 'collector quit' -Final }
    foreach ($k in @($script:Limbo.Keys)) {
        $e = $script:Limbo[$k]; $script:Limbo.Remove($k)
        $e.Remove('parkedAt'); $e.Remove('parkWhy')
        Flush-Entry $e 'collector quit' -Final
    }
    Write-Event @{ event = 'stop'; reason = 'quit from tray menu' }
    Write-Heartbeat -Final
    $script:Tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$script:Tray.ContextMenuStrip = $menu

# --- status window --------------------------------------------------------
# Lives in ui.ps1 so the collector logic stays readable without wading
# through GDI+. Dot-sourced, so Show-Status sees the collector's state.
. (Join-Path $PSScriptRoot 'ui.ps1')

$script:Tray.Add_DoubleClick({ try { Show-Status } catch { Write-Fault 'Show-Status' $_ } })

# --- survive -----------------------------------------------------------------
# A collector that dies is worse than one that never ran: it stops recording and
# says nothing. WinForms' default for an unhandled exception on the UI thread is
# a modal crash dialog, and dismissing it takes the process with it -- observed
# 2026-08-19, the tray vanishing repeatedly with no trace on disk.
#
# Poll is already wrapped, but paint handlers, timers and menu clicks each run in
# their own scope and are not. Route all of them here: write the fault to
# dump/error.log and keep collecting. Losing one repaint is acceptable; losing
# the session is not.
function Write-Fault {
    param([string] $Where, $Err)
    try {
        $msg = "[{0}] {1}: {2}`r`n{3}`r`n" -f (Get-Date -Format 'o'), $Where,
            $Err.Exception.Message, $Err.ScriptStackTrace
        [System.IO.File]::AppendAllText((Join-Path $script:DumpDir 'error.log'), $msg, $script:Utf8)
    } catch { }
}

# No SetUnhandledExceptionMode call here on purpose: it throws outright once any
# control exists on the thread ("Thread exception mode cannot be changed once any
# Controls are created"), and the tray icon and menu are built well above this.
# It is not needed anyway -- the default mode already routes UI-thread faults to
# ThreadException, which is exactly what this handler takes over. Registering it
# is what replaces the modal crash dialog that was killing the collector.
[System.Windows.Forms.Application]::add_ThreadException({
    param($sender, $e)
    try {
        $msg = "[{0}] ThreadException: {1}`r`n{2}`r`n" -f (Get-Date -Format 'o'),
            $e.Exception.Message, $e.Exception.StackTrace
        [System.IO.File]::AppendAllText((Join-Path $script:DumpDir 'error.log'), $msg, $script:Utf8)
    } catch { }
})

# --- run -------------------------------------------------------------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [int]($IntervalSeconds * 1000)
$timer.Add_Tick({ try { Poll } catch { Write-Fault 'Poll' $_ } })
$timer.Start()

$script:Tray.ShowBalloonTip(4000, 'DeadWax DW-1',
    "Recording what plays. Double-click for the deck, right-click to stop.`nNothing leaves this machine.",
    [System.Windows.Forms.ToolTipIcon]::None)

[System.Windows.Forms.Application]::Run()
