# Renders the MathMyLoan icon (white rupee sign on a blue rounded square) as PNGs.
# Run on Windows: powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\assets\brand'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $r = [single]($size * 0.25)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $path.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $path.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#2563eb'))
  $g.FillPath($blue, $path)

  $font = New-Object System.Drawing.Font 'Segoe UI', ([single]($size * 0.62)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, ([single]($size * 0.02)), $size, $size
  $g.DrawString([string][char]0x20B9, $font, [System.Drawing.Brushes]::White, $rect, $fmt)

  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $name"
}

New-Icon 32 'icon-32.png'
New-Icon 48 'icon-48.png'
New-Icon 180 'apple-touch-icon.png'
New-Icon 192 'icon-192.png'
New-Icon 512 'icon-512.png'
