# engines.dsh / peerDependencies matrix against the running DSH (0.2.1-rc.5).
# Each case is a copy of plugin/ with a different manifest, installed into its own profile.
. Q:\env.ps1
$W = Join-Path $S1 'work\engines'
Remove-Item -Recurse -Force $W -ErrorAction SilentlyContinue
$cases = [ordered]@{
  'e1' = @{ engines = '>=0.2.0 <0.3.0' }
  'e2' = @{ engines = '>=0.2.1-0 <0.3.0' }
  'e3' = @{ engines = '>=0.2.1 <0.3.0' }
  'e4' = @{ engines = '^0.3.0' }
  'e5' = @{ engines = 'workspace:^' }
  'p1' = @{ peer = '0.2.1-rc.5' }
  'p2' = @{ peer = '^0.2.0' }
  'p3' = @{ peer = '>=0.2.0 <0.3.0' }
}
foreach ($k in $cases.Keys) {
  $c = $cases[$k]
  $dir = Join-Path $W $k
  New-Item -ItemType Directory -Force $dir | Out-Null
  Copy-Item (Join-Path $S1 'plugin\index.js') $dir
  $pkg = [ordered]@{ name = "dsh-bug-gps-$k"; version = '0.0.0'; private = $true; type = 'module'; main = 'index.js'
    files = @('index.js', 'cordis.patch.yml'); dsh = @{ bundle = @{ patch = './cordis.patch.yml' } } }
  if ($c.engines) { $pkg.engines = @{ dsh = $c.engines } }
  $pkg.peerDependencies = @{ '@deepseek-ai/dsh-tools' = $(if ($c.peer) { $c.peer } else { '>=0.2.0-0 <0.3.0' }) }
  $pkg | ConvertTo-Json -Depth 5 | Out-File -Encoding ascii (Join-Path $dir 'package.json')
  "- insert:`n    - id: buggps`n      name: dsh-bug-gps-$k" | Out-File -Encoding ascii (Join-Path $dir 'cordis.patch.yml')
  Set-Location $W
  $out = & dsh plugin --profile "eng-$k" add "./$k" 2>&1 | ForEach-Object { "$_" }
  "### $k engines=$($c.engines) peer=$($c.peer) -> add exit=$LASTEXITCODE"
  $out | Where-Object { $_ -match 'dsh|engines|peer|refus|incompat|requir|ERR' -and $_ -notmatch '^\s+at ' } | Select-Object -First 6 | ForEach-Object { "    $_" }
}
