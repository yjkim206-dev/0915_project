$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$publicRoot = Join-Path $projectRoot 'frontend/public'
New-Item -ItemType Directory -Force -Path (Join-Path $publicRoot 'brand'), (Join-Path $publicRoot 'images') | Out-Null

function Export-BrandImage($source, $destination, $width, $height, $jpeg = $false) {
    $image = [System.Drawing.Image]::FromFile($source)
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::FromArgb(251,250,248))
        $graphics.DrawImage($image, 0, 0, $width, $height)
        if ($jpeg) {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]90)
            try { $bitmap.Save($destination, $codec, $parameters) } finally { $parameters.Dispose() }
        } else { $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png) }
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $image.Dispose() }
}

$icon = Join-Path $projectRoot 'design/branding/moa-icon-source-v1.png'
foreach ($entry in @(@('favicon-16-v1.png',16), @('favicon-32-v1.png',32), @('favicon-48-v1.png',48), @('favicon-192-v1.png',192), @('apple-touch-icon-v1.png',180), @('brand/moa-icon-v1.png',512))) {
    Export-BrandImage $icon (Join-Path $publicRoot $entry[0]) $entry[1] $entry[1]
}
Export-BrandImage (Join-Path $projectRoot 'design/branding/moa-og-source-v1.png') (Join-Path $publicRoot 'images/moa-og-v1.jpg') 1200 630 $true

# A multi-resolution ICO containing PNG frames, supported by modern browsers.
$frames = @(16,32,48 | ForEach-Object { ,([System.IO.File]::ReadAllBytes((Join-Path $publicRoot "favicon-$_-v1.png"))) })
$stream = [System.IO.File]::Create((Join-Path $publicRoot 'favicon.ico'))
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]3)
    $offset = 6 + 16 * 3
    for ($i=0; $i -lt 3; $i++) {
        $size = @(16,32,48)[$i]
        $writer.Write([byte]$size); $writer.Write([byte]$size); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
} finally { $writer.Dispose(); $stream.Dispose() }
Write-Output 'Brand icons and the 1200x630 OG image exported.'
