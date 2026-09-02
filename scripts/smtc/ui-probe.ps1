# Opens the status window headlessly, pumps its message loop for a few seconds
# so the repaint timer actually fires, and prints anything that throws.
# The paint handler and the timer run in their own scopes, which is exactly
# where errors go silent -- this makes them loud.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Live = @{}
$script:Recent = New-Object System.Collections.ArrayList
$script:Written = 4
$script:Skipped = 2
$script:Paused = $false
$script:DumpDir = Join-Path $PSScriptRoot 'dump'

$script:Live['preview'] = @{
    sourceApp = 'Spotify.exe'; title = 'Lean On'; artist = 'Major Lazer'
    albumTitle = 'Peace Is The Mission'; duration = 176.6; dwell = 74.0
    art = $null; startedAt = (Get-Date)
}
foreach ($r in @(
    @{ time = '11:34'; artist = 'Major Lazer'; title = 'Lean On'; dwell = 176; counted = $true },
    @{ time = '11:30'; artist = 'Pitbull'; title = 'Give Me Everything'; dwell = 252; counted = $true }
)) { [void]$script:Recent.Add($r) }

. (Join-Path $PSScriptRoot 'ui.ps1')

[System.Windows.Forms.Application]::add_ThreadException({
    param($sender, $e)
    Write-Host "THREAD EXCEPTION: $($e.Exception.Message)"
    Write-Host $e.Exception.StackTrace
})

$form = New-StatusForm
$form.Show()

$deadline = (Get-Date).AddSeconds(6)
while ((Get-Date) -lt $deadline -and -not $form.IsDisposed) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
}
Write-Host ("disposed after pump: " + $form.IsDisposed)
if (-not $form.IsDisposed) { $form.Close() }
Write-Host 'probe finished'
