# Daily scrape from this computer. Some Indian bank sites (SBI, IDFC First, IOB) don't answer
# GitHub's overseas servers but do answer from here, so this run gives the fuller set of drafts.
# Windows runs it every morning as the "MathMyLoan daily scrape" task (see README).
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $repo 'scrape-local.log'
Set-Location $repo

function Write-Log($text) { $text | Out-File $log -Append -Encoding utf8 }
# Runs a command through cmd so its error output is logged as plain text.
function Invoke-Logged($command) {
  cmd /c "$command 2>&1" | ForEach-Object { Write-Log $_ }
  return $LASTEXITCODE
}

Write-Log "`n==== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===="
$lockBefore = (Get-FileHash package-lock.json).Hash
if ((Invoke-Logged 'git pull --rebase --autostash --quiet') -ne 0) {
  Write-Log 'git pull failed; scrape skipped so it does not overwrite newer drafts'
  exit 1
}
# New packages arrived with the pull.
if ((Get-FileHash package-lock.json).Hash -ne $lockBefore -or -not (Test-Path node_modules)) {
  Invoke-Logged 'npm ci --silent' | Out-Null
}
$code = Invoke-Logged 'node src/scrape/run.js --push'
Write-Log "exit code $code"

# Keep the log to its last 3000 lines.
$lines = Get-Content $log -Encoding utf8
if ($lines.Count -gt 3000) { $lines[-3000..-1] | Set-Content $log -Encoding utf8 }
exit $code
