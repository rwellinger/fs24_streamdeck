#!/usr/bin/env bash
# Download the MSFS 2024 SDK core installer and keep only what the WASM bridge
# build needs. Result: sdk/<version>/ and the symlink sdk/current.
# Requires: curl, unzip, node and an MSI extractor: msiextract (brew/apt
# package "msitools") on macOS/Linux, msiexec on Windows (Git Bash). On Windows
# Asobo's own LLVM (WASM/llvm, Windows binaries) is kept as well — the release
# build uses it (see wasm/build.sh).
#
#   scripts/fetch-sdk.sh            latest version from sdk.json
#   SDK_VERSION=1.8.2 scripts/fetch-sdk.sh   pin (must still be listed)
set -euo pipefail

BASE_URL="https://sdk.flightsimulator.com/msfs2024/files/"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="$ROOT/sdk"

WINDOWS=0
[[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]] && WINDOWS=1

for tool in curl unzip node; do
	command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
if [[ $WINDOWS == 0 ]]; then
	command -v msiextract >/dev/null || { echo "missing tool: msiextract (msitools)" >&2; exit 1; }
fi

extract_msi() { # <msi> <out dir>
	if [[ $WINDOWS == 1 ]]; then
		# msiexec is a GUI-subsystem binary; Start-Process -Wait blocks until done.
		local msi_w out_w
		msi_w="$(cygpath -w "$1")"
		out_w="$(cygpath -w "$2")"
		powershell.exe -NoProfile -Command \
			"\$p = Start-Process msiexec.exe -ArgumentList @('/a', '$msi_w', '/qn', 'TARGETDIR=$out_w') -Wait -PassThru; exit \$p.ExitCode"
	else
		(cd "$(dirname "$1")" && msiextract -C "$2" "$(basename "$1")" >/dev/null)
	fi
}

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
	mkdir -p "$tmp/msi"
	extract_msi "$msi" "$tmp/msi"

	src="$(find "$tmp/msi" -maxdepth 3 -type d -name 'MSFS 2024 SDK' | head -n1)"
	[[ -n "$src" ]] || { echo "SDK layout changed: 'MSFS 2024 SDK' not found" >&2; exit 1; }
	rm -rf "$dest"
	mkdir -p "$dest/WASM" "$dest/SimConnect"
	for d in include lib wasi-sysroot WasmVersions; do
		[[ -d "$src/WASM/$d" ]] || { echo "SDK layout changed: WASM/$d missing" >&2; exit 1; }
		cp -R "$src/WASM/$d" "$dest/WASM/"
	done
	[[ $WINDOWS == 1 ]] && cp -R "$src/WASM/llvm" "$dest/WASM/"
	cp -R "$src/SimConnect SDK/include" "$dest/SimConnect/"
	cp "$src/Licenses/"* "$dest/" 2>/dev/null || true
	touch "$dest/.complete"
	echo "SDK $version extracted: $dest"
fi

# Git Bash's ln -s copies instead of linking; CI on Windows passes SDK_DIR.
[[ $WINDOWS == 0 ]] && ln -sfn "$version" "$SDK_ROOT/current"
echo "SDK_DIR=$dest"
