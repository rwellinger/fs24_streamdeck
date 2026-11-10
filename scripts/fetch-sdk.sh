#!/usr/bin/env bash
# Download the MSFS 2024 SDK core installer and keep only what the WASM bridge
# build needs. Result: sdk/<version>/ and the symlink sdk/current.
# Requires: curl, unzip, node, msiextract (brew/apt package "msitools").
#
#   scripts/fetch-sdk.sh            latest version from sdk.json
#   SDK_VERSION=1.8.2 scripts/fetch-sdk.sh   pin (must still be listed)
set -euo pipefail

BASE_URL="https://sdk.flightsimulator.com/msfs2024/files/"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="$ROOT/sdk"

for tool in curl unzip node msiextract; do
	command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

mkdir -p "$SDK_ROOT"
tmp="$(mktemp -d "$SDK_ROOT/.fetch.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

curl -sSfL "${BASE_URL}sdk.json" -o "$tmp/sdk.json"
read -r version path < <(node -e '
	const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	const g = d.game_versions[0];
	const p = g.downloads_menu["SDK Installer (Core)"].value;
	console.log(g.release_notes[0], p);
' "$tmp/sdk.json")

if [[ -n "${SDK_VERSION:-}" && "$SDK_VERSION" != "$version" ]]; then
	path="${path//$version/$SDK_VERSION}"
	version="$SDK_VERSION"
fi

dest="$SDK_ROOT/$version"
if [[ -f "$dest/.complete" ]]; then
	echo "SDK $version already present: $dest"
else
	echo "Downloading SDK $version ($path)"
	curl -sSfL "${BASE_URL}${path}" -o "$tmp/core.zip"
	unzip -q "$tmp/core.zip" -d "$tmp/zip"
	msi="$(find "$tmp/zip" -name '*.msi' | head -n1)"
	[[ -n "$msi" ]] || { echo "no .msi in installer zip" >&2; exit 1; }
	(cd "$(dirname "$msi")" && msiextract -C "$tmp/msi" "$(basename "$msi")" >/dev/null)

	src="$tmp/msi/MSFS 2024 SDK"
	rm -rf "$dest"
	mkdir -p "$dest/WASM" "$dest/SimConnect"
	for d in include lib wasi-sysroot WasmVersions; do
		[[ -d "$src/WASM/$d" ]] || { echo "SDK layout changed: WASM/$d missing" >&2; exit 1; }
		cp -R "$src/WASM/$d" "$dest/WASM/"
	done
	cp -R "$src/SimConnect SDK/include" "$dest/SimConnect/"
	cp "$src/Licenses/"* "$dest/" 2>/dev/null || true
	touch "$dest/.complete"
	echo "SDK $version extracted: $dest"
fi

ln -sfn "$version" "$SDK_ROOT/current"
