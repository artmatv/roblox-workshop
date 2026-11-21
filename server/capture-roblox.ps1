param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$IntervalMs = 4000,
  [int]$Seconds = 900,
  [int]$MaxFrames = 40,
  [int]$MaxWidth = 1600,
  [string]$ProcessName = 'RobloxPlayer*'
)
# Saves the Roblox Player window as PNG while it is the foreground window, so
# only what the owner is looking at is captured. One file name per line on stdout.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RobloxWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[RobloxWindow]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$deadline = (Get-Date).AddSeconds($Seconds)
$count = 0
$sha = [System.Security.Cryptography.SHA256]::Create()
$last = ''
while ((Get-Date) -lt $deadline -and $count -lt $MaxFrames) {
  $window = [RobloxWindow]::GetForegroundWindow()
  $owner = 0
  [RobloxWindow]::GetWindowThreadProcessId($window, [ref]$owner) | Out-Null
  $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -like $ProcessName) {
    $rect = New-Object RobloxWindow+RECT
    [RobloxWindow]::GetClientRect($window, [ref]$rect) | Out-Null
    $origin = New-Object RobloxWindow+POINT
    [RobloxWindow]::ClientToScreen($window, [ref]$origin) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -ge 320 -and $height -ge 240) {
      $screen = New-Object System.Drawing.Bitmap $width, $height
      $graphics = [System.Drawing.Graphics]::FromImage($screen)
      $graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, $screen.Size)
      $graphics.Dispose()
      $scale = [Math]::Min(1.0, $MaxWidth / $width)
      $frame = New-Object System.Drawing.Bitmap ([int]($width * $scale)), ([int]($height * $scale))
      $graphics = [System.Drawing.Graphics]::FromImage($frame)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($screen, 0, 0, $frame.Width, $frame.Height)
      $graphics.Dispose()
      $screen.Dispose()
      $stream = New-Object System.IO.MemoryStream
      $frame.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $frame.Dispose()
      $bytes = $stream.ToArray()
      $digest = [BitConverter]::ToString($sha.ComputeHash($bytes))
      if ($digest -ne $last) {
        $last = $digest
        $count++
        $name = 'capture-{0:yyyyMMdd-HHmmss}-{1:d3}.png' -f (Get-Date), $count
        $target = Join-Path $OutDir $name
        [System.IO.File]::WriteAllBytes("$target.tmp", $bytes)
        Move-Item -LiteralPath "$target.tmp" -Destination $target
        [Console]::Out.WriteLine($name)
        [Console]::Out.Flush()
      }
    }
  }
  Start-Sleep -Milliseconds $IntervalMs
}
