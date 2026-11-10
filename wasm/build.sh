#!/usr/bin/env bash
# Build the WASM bridge (and the loader probe) against the MSFS 2024 SDK.
#
#   TOOLCHAIN=sdk   Asobo's LLVM from the SDK (WASM/llvm, Windows only) — the
#                   release build; flags = SDK MSBuild toolset
#                   (WASM/vs/2022/Microsoft.Cpp.MSFS.Common.targets).
#   TOOLCHAIN=llvm  stock LLVM (Homebrew/apt) — Mac dev loop / syntax check.
#                   Not loadable by the sim so far (docs/research/wasm-bridge.md).
#
# Default: sdk when the SDK's clang-cl.exe is present and we run on Windows.
# Env: SDK_DIR (default ../sdk/current), LLVM_BIN, LLD_BIN.
set -euo pipefail

cd "$(dirname "$0")"
SDK_DIR="${SDK_DIR:-../sdk/current}"
[[ -f "$SDK_DIR/.complete" ]] || { echo "MSFS SDK missing in $SDK_DIR — run 'make sdk' first" >&2; exit 1; }

VERSION="$(tr -d '[:space:]' < VERSION)"
SYSROOT="$SDK_DIR/WASM/wasi-sysroot"
LIBDIR="$SYSROOT/lib/wasm32-wasi"
BUILD=build
mkdir -p "$BUILD"

if [[ -z "${TOOLCHAIN:-}" ]]; then
	TOOLCHAIN=llvm
	if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]] && [[ -x "$SDK_DIR/WASM/llvm/bin/clang-cl.exe" ]]; then
		TOOLCHAIN=sdk
	fi
fi

case "$TOOLCHAIN" in
sdk)
	# clang-cl in GNU driver mode accepts the same flags as clang++.
	CXX=("$SDK_DIR/WASM/llvm/bin/clang-cl.exe" --driver-mode=g++)
	WASM_LD=("$SDK_DIR/WASM/llvm/bin/wasm-ld.exe")
	TOOLCHAIN_LDFLAGS=(--stack-guard-page)
	;;
llvm)
	LLVM_BIN="${LLVM_BIN:-$( [[ -d /opt/homebrew/opt/llvm/bin ]] && echo /opt/homebrew/opt/llvm/bin || echo /usr/bin )}"
	LLD_BIN="${LLD_BIN:-$( [[ -d /opt/homebrew/opt/lld/bin ]] && echo /opt/homebrew/opt/lld/bin || echo /usr/bin )}"
	CXX=("$LLVM_BIN/clang++")
	WASM_LD=("$LLD_BIN/wasm-ld")
	# Stock lld lacks --stack-guard-page; newer clang defaults to more WASM
	# features than the sim accepts (MVP + bulk-memory only).
	TOOLCHAIN_LDFLAGS=(--stack-first -z stack-size=1048576)
	;;
*)
	echo "unknown TOOLCHAIN=$TOOLCHAIN" >&2
	exit 1
	;;
esac

CXXFLAGS=(
	--target=wasm32-unknown-wasi "--sysroot=$SYSROOT"
	-mcpu=mvp -mbulk-memory
	-std=c++20 -O3 -fstack-size-section -fvisibility=hidden
	-ffunction-sections -fdata-sections -fno-stack-protector -fno-exceptions
	-fms-extensions -fwritable-strings -Werror=return-type
	-Wall -Wno-deprecated -Wno-ignored-attributes -Wno-unused-function -Wno-unused-command-line-argument
	-D_MSFS_WASM "-DBRIDGE_VERSION=\"$VERSION\""
	"-I$SDK_DIR/WASM/include" "-I$SDK_DIR/SimConnect/include"
)

LDFLAGS=(
	--no-entry --allow-undefined --export-dynamic
	--export malloc --export free --export __wasm_call_ctors --export-table
	--export mallinfo --export mchunkit_begin --export mchunkit_next
	--export get_pages_state --export mark_decommit_pages
	--export GetSimConnectVersion --export GetExtensionVersion --export GetExtensionVersionBuffer
	"${TOOLCHAIN_LDFLAGS[@]}"
	--strip-debug --gc-sections -O3 "-L$LIBDIR"
)

LIBS=(
	-lc++ -lc++abi -lc "$LIBDIR/libclang_rt.builtins-wasm32.a" -lc
	"$SDK_DIR/WASM/WasmVersions/MSFS_WasmVersions.a"
)

build() { # <source> <module name>
	local obj="$BUILD/$2.o"
	echo "[$TOOLCHAIN] $1 → $BUILD/$2.wasm"
	"${CXX[@]}" "${CXXFLAGS[@]}" -c "src/$1" -o "$obj"
	"${WASM_LD[@]}" "${LDFLAGS[@]}" "$obj" "${LIBS[@]}" -o "$BUILD/$2.wasm"
}

build bridge.cpp fs24-streamdeck-bridge
# Loader probe (temporary, M03 diagnosis): empty module, same toolchain/flags.
build probe_empty.cpp fs24-probe-empty
