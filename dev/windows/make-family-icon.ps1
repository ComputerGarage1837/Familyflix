# Convert the shared Family Flix PNG into the Windows icon resource.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$familyRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$familySource = Join-Path $familyRoot 'resources\images\icon.png'
$familyTarget = Join-Path $familyRoot 'bundle\win\jellyfin.ico'

$familyImage = [System.Drawing.Image]::FromFile($familySource)
$familyBitmap = [System.Drawing.Bitmap]::new(256, 256)
$familyGraphics = [System.Drawing.Graphics]::FromImage($familyBitmap)
$familyGraphics.Clear([System.Drawing.Color]::Transparent)
$familyGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$familyGraphics.DrawImage($familyImage, 0, 0, 256, 256)
$familyPngStream = [System.IO.MemoryStream]::new()
$familyBitmap.Save($familyPngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$familyPng = $familyPngStream.ToArray()

$familyIcoStream = [System.IO.MemoryStream]::new()
$familyWriter = [System.IO.BinaryWriter]::new($familyIcoStream)
$familyWriter.Write([uint16]0)
$familyWriter.Write([uint16]1)
$familyWriter.Write([uint16]1)
$familyWriter.Write([byte]0)
$familyWriter.Write([byte]0)
$familyWriter.Write([byte]0)
$familyWriter.Write([byte]0)
$familyWriter.Write([uint16]1)
$familyWriter.Write([uint16]32)
$familyWriter.Write([uint32]$familyPng.Length)
$familyWriter.Write([uint32]22)
$familyWriter.Write($familyPng)
[System.IO.File]::WriteAllBytes($familyTarget, $familyIcoStream.ToArray())

$familyWriter.Dispose()
$familyIcoStream.Dispose()
$familyPngStream.Dispose()
$familyGraphics.Dispose()
$familyBitmap.Dispose()
$familyImage.Dispose()
