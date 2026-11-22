<#
  fs24_streamdeck - Stream Deck plugin for MSFS 2024
  Copyright (c) 2026 thWelly

  Licensed under the MIT License.
  See the LICENSE file in the project root for full license text.

  Windows equivalent of `make deploy`: build the plugin, then restart it in the
  Stream Deck app. Uses the portable Node from .tools/ (see node.ps1).

  -Link (once per PC) makes the app load this repo's bundle instead of an
  installed release; installing a .streamDeckPlugin later replaces the link.

  Usage:
    .\scripts\windows\deploy.ps1 [-Link]
#>
[CmdletBinding()]
param(
	[switch]$Link
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Node = Join-Path $PSScriptRoot "node.ps1"
$PluginUuid = "com.robertw.fs24"

function Invoke-Step([string]$what, [string[]]$cmd) {
	Write-Host "-> $what"
	& $Node @cmd
	if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

try {
	Invoke-Step "build" @("npm", "run", "--silent", "build")
	if ($Link) { Invoke-Step "link $PluginUuid.sdPlugin" @("npx", "--no-install", "streamdeck", "link", "$PluginUuid.sdPlugin") }
	Invoke-Step "restart $PluginUuid" @("npx", "--no-install", "streamdeck", "restart", $PluginUuid)
} catch {
	Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
	exit 1
}
