<#
    Status window for the DeadWax collector.

    Dot-sourced by tray.ps1. Kept separate because the collector logic should be
    readable without wading through GDI+.

    DESIGN
    ------
    Teenage Engineering TP-7 in black titanium, on the app's own ground.

    The borrowing is not arbitrary. This tool IS a field recorder -- it sits
    running and captures what passes -- and the TP-7's dominant element is a
    circular platter, which is exactly where the album cover belongs. Clipped to
    a circle with groove rings and a spindle hub, the sleeve becomes a record
    label.

    The first cut of this was aluminium on white, faithful to the product shot
    and in direct conflict with DeadWax's settled near-black language. Black
    titanium resolves it: the industrial form survives, the palette is the app's
    own (Ground / Bone / Mute, per _brain/projects/deadwax.md), and the collector
    stops looking like a different product. The orange stays -- TE's own black
    units keep it, and one warm accent on a cold ground is what stops this
    reading as a terminal window.

    Per-sleeve accent survives as the ring around the platter and nothing else.
    Chrome does not change colour with the album; that was settled for the app
    and holds here.

    THREE GDI+ TRAPS, all hit on 2026-08-19 and all fixed here
    ---------------------------------------------------------
    1. SCOPE. A scriptblock passed to Add_Paint runs later, in its own scope, so
       ordinary locals from the enclosing function are $null by paint time.
       Everything the painter touches must be $script: scoped. The symptom is a
       wall of "Value cannot be null. Parameter name: font".

    2. FLICKER. A Form with a custom Paint handler is NOT double buffered, so
       each repaint clears then redraws and reads as a strobe on a timer.
       DoubleBuffered is protected, so it is set by reflection, and the timer
       invalidates only the regions that actually change.

    3. DEATH. An exception in a paint handler or a timer is unhandled, and
       WinForms answers that with a modal crash dialog that takes the whole
       collector down with it. Every handler here is wrapped and reports through
       Write-Fault in tray.ps1. Losing a repaint is acceptable; losing the
       capture session is not.

    CASE-INSENSITIVE VARIABLES. $bw and $BW are the same variable in PowerShell.
    A local button width silently overwrote the body width here once and every
    log row rendered as a lone ellipsis. Nothing in this file may shadow $BX,
    $BY, $BW or $BH -- the button width is $btnW everywhere, deliberately.
#>

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# --- palette: black titanium, bone, one orange -----------------------------
# Ground, Ink, Faint and Rule are the app's own values, not invented for this.
$script:C_Ground   = [System.Drawing.Color]::FromArgb(10, 10, 10)
$script:C_BodyTop  = [System.Drawing.Color]::FromArgb(54, 52, 49)
$script:C_BodyBot  = [System.Drawing.Color]::FromArgb(30, 29, 27)
$script:C_Edge     = [System.Drawing.Color]::FromArgb(76, 73, 69)
$script:C_Groove   = [System.Drawing.Color]::FromArgb(92, 89, 84)
$script:C_Ink      = [System.Drawing.Color]::FromArgb(232, 230, 227)
$script:C_Faint    = [System.Drawing.Color]::FromArgb(138, 134, 129)
$script:C_Dim      = [System.Drawing.Color]::FromArgb(90, 86, 82)
$script:C_Rule     = [System.Drawing.Color]::FromArgb(38, 35, 32)
$script:C_Oled     = [System.Drawing.Color]::FromArgb(6, 6, 6)
$script:C_OledInk  = [System.Drawing.Color]::FromArgb(236, 234, 231)
$script:C_Orange   = [System.Drawing.Color]::FromArgb(255, 90, 20)

# --- fonts: technical only. The TP-7 has no serif on it anywhere. ----------
$script:MonoName = 'Consolas'
try { $null = New-Object System.Drawing.FontFamily('Cascadia Mono'); $script:MonoName = 'Cascadia Mono' } catch { }
$script:SansName = 'Segoe UI'
foreach ($n in @('Aptos', 'Segoe UI Variable Display', 'Segoe UI')) {
    try { $null = New-Object System.Drawing.FontFamily($n); $script:SansName = $n; break } catch { }
}

function New-Mono { param([single]$Size, [System.Drawing.FontStyle]$St = 'Regular')
    New-Object System.Drawing.Font($script:MonoName, $Size, $St, [System.Drawing.GraphicsUnit]::Pixel) }
function New-Sans { param([single]$Size, [System.Drawing.FontStyle]$St = 'Regular')
    New-Object System.Drawing.Font($script:SansName, $Size, $St, [System.Drawing.GraphicsUnit]::Pixel) }

# Built once, at script scope, so the paint handler can always reach them.
$script:F_Model  = New-Sans 17
$script:F_Big    = New-Mono 16 'Bold'
$script:F_Title  = New-Mono 15 'Bold'
$script:F_Oled   = New-Mono 10
$script:F_OledS  = New-Mono 8 'Bold'
$script:F_Tiny   = New-Mono 8
$script:F_Micro  = New-Mono 8
$script:F_Row    = New-Mono 9

$script:Typo = [System.Drawing.StringFormat]::GenericTypographic

# --- helpers ---------------------------------------------------------------
function New-RoundRect {
    param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $R * 2
    $p.AddArc($X, $Y, $d, $d, 180, 90)
    $p.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
    $p.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
    $p.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-Text {
    param($G, [string]$Text, $Font, $Color, [single]$X, [single]$Y, [int]$MaxW = 0)
    if (-not $Text -or -not $Font) { return }
    $t = $Text
    if ($MaxW -gt 0) {
        while ($t.Length -gt 1 -and $G.MeasureString($t, $Font, 10000, $script:Typo).Width -gt $MaxW) {
            $t = $t.Substring(0, $t.Length - 2) + [char]0x2026
        }
    }
    $b = New-Object System.Drawing.SolidBrush($Color)
    $G.DrawString($t, $Font, $b, $X, $Y, $script:Typo)
    $b.Dispose()
}

# The TP-7's labels are widely letterspaced. GDI+ has no tracking, so the string
# is drawn a glyph at a time with the gap added manually.
function Draw-Tracked {
    param($G, [string]$Text, $Font, $Color, [single]$X, [single]$Y, [single]$Track = 3)
    if (-not $Text) { return }
    $b = New-Object System.Drawing.SolidBrush($Color)
    $x = $X
    foreach ($ch in $Text.ToCharArray()) {
        $s = [string]$ch
        $G.DrawString($s, $Font, $b, $x, $Y, $script:Typo)
        $x += $G.MeasureString($s, $Font, 10000, $script:Typo).Width + $Track
    }
    $b.Dispose()
}

function Measure-Tracked {
    param($G, [string]$Text, $Font, [single]$Track = 3)
    $w = 0
    foreach ($ch in $Text.ToCharArray()) {
        $w += $G.MeasureString([string]$ch, $Font, 10000, $script:Typo).Width + $Track
    }
    return $w
}

# --- accent extraction ------------------------------------------------------
# Bin by HUE, weight each pixel by its OWN saturation, average inside the
# winning bin only. Averaging across hues converges on grey -- that mistake cost
# real time once already.
function Get-Accent {
    param($Bmp)
    $fallback = $script:C_Groove
    if (-not $Bmp) { return $fallback }
    try {
        $bins = @{}
        $step = [Math]::Max(1, [int]($Bmp.Width / 24))
        for ($x = 0; $x -lt $Bmp.Width; $x += $step) {
            for ($y = 0; $y -lt $Bmp.Height; $y += $step) {
                $c = $Bmp.GetPixel($x, $y)
                $sat = $c.GetSaturation(); $bri = $c.GetBrightness()
                if ($sat -lt 0.22 -or $bri -lt 0.12 -or $bri -gt 0.94) { continue }
                $bin = [int]([Math]::Floor($c.GetHue() / 30.0))
                if (-not $bins.ContainsKey($bin)) { $bins[$bin] = @{ w = 0.0; r = 0.0; g = 0.0; b = 0.0 } }
                $e = $bins[$bin]
                $e.w += $sat; $e.r += $c.R * $sat; $e.g += $c.G * $sat; $e.b += $c.B * $sat
            }
        }
        if ($bins.Count -eq 0) { return $fallback }
        $best = $null
        foreach ($k in $bins.Keys) { if ($null -eq $best -or $bins[$k].w -gt $bins[$best].w) { $best = $k } }
        $e = $bins[$best]
        if ($e.w -le 0) { return $fallback }
        return [System.Drawing.Color]::FromArgb([int]($e.r / $e.w), [int]($e.g / $e.w), [int]($e.b / $e.w))
    } catch { return $fallback }
}

# Mean brightness of the sleeve, 0..1. Drives two decisions that a fixed value
# gets wrong half the time: how hard to veil the art, and whether the groove
# rings are drawn in black or in white.
#
# A fixed dark veil was the first attempt and it erased dark sleeves entirely --
# Calvin Harris' "How Deep Is Your Love" is near-black already, so knocking it
# back left an empty hole where the record should be. Bright sleeves still need
# the veil or the platter glows and unbalances the window. So: measure, then
# decide.
function Get-Brightness {
    param($Bmp)
    if (-not $Bmp) { return 0.5 }
    try {
        $sum = 0.0; $n = 0
        $step = [Math]::Max(1, [int]($Bmp.Width / 20))
        for ($x = 0; $x -lt $Bmp.Width; $x += $step) {
            for ($y = 0; $y -lt $Bmp.Height; $y += $step) {
                $sum += $Bmp.GetPixel($x, $y).GetBrightness(); $n++
            }
        }
        if ($n -eq 0) { return 0.5 }
        return $sum / $n
    } catch { return 0.5 }
}

# --- body ------------------------------------------------------------------
# Rendered once into a cached bitmap. The brushed texture is hundreds of
# hairlines; regenerating that on every repaint would be the actual performance
# bug, not the flicker.
function Get-BodyBitmap {
    param([int]$W, [int]$H, [int]$R)
    if ($script:BodyBmp -and $script:BodyBmp.Width -eq $W -and $script:BodyBmp.Height -eq $H) { return $script:BodyBmp }

    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'

    $path = New-RoundRect 0 0 ($W - 1) ($H - 1) $R
    $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $script:C_BodyTop, $script:C_BodyBot, 90.0)
    $g.FillPath($grad, $path)

    # Brushed metal: fine horizontal striation. On a dark body the highlight has
    # to carry the texture -- the shadow side has almost nowhere left to go, so
    # the warm white is what reads as titanium rather than as plastic.
    $rand = New-Object System.Random(7)
    $g.SetClip($path)
    for ($y = 0; $y -lt $H; $y += 2) {
        $a = $rand.Next(0, 13)
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a, 255, 250, 240), 1)
        $g.DrawLine($pen, 0, $y, $W, $y)
        $pen.Dispose()
        $a2 = $rand.Next(0, 16)
        $pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a2, 0, 0, 0), 1)
        $g.DrawLine($pen2, 0, $y + 1, $W, $y + 1)
        $pen2.Dispose()
    }
    $g.ResetClip()

    $penEdge = New-Object System.Drawing.Pen($script:C_Edge, 1)
    $g.DrawPath($penEdge, $path)
    $penEdge.Dispose(); $grad.Dispose(); $path.Dispose(); $g.Dispose()

    $script:BodyBmp = $bmp
    return $bmp
}

# ===========================================================================
# Split from Show-Status so the window can be built, painted and screenshotted
# without a human clicking a tray icon. Verify your own UI.
function New-StatusForm {

    $script:UW = 336; $script:UH = 560
    $script:BX = 22;  $script:BY = 20
    $script:BW = 292; $script:BH = 330
    $script:BtnY = 366; $script:BtnH = 48

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = 'None'
    $form.Size = New-Object System.Drawing.Size($script:UW, $script:UH)
    $form.StartPosition = 'CenterScreen'
    $form.BackColor = $script:C_Ground
    $form.ShowInTaskbar = $false
    $form.KeyPreview = $true

    # TRAP 2. DoubleBuffered is protected on Control, so reflection is the only
    # way to set it from PowerShell. Without it the window strobes on every tick.
    try {
        [System.Windows.Forms.Control].GetProperty('DoubleBuffered',
            [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic
        ).SetValue($form, $true, $null)
    } catch { }

    # A borderless form is a hard rectangle by default, which reads as a
    # screenshot rather than an object. Clip it so the ground ends in a radius
    # too, not just the body sitting inside it.
    $script:UForm = $form
    $regionPath = New-RoundRect 0 0 ($script:UW - 1) ($script:UH - 1) 18
    $form.Region = New-Object System.Drawing.Region($regionPath)
    $regionPath.Dispose()

    $script:Drag = $false
    $script:DragOrigin = New-Object System.Drawing.Point(0, 0)

    $form.Add_MouseDown({
        $script:Drag = $true
        $script:DragOrigin = [System.Windows.Forms.Cursor]::Position
    })
    $form.Add_MouseUp({
      try {
        $script:Drag = $false
        # button row hit-testing. $btnW, never $bw -- see the header.
        $x = $_.X; $y = $_.Y
        if ($y -ge $script:BtnY -and $y -le ($script:BtnY + $script:BtnH)) {
            $btnW = ($script:BW - 16) / 3
            if ($x -ge $script:BX -and $x -lt ($script:BX + $btnW)) {
                $script:Paused = -not $script:Paused
                $script:UForm.Invalidate()
            } elseif ($x -ge ($script:BX + $btnW + 8) -and $x -lt ($script:BX + 2 * $btnW + 8)) {
                Start-Process explorer.exe $script:DumpDir
            } elseif ($x -ge ($script:BX + 2 * $btnW + 16) -and $x -le ($script:BX + 3 * $btnW + 16)) {
                $script:UForm.Close()
            }
        }
      } catch {
        if (Get-Command Write-Fault -ErrorAction SilentlyContinue) { Write-Fault 'mouse' $_ }
      }
    })
    $form.Add_MouseMove({
        if ($script:Drag) {
            $p = [System.Windows.Forms.Cursor]::Position
            $script:UForm.Left += $p.X - $script:DragOrigin.X
            $script:UForm.Top  += $p.Y - $script:DragOrigin.Y
            $script:DragOrigin = $p
        }
    })
    $form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $script:UForm.Close() } })

    # Accent and artwork resolve once per window, not per paint.
    $nowE = $null
    foreach ($e in $script:Live.Values) { if ($null -eq $nowE -or $e.dwell -gt $nowE.dwell) { $nowE = $e } }
    $script:UArt = if ($nowE) { $nowE.art } else { $null }
    $script:UAccent = Get-Accent $script:UArt
    $script:UBright = Get-Brightness $script:UArt

    # TRAP 3. Guarded end to end.
    $form.Add_Paint({
      try {
        $g = $_.Graphics
        $g.SmoothingMode = 'AntiAlias'
        $g.TextRenderingHint = 'ClearTypeGridFit'
        $g.InterpolationMode = 'HighQualityBicubic'

        $BX = $script:BX; $BY = $script:BY; $BW = $script:BW; $BH = $script:BH

        # live state, re-read each paint so the readout moves
        $now = $null
        foreach ($e in $script:Live.Values) { if ($null -eq $now -or $e.dwell -gt $now.dwell) { $now = $e } }

        # ---------- body ----------
        $g.DrawImage((Get-BodyBitmap $BW $BH 28), $BX, $BY)

        # ---------- model label ----------
        Draw-Tracked $g 'DW-1' $script:F_Model $script:C_Ink ($BX + 18) ($BY + 15) 2

        # two pinholes, as on the original
        $dot = New-Object System.Drawing.SolidBrush($script:C_Dim)
        $g.FillEllipse($dot, $BX + 108, $BY + 24, 3, 3)
        $g.FillEllipse($dot, $BX + 131, $BY + 24, 3, 3)
        $dot.Dispose()

        # ---------- OLED ----------
        $ox = $BX + 166; $oy = $BY + 12; $ow = 108; $oh = 44
        $oledPath = New-RoundRect $ox $oy $ow $oh 9
        $oledBrush = New-Object System.Drawing.SolidBrush($script:C_Oled)
        $g.FillPath($oledBrush, $oledPath)
        # A black panel on a black body vanishes without an edge to sit in.
        $oledPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 0, 0, 0), 1)
        $g.DrawPath($oledPen, $oledPath)
        $oledPen.Dispose()

        $state = if ($script:Paused) { 'HOLD' } elseif ($now) { 'REC' } else { 'IDLE' }
        Draw-Tracked $g $state $script:F_Big $script:C_OledInk ($ox + 8) ($oy + 4) 1

        $d = if ($now) { [int]$now.dwell } else { 0 }
        $tot = if ($now) { [int]$now.duration } else { 0 }
        $clock = "{0}.{1:D2} / {2}.{3:D2}" -f [int]($d / 60), ($d % 60), [int]($tot / 60), ($tot % 60)
        Draw-Text $g $clock $script:F_Oled $script:C_OledInk ($ox + 8) ($oy + 26)

        # boxed counter, bottom-right of the display
        $cnt = "{0:D2}" -f [Math]::Min(99, $script:Written)
        $cw = $g.MeasureString($cnt, $script:F_OledS, 10000, $script:Typo).Width
        $bx2 = $ox + $ow - $cw - 12
        $boxPen = New-Object System.Drawing.Pen($script:C_OledInk, 1)
        $g.DrawRectangle($boxPen, $bx2 - 3, $oy + 27, $cw + 6, 12)
        Draw-Text $g $cnt $script:F_OledS $script:C_OledInk $bx2 ($oy + 28)
        $boxPen.Dispose(); $oledBrush.Dispose(); $oledPath.Dispose()

        # ---------- orange M badge ----------
        $mb = New-Object System.Drawing.SolidBrush($script:C_Orange)
        $g.FillRectangle($mb, $BX + 266, $BY + 72, 12, 12)
        Draw-Text $g 'M' $script:F_Micro ([System.Drawing.Color]::White) ($BX + 269) ($BY + 73)
        $mb.Dispose()

        # ---------- platter: the cover, as a record ----------
        $cx = $BX + 146; $cy = $BY + 160; $r = 84

        $ringPen = New-Object System.Drawing.Pen($script:C_Groove, 1)
        $g.DrawEllipse($ringPen, $cx - $r - 7, $cy - $r - 7, ($r + 7) * 2, ($r + 7) * 2)

        $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clip.AddEllipse($cx - $r, $cy - $r, $r * 2, $r * 2)
        $g.SetClip($clip)
        if ($script:UArt) {
            $g.DrawImage($script:UArt, $cx - $r, $cy - $r, $r * 2, $r * 2)
            # Veil in proportion to how bright the sleeve actually is: a loud
            # cover gets knocked back so the chrome stays the loudest thing, a
            # dark one is left alone because there is nothing to knock back.
            $veilA = [int](78 * [Math]::Max(0.0, ($script:UBright - 0.28)) / 0.72)
            if ($veilA -gt 4) {
                $veil = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($veilA, 10, 10, 10))
                $g.FillEllipse($veil, $cx - $r, $cy - $r, $r * 2, $r * 2)
                $veil.Dispose()
            }
        } else {
            $blank = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(34, 33, 31))
            $g.FillEllipse($blank, $cx - $r, $cy - $r, $r * 2, $r * 2)
            $blank.Dispose()
        }
        # Groove rings over the art, cut the way they will actually be seen:
        # black grooves on a bright sleeve, white on a dark one. Fixed black
        # rings simply vanish on a black cover.
        $grCol = if ($script:UBright -gt 0.42) { [System.Drawing.Color]::FromArgb(42, 0, 0, 0) }
                 else { [System.Drawing.Color]::FromArgb(34, 255, 255, 255) }
        $grPen = New-Object System.Drawing.Pen($grCol, 1)
        for ($i = 10; $i -lt $r - 22; $i += 6) {
            $g.DrawEllipse($grPen, $cx - $r + $i, $cy - $r + $i, ($r - $i) * 2, ($r - $i) * 2)
        }
        # the diagonal hairline from the original
        $diagPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 255, 255, 255), 1)
        $g.DrawLine($diagPen, $cx - $r, $cy + $r, $cx + $r, $cy - $r)
        $diagPen.Dispose(); $grPen.Dispose()
        $g.ResetClip()

        $accPen = New-Object System.Drawing.Pen($script:UAccent, 2)
        $g.DrawEllipse($accPen, $cx - $r, $cy - $r, $r * 2, $r * 2)
        $accPen.Dispose()

        # spindle
        $hub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(46, 44, 42))
        $g.FillEllipse($hub, $cx - 28, $cy - 28, 56, 56)
        $g.DrawEllipse($ringPen, $cx - 28, $cy - 28, 56, 56)
        $hole = New-Object System.Drawing.SolidBrush($script:C_Ground)
        $g.FillEllipse($hole, $cx - 4, $cy - 4, 8, 8)
        $hub.Dispose(); $hole.Dispose()

        # technical annotations, on the metal rather than on the sleeve
        $srcName = if ($now) { (($now.sourceApp -split '!')[0] -replace '\.exe$', '').ToUpper() } else { 'NO SOURCE' }
        $anY = $cy + $r + 10
        Draw-Tracked $g $srcName $script:F_Micro $script:C_Dim ($BX + 18) $anY 1.5
        $pollW = Measure-Tracked $g '2 s / poll' $script:F_Micro 1.5
        Draw-Tracked $g '2 s / poll' $script:F_Micro $script:C_Dim ($BX + $BW - 18 - $pollW) $anY 1.5
        $ringPen.Dispose()

        # ---------- dwell arm, left edge ----------
        $armX = $BX - 4; $armY = $BY + 70; $armH = 180
        $armPath = New-RoundRect $armX $armY 7 $armH 3.5
        $armFill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 36, 34))
        $g.FillPath($armFill, $armPath)
        $armPen = New-Object System.Drawing.Pen($script:C_Edge, 1)
        $g.DrawPath($armPen, $armPath)
        if ($now -and $now.duration -gt 0) {
            $frac = [Math]::Min(1.0, $now.dwell / $now.duration)
            $fh = [single]($armH * $frac)
            if ($fh -gt 4) {
                $fp = New-RoundRect $armX ($armY + $armH - $fh) 7 $fh 3.5
                $fb = New-Object System.Drawing.SolidBrush($script:C_Orange)
                $g.FillPath($fb, $fp); $fb.Dispose(); $fp.Dispose()
            }
        }
        $armFill.Dispose(); $armPen.Dispose(); $armPath.Dispose()

        # ---------- now playing, under the platter ----------
        $ty = $BY + 268
        if ($now) {
            Draw-Text $g $now.title $script:F_Title $script:C_Ink ($BX + 18) $ty ($BW - 36)
            $sub = if ($now.albumTitle) { "$($now.artist)  /  $($now.albumTitle)" } else { $now.artist }
            Draw-Text $g $sub $script:F_Tiny $script:C_Faint ($BX + 18) ($ty + 22) ($BW - 36)
        } else {
            Draw-Text $g 'no signal' $script:F_Title $script:C_Dim ($BX + 18) $ty
            Draw-Text $g 'nothing playing' $script:F_Tiny $script:C_Dim ($BX + 18) ($ty + 22)
        }

        # ---------- buttons ----------
        $btnW = ($BW - 16) / 3
        $glyphs = @('dot', 'tri', 'sq')
        for ($i = 0; $i -lt 3; $i++) {
            $bx3 = $BX + $i * ($btnW + 8)
            $p = New-RoundRect $bx3 $script:BtnY $btnW $script:BtnH 7
            $rectB = New-Object System.Drawing.Rectangle([int]$bx3, [int]$script:BtnY, [int]$btnW, [int]$script:BtnH)
            $gr = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectB, $script:C_BodyTop, $script:C_BodyBot, 90.0)
            $g.FillPath($gr, $p)
            $pen = New-Object System.Drawing.Pen($script:C_Edge, 1)
            $g.DrawPath($pen, $p)

            $gcx = $bx3 + $btnW / 2; $gcy = $script:BtnY + $script:BtnH / 2
            switch ($glyphs[$i]) {
                'dot' {
                    $col = if ($script:Paused) { $script:C_Dim } else { $script:C_Orange }
                    $b = New-Object System.Drawing.SolidBrush($col)
                    $g.FillEllipse($b, $gcx - 6, $gcy - 6, 12, 12); $b.Dispose()
                }
                'tri' {
                    $b = New-Object System.Drawing.SolidBrush($script:C_Ink)
                    $pts = @(
                        (New-Object System.Drawing.PointF(($gcx - 5), ($gcy - 6))),
                        (New-Object System.Drawing.PointF(($gcx + 6), $gcy)),
                        (New-Object System.Drawing.PointF(($gcx - 5), ($gcy + 6)))
                    )
                    $g.FillPolygon($b, $pts); $b.Dispose()
                }
                'sq' {
                    $b = New-Object System.Drawing.SolidBrush($script:C_Ink)
                    $g.FillRectangle($b, $gcx - 5, $gcy - 5, 11, 11); $b.Dispose()
                }
            }
            $gr.Dispose(); $pen.Dispose(); $p.Dispose()
        }
        $capY = $script:BtnY + $script:BtnH + 5
        Draw-Tracked $g 'HOLD'  $script:F_Micro $script:C_Dim ($BX + 16) $capY 1.5
        Draw-Tracked $g 'FILES' $script:F_Micro $script:C_Dim ($BX + $btnW + 18) $capY 1.5
        Draw-Tracked $g 'CLOSE' $script:F_Micro $script:C_Dim ($BX + 2 * $btnW + 22) $capY 1.5

        # ---------- log strip, printed on the ground like a spec sheet ----------
        $ly = $script:BtnY + $script:BtnH + 24
        $hairPen = New-Object System.Drawing.Pen($script:C_Rule, 1)
        $g.DrawLine($hairPen, $BX, $ly, $BX + $BW, $ly)
        Draw-Tracked $g 'LOG' $script:F_Micro $script:C_Dim $BX ($ly + 8) 2
        $stats = "{0} kept / {1} short" -f $script:Written, $script:Skipped
        $sw = $g.MeasureString($stats, $script:F_Micro, 10000, $script:Typo).Width
        Draw-Text $g $stats $script:F_Micro $script:C_Dim ($BX + $BW - $sw) ($ly + 8)

        $ry = $ly + 24
        foreach ($rr in $script:Recent) {
            if ($ry -gt $script:UH - 18) { break }
            if ($rr.counted) {
                $b = New-Object System.Drawing.SolidBrush($script:C_Orange)
                $g.FillRectangle($b, $BX, $ry + 3, 2, 8); $b.Dispose()
            }
            $ink = if ($rr.counted) { $script:C_Ink } else { $script:C_Dim }
            Draw-Text $g $rr.time $script:F_Row $script:C_Dim ($BX + 7) $ry
            Draw-Text $g ("{0} - {1}" -f $rr.artist, $rr.title) $script:F_Row $ink ($BX + 46) $ry ($BW - 96)
            $s = "{0}s" -f [int]$rr.dwell
            $w2 = $g.MeasureString($s, $script:F_Row, 10000, $script:Typo).Width
            Draw-Text $g $s $script:F_Row $script:C_Dim ($BX + $BW - $w2) $ry
            $ry += 16
        }
        if ($script:Recent.Count -eq 0) {
            Draw-Text $g 'no entries yet' $script:F_Row $script:C_Dim ($BX + 7) $ry
        }
        $hairPen.Dispose()
      } catch {
        if (Get-Command Write-Fault -ErrorAction SilentlyContinue) { Write-Fault 'paint' $_ }
      }
    })

    # Only the readout and the arm carry moving values, so only those repaint.
    $script:UTimer = New-Object System.Windows.Forms.Timer
    $script:UTimer.Interval = 1000
    $script:UTimer.Add_Tick({
      try {
        if ($script:UForm -and -not $script:UForm.IsDisposed) {
            $script:UForm.Invalidate((New-Object System.Drawing.Rectangle(($script:BX + 162), ($script:BY + 8), 118, 54)))
            $script:UForm.Invalidate((New-Object System.Drawing.Rectangle(($script:BX - 7), ($script:BY + 66), 14, 190)))
        }
      } catch {
        if (Get-Command Write-Fault -ErrorAction SilentlyContinue) { Write-Fault 'ui timer' $_ }
      }
    })
    $script:UTimer.Start()
    $form.Add_FormClosed({
        if ($script:UTimer) { $script:UTimer.Stop(); $script:UTimer.Dispose(); $script:UTimer = $null }
    })

    return $form
}

function Show-Status {
    $f = New-StatusForm
    $f.TopMost = $true
    [void]$f.ShowDialog()
}
