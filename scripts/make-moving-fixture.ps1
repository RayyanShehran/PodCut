param(
  [string]$Ffmpeg = 'C:\Projects\PodCut-TestMedia\Tools\ffmpeg-9.0.2\ffmpeg.exe',
  [string]$Source = 'C:\Projects\PodCut-TestMedia\NASA\Piers_Sellers_JSC_2016_interview.webm',
  [string]$Output = 'C:\Projects\PodCut-TestMedia\Fixtures\podcut-nasa-moving-synthetic.mov'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Ffmpeg)) { throw "FFmpeg not found: $Ffmpeg" }
if (-not (Test-Path -LiteralPath $Source)) { throw "Source not found: $Source" }
$wav = [System.IO.Path]::ChangeExtension($Output, '.wav')
if ((Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath $wav)) { throw 'Refusing to overwrite existing fixture media.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null

# Synthetic timing/sync fixture, NOT natural-pause quality evidence.
# The known 30 fps NASA source supplies frames 600..1679 in order, unchanged.
# Only audio is muted at [10,12) and [22,26); lossless video permits exact checks.
$filters = '[0:v]trim=start_frame=600:end_frame=1680,setpts=N/(30*TB)[v];[0:a]atrim=start=20:end=56,asetpts=PTS-STARTPTS,aresample=48000,aeval=exprs=if(gte(t\,10)*lt(t\,12)+gte(t\,22)*lt(t\,26)\,0\,val(0))|if(gte(t\,10)*lt(t\,12)+gte(t\,22)*lt(t\,26)\,0\,val(1))[a]'
& $Ffmpeg -hide_banner -nostdin -loglevel error -i $Source -filter_complex $filters -map '[v]' -map '[a]' -c:v libx264 -preset veryfast -crf 0 -pix_fmt yuv420p -fps_mode passthrough -c:a pcm_s16le -ar 48000 -ac 2 -movflags +faststart -n $Output
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed with exit code $LASTEXITCODE" }
& $Ffmpeg -hide_banner -nostdin -loglevel error -i $Output -map '0:a:0' -c:a pcm_s16le -n $wav
if ($LASTEXITCODE -ne 0) { throw "WAV extraction failed with exit code $LASTEXITCODE" }
Write-Output $Output
