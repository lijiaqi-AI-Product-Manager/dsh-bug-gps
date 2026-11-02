# Usage (from anywhere): powershell -File Q:\run-scenario.ps1 <scenario> [denyVia] [port]
# Boots the real `dsh --profile headless` against mock/server.mjs and keeps all evidence in work/.
param([string]$Scenario = 'probe', [string]$DenyVia = 'pre', [int]$Port = 8765, [string]$DshProfile = 'headless')
. Q:\env.ps1
$W = Join-Path $S1 'work'
$tag = "$Scenario-$DenyVia"
Remove-Item "$W\mock-$tag.jsonl", "$W\$tag.*", $env:BUGGPS_SPIKE_LOG -ErrorAction SilentlyContinue
$proj = Join-Path $W 'proj'
New-Item -ItemType Directory -Force (Join-Path $proj '.buggps\cases\case1'), (Join-Path $proj 'src') | Out-Null
Set-Content -Path (Join-Path $proj '.buggps\cases\case1\check.json') -Value '{"locked":true}'
$env:MOCK_PROJ = $proj
# Poll every 300 ms for the spike's tagged child/grandchild node processes (command line holds S1TAG).
$poller = Start-Job -ArgumentList "$W\$tag.procs.log" -ScriptBlock {
  param($out)
  while ($true) {
    $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'S1TAG-[a-z]+' } |
      ForEach-Object { "$($_.ProcessId)/ppid=$($_.ParentProcessId)/$([regex]::Match($_.CommandLine,'S1TAG-[a-z]+(-grandchild)?').Value)" }
    "$((Get-Date).ToString('HH:mm:ss.fff')) $($p -join ' ')" | Out-File -Append -Encoding utf8 $out
    Start-Sleep -Milliseconds 300
  }
}
$mock = Start-Process node -ArgumentList (Join-Path $S1 'mock\server.mjs'), $Port, $Scenario, "$W\mock-$tag.jsonl" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$W\$tag.mock.out"
Start-Sleep 1
$env:DEEPSEEK_BASE_URL = "http://127.0.0.1:$Port/v1"
$env:DEEPSEEK_API_KEY = 'mock-key'
$env:BUGGPS_SPIKE_DENY_VIA = $DenyVia
Set-Location $proj
$sw = [Diagnostics.Stopwatch]::StartNew()
& node (Join-Path $S1 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js') --profile $DshProfile --patch (Join-Path $S1 'mock\editor.patch.yml') "run the $Scenario scenario" > "$W\$tag.stdout" 2> "$W\$tag.stderr"
"dsh exit=$LASTEXITCODE secs=$([int]$sw.Elapsed.TotalSeconds)" | Tee-Object "$W\$tag.exit"
Stop-Process -Id $mock.Id -ErrorAction SilentlyContinue
Start-Sleep 2
Stop-Job $poller; Remove-Job $poller
$left = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'S1TAG-[a-z]+' }
"surviving tagged processes after dsh exit: $(($left | ForEach-Object { "$($_.ProcessId)=$([regex]::Match($_.CommandLine,'S1TAG-[a-z]+(-grandchild)?').Value)" }) -join ', ')" | Tee-Object -Append "$W\$tag.exit"
if (Test-Path $env:BUGGPS_SPIKE_LOG) { Copy-Item $env:BUGGPS_SPIKE_LOG "$W\$tag.plugin.log" }
"check.json now: $(Get-Content (Join-Path $proj '.buggps\cases\case1\check.json'))"
