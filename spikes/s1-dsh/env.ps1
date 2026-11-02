# Dot-source (as Q:\env.ps1, where Q: is `subst`ed to spikes/s1-dsh): isolated DSH_HOME on the
# short drive (pnpm/plugin-manager hit ENAMETOOLONG under the ~200-char real path), but dsh, the
# plugin and the working dirs on the REAL path, because DSH's linked-peer interception compares
# native realpaths and does not match subst spellings. Never touches the user's real ~/.dsh.
$S1 = (node -e "console.log(require('fs').realpathSync.native(process.argv[1]))" $PSScriptRoot)
$env:DSH_HOME = 'Q:\dsh-home'
$env:PATH = (Join-Path $S1 'dsh\node_modules\.bin') + ';' + $env:PATH
$env:BUGGPS_SPIKE_LOG = Join-Path $S1 'work\buggps-spike.log'
New-Item -ItemType Directory -Force (Join-Path $S1 'work') | Out-Null
Set-Location $S1
