param(
  [string]$Ffmpeg = 'C:\Projects\PodCut-TestMedia\Tools\ffmpeg-9.0.2\ffmpeg.exe',
  [string]$Source = 'C:\Projects\PodCut-TestMedia\Wikimedia\Entrevista (Parte 1).webm',
  [string]$Output = 'C:\Projects\PodCut-TestMedia\Fixtures\podcut-internal-pauses.mov'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Ffmpeg)) { throw "FFmpeg not found: $Ffmpeg" }
if (-not (Test-Path -LiteralPath $Source)) { throw "Source not found: $Source" }
$folder = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# Controlled fixture derived from real interview footage. Each inserted pause
# freezes the preceding frame and appends silent PCM; no source media is muted.
$filters = @(
  '[0:v]trim=start=4:end=14,setpts=PTS-STARTPTS,fps=30,scale=1280:720,tpad=stop_mode=clone:stop_duration=2,format=yuv420p[v0]'
  '[0:a]atrim=start=4:end=14,asetpts=PTS-STARTPTS,aresample=48000,apad=pad_dur=2[a0]'
  '[0:v]trim=start=20:end=30,setpts=PTS-STARTPTS,fps=30,scale=1280:720,tpad=stop_mode=clone:stop_duration=4,format=yuv420p[v1]'
  '[0:a]atrim=start=20:end=30,asetpts=PTS-STARTPTS,aresample=48000,apad=pad_dur=4[a1]'
  '[0:v]trim=start=36:end=46,setpts=PTS-STARTPTS,fps=30,scale=1280:720,format=yuv420p[v2]'
  '[0:a]atrim=start=36:end=46,asetpts=PTS-STARTPTS,aresample=48000[a2]'
  '[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]'
) -join ';'

$arguments = @('-hide_banner', '-nostdin', '-loglevel', 'error', '-i', $Source,
  '-filter_complex', $filters, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-y', $Output)
& $Ffmpeg @arguments
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed with exit code $LASTEXITCODE" }
$wav = [System.IO.Path]::ChangeExtension($Output, '.wav')
& $Ffmpeg -hide_banner -nostdin -loglevel error -i $Output -map '0:a:0' -c:a pcm_s16le -y $wav
if ($LASTEXITCODE -ne 0) { throw "FFmpeg WAV extraction failed with exit code $LASTEXITCODE" }
Write-Output $Output
