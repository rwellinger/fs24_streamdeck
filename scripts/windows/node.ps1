<#
  fs24_streamdeck - Stream Deck plugin for MSFS 2024
  Copyright (c) 2026 thWelly

  Licensed under the MIT License.
  See the LICENSE file in the project root for full license text.

  Runs a Node command on Windows without installing Node.js system-wide.
  On first use it downloads a portable Node (major from .nvmrc) into .tools/
  (gitignored), verifies its SHA-256 and runs `npm ci` when node_modules is
  missing or older than package-lock.json. PATH is only extended for this
  process - nothing is installed, registered or started in the background.

  Usage:
    .\scripts\windows\node.ps1 npx tsx scripts/smoke-simconnect.ts
    .\scripts\windows\node.ps1 npm run check
    .\scripts\windows\node.ps1 -Clean      # remove .tools/
#>
[CmdletBinding()]
param(
	[switch]$Clean,
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$Command
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$ToolsDir = Join-Path $RepoRoot ".tools"
$NodeModules = Join-Path $RepoRoot "node_modules"
$NodeDistUrl = "https://nodejs.org/dist"

function Get-NodeMajor {
	$raw = ([IO.File]::ReadAllText((Join-Path $RepoRoot ".nvmrc"))).Trim().TrimStart("v")
	return $raw.Split(".")[0]
}

function Find-PortableNode([string]$major) {
	if (-not (Test-Path -LiteralPath $ToolsDir)) { return $null }
	$dirs = @(Get-ChildItem -LiteralPath $ToolsDir -Directory -Filter "node-v$major.*-win-x64" |
			Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "node.exe") } |
			Sort-Object { [version]($_.Name -replace '^node-v', '' -replace '-win-x64$', '') })
	if ($dirs.Count -eq 0) { return $null }
	return $dirs[-1].FullName
}

function Install-PortableNode([string]$major) {
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	Write-Host "-> looking up latest Node $major.x"
	$index = Invoke-RestMethod -Uri "$NodeDistUrl/index.json"
	$release = $index | Where-Object { $_.version -like "v$major.*" -and $_.files -contains "win-x64-zip" } | Select-Object -First 1
	if ($null -eq $release) { throw "No Node $major.x win-x64 release found on $NodeDistUrl" }
	$version = $release.version
	$name = "node-$version-win-x64"
	$zipName = "$name.zip"

	New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
	$zipPath = Join-Path $ToolsDir $zipName
	try {
		Write-Host "-> downloading $zipName"
		Invoke-WebRequest -Uri "$NodeDistUrl/$version/$zipName" -OutFile $zipPath -UseBasicParsing
		$shasums = (Invoke-WebRequest -Uri "$NodeDistUrl/$version/SHASUMS256.txt" -UseBasicParsing).Content
		$line = ($shasums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($zipName))\s*$" } | Select-Object -First 1
		if ($null -eq $line) { throw "$zipName not listed in SHASUMS256.txt" }
		$expected = ($line.Trim() -split "\s+")[0].ToLowerInvariant()
		$actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
		if ($expected -ne $actual) { throw "SHA-256 mismatch for ${zipName}: expected $expected, got $actual" }
		Write-Host "-> checksum OK, extracting to .tools\$name"
		[IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $ToolsDir)
	} finally {
		Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
	}
	return Join-Path $ToolsDir $name
}

function Test-DepsStale {
	$installedLock = Join-Path $NodeModules ".package-lock.json"
	if (-not (Test-Path -LiteralPath $installedLock)) { return $true }
	$repoLock = Join-Path $RepoRoot "package-lock.json"
	return (Get-Item -LiteralPath $repoLock).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installedLock).LastWriteTimeUtc
}

try {
	Set-Location -LiteralPath $RepoRoot

	if ($Clean) {
		if (Test-Path -LiteralPath $ToolsDir) {
			Write-Host "-> removing $ToolsDir"
			Remove-Item -LiteralPath $ToolsDir -Recurse -Force
		}
		exit 0
	}

	$major = Get-NodeMajor
	$nodeDir = Find-PortableNode $major
	if ($null -eq $nodeDir) { $nodeDir = Install-PortableNode $major }
	$env:PATH = "$nodeDir;$env:PATH"

	if (Test-DepsStale) {
		Write-Host "-> npm ci"
		& (Join-Path $nodeDir "npm.cmd") ci --no-audit --no-fund
		if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
	}

	if ($null -eq $Command -or $Command.Count -eq 0) {
		Write-Host "Node $(& (Join-Path $nodeDir 'node.exe') --version) ready in $nodeDir"
		exit 0
	}

	$exe = $Command[0]
	$exeArgs = @($Command | Select-Object -Skip 1)
	$local = @("$exe.cmd", "$exe.exe") | ForEach-Object { Join-Path $nodeDir $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
	if ($null -ne $local) { $exe = $local }
	& $exe @exeArgs
	exit $LASTEXITCODE
} catch {
	Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
	exit 1
}
