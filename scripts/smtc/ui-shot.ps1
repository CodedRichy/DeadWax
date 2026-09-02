# Renders the collector's status window to a PNG so the design can be reviewed
# without clicking a tray icon. Populates state from the live snapshot when the
# collector is running, so the shot shows real artwork and a real accent.
param([string] $Out = "$PSScriptRoot\ui-shot.png")

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Live = @{}
$script:Recent = New-Object System.Collections.ArrayList
$script:Written = 0
$script:Skipped = 0
$script:StartedAt = (Get-Date).AddMinutes(-37)

# WinRT bridge, needed only to fetch real artwork for the preview.
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await { param($op,[Type]$rt)
    $t = $asTaskGeneric.MakeGenericMethod($rt).Invoke($null,@($op)); $t.Wait(-1)|Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]|Out-Null
$MgrType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

$art=$null; $title='Bout It'; $artist='PARTYNEXTDOOR'; $album='PARTYNEXTDOOR TWO'
$dur=205.1; $dwell=74.0; $src='Spotify.exe'
try {
  $mgr = Await ($MgrType::RequestAsync()) $MgrType
  foreach ($s in @($mgr.GetSessions())) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsType
    if (-not $p -or -not $p.Title) { continue }
    $title=$p.Title; $artist=$p.Artist; $album=$p.AlbumTitle; $src=$s.SourceAppUserModelId
    try { $dur=[Math]::Round($s.GetTimelineProperties().EndTime.TotalSeconds,1) } catch {}
    try {
      $ref=$p.Thumbnail
      if ($ref) {
        $asRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() |
          Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
        $st = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $art = [System.Drawing.Image]::FromStream($asRead.Invoke($null, @($st)))
      }
    } catch {}
    break
  }
} catch {}

$script:Live['preview'] = @{
    sourceApp=$src; title=$title; artist=$artist; albumTitle=$album
    duration=$dur; dwell=$dwell; art=$art; startedAt=(Get-Date)
}

foreach ($r in @(
    @{time='11:34'; artist='Major Lazer';   title='Lean On';                  dwell=176; counted=$true},
    @{time='11:30'; artist='Pitbull';       title='Give Me Everything';       dwell=252; counted=$true},
    @{time='11:27'; artist='Frank Ocean';   title='Nights';                   dwell=18;  counted=$false},
    @{time='11:26'; artist='PARTYNEXTDOOR'; title='Make It To The Morning';   dwell=168; counted=$true},
    @{time='11:22'; artist='Daft Punk';     title='Something About Us';       dwell=9;   counted=$false},
    @{time='11:21'; artist='Tyler, The Creator'; title='See You Again';       dwell=180; counted=$true}
)) { [void]$script:Recent.Add($r) }
$script:Written = 4; $script:Skipped = 2

. (Join-Path $PSScriptRoot 'ui.ps1')

$form = New-StatusForm
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 700
[System.Windows.Forms.Application]::DoEvents()

$bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
$form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0,0,$form.Width,$form.Height)))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$form.Close()
Write-Host "wrote $Out"
