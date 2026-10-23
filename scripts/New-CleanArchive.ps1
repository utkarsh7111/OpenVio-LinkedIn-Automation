param(
  [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string] $OutputPath = (Join-Path (Split-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path -Parent) 'openvio-clean.zip')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$excludedDirectories = @('.git', 'node_modules', '.next', 'uploads', 'coverage', 'test-results', 'playwright-report', '.turbo', 'dist', 'certs')
$environmentFiles = [System.Collections.Generic.List[string]]::new()
$files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
$pending = [System.Collections.Generic.Stack[string]]::new()
$pending.Push($root)

while ($pending.Count -gt 0) {
  $directory = $pending.Pop()
  foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
    if ($entry.PSIsContainer) {
      if ($entry.Name -notin $excludedDirectories) { $pending.Push($entry.FullName) }
      continue
    }
    if ($entry.Name -match '^\.env($|\.)' -and $entry.Name -notmatch '^\.env(?:\..+)?\.example$') {
      $environmentFiles.Add([System.IO.Path]::GetRelativePath($root, $entry.FullName))
      continue
    }
    if ([System.IO.Path]::GetFullPath($entry.FullName) -ne $output) { $files.Add($entry) }
  }
}

if ($environmentFiles.Count -gt 0) {
  $names = $environmentFiles -join ', '
  throw "Archive refused: remove real environment file(s) first: $names"
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("openvio-archive-" + [guid]::NewGuid().ToString('N'))
try {
  [void](New-Item -ItemType Directory -Path $stage)
  foreach ($file in $files) {
    $relative = [System.IO.Path]::GetRelativePath($root, $file.FullName)
    $destination = Join-Path $stage $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }
  $outputDirectory = Split-Path -Parent $output
  [void](New-Item -ItemType Directory -Path $outputDirectory -Force)
  if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $output, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Output "Created clean archive: $output"
  Write-Output "Included files: $($files.Count)"
  Write-Output 'Excluded directories: .git, node_modules, .next, uploads, coverage, test-results, playwright-report, .turbo, dist, certs'
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
