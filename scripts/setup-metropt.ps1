$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloadDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot '.im-training-agent\downloads'))
$datasetDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'data\datasets\metropt'))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $downloadDirectory 'metropt-3-dataset.zip'))
$datasetPath = [System.IO.Path]::GetFullPath((Join-Path $datasetDirectory 'MetroPT3(AirCompressor).csv'))
$sourceUrl = 'https://archive.ics.uci.edu/static/public/791/metropt%2B3%2Bdataset.zip'
$expectedArchiveSha256 = 'aab991a970e58210de853bb8078ce0e63abb4d9412fdc5c79792dae3d8e1721a'

New-Item -ItemType Directory -Force -Path $downloadDirectory, $datasetDirectory | Out-Null

if (Test-Path -LiteralPath $datasetPath) {
  Write-Host "MetroPT-3 已存在：$datasetPath"
  exit 0
}

if (Test-Path -LiteralPath $archivePath) {
  $existingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($existingHash -ne $expectedArchiveSha256) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}

if (-not (Test-Path -LiteralPath $archivePath)) {
  Write-Host '正在从 UCI Machine Learning Repository 下载 MetroPT-3（约 208 MB）…'
  Invoke-WebRequest -Uri $sourceUrl -OutFile $archivePath
}

$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($archiveHash -ne $expectedArchiveSha256) {
  throw "MetroPT-3 压缩包校验失败。实际 SHA256：$archiveHash"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entry = $archive.Entries | Where-Object { $_.Name -eq 'MetroPT3(AirCompressor).csv' } | Select-Object -First 1
  if (-not $entry) {
    throw '官方压缩包中未找到 MetroPT3(AirCompressor).csv。'
  }
  $inputStream = $entry.Open()
  $outputStream = [System.IO.File]::Create($datasetPath)
  try {
    $inputStream.CopyTo($outputStream)
  } finally {
    $outputStream.Dispose()
    $inputStream.Dispose()
  }
} finally {
  $archive.Dispose()
}

Write-Host "MetroPT-3 已安装：$datasetPath"
Write-Host '下次启动后端时会自动导入 SQLite。'
