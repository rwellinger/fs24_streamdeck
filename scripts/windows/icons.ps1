<#
  fs24_streamdeck - Stream Deck plugin for MSFS 2024
  Copyright (c) 2026 thWelly

  Licensed under the MIT License.
  See the LICENSE file in the project root for full license text.

  Windows equivalent of `make icons`: generate button icons from
  scripts/icons/catalog.ts into out/icons/. Uses the portable Node from .tools/.

  Usage:
    .\scripts\windows\icons.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "node.ps1") npm run --silent icons
if ($LASTEXITCODE -ne 0) {
	Write-Host "ERROR: icon generation failed (exit $LASTEXITCODE)" -ForegroundColor Red
	exit 1
}

$bundleChanges = & git status --porcelain -- "com.robertw.fs24.sdPlugin/imgs" 2>$null
if ($bundleChanges) {
	Write-Host ""
	Write-Host "Note: tracked bundle images under com.robertw.fs24.sdPlugin/imgs changed." -ForegroundColor Yellow
	Write-Host "If you did not edit scripts/icons/template.ts, discard them with:" -ForegroundColor Yellow
	Write-Host "  git restore com.robertw.fs24.sdPlugin/imgs" -ForegroundColor Yellow
}
$out = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))) "out\icons"
Write-Host "`nIcons written to $out"
