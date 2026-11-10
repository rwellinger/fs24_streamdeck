# WASM bridge (M03)

Answers to the open questions of `.claude/tasks/M03-wasm-bridge.md`. Researched 2026-11-09 against SDK 1.8.2.

## 1. SDK files

- The MSFS 2024 SDK is public, no login: `https://sdk.flightsimulator.com/msfs2024/files/sdk.json` lists the current version (`game_versions[0].release_notes[0]`, e.g. `1.8.2`) and `downloads_menu["SDK Installer (Core)"].value`, a path relative to `…/files/` (`installers/1.8.2/MSFS2024_SDK_Core_Installer_1.8.2.zip`, 650 MB).
- The zip holds one `.msi` plus external `cab1..8.cab`. `msiextract` (`brew install msitools` / `apt install msitools`) extracts it fully on macOS and Linux — no Windows needed.
- Needed subset (~140 MB), all under `MSFS 2024 SDK/`: `WASM/include`, `WASM/lib`, `WASM/wasi-sysroot`, `WASM/WasmVersions`, `SimConnect SDK/include`.
- `scripts/fetch-sdk.sh` (`make sdk`) does download → extract → keep subset → `sdk/<version>/`, `sdk/current` symlink. `/sdk/` is gitignored.
- Licence: SDK files are never committed or published. CI fetches the SDK from the official URL itself and caches it per version in the (private) Actions cache — no secret, no private mirror. Only the compiled `.wasm` is distributed, like every other add-on.

## 2. Toolchain

- The SDK ships its own LLVM 15 (`WASM/llvm/bin/clang-cl.exe`, Asobo-patched `wasm-ld.exe`) — Windows binaries only.
- **Release build: Asobo's LLVM on a GitHub Actions Windows runner** (`windows-2025`, job `wasm`). The MSI is unpacked with `msiexec /a` (no install, no Visual Studio/MSBuild); `clang-cl.exe --driver-mode=g++` takes clang++-style flags. Flags = SDK MSBuild toolset (`WASM/vs/2022/Microsoft.Cpp.MSFS.Common.targets`), incl. `--stack-guard-page`. Single source: `wasm/build.sh`.
- `MSFS_WasmVersions.a` must be linked (exports `GetSimConnectVersion` / `GetExtensionVersion*`); without it the module is treated as a 2020 module.
- WASM features: MVP + bulk-memory only (`-mcpu=mvp -mbulk-memory`). `MSFS_WasmVersions.a` and the MobiFlight module carry just `bulk-memory`; Navigraph's `cargo-msfs` builds with `+bulk-memory` and runs `wasm-opt --signext-lowering`.
- Stock LLVM (`TOOLCHAIN=llvm`, Homebrew on the Mac): builds and validates, but **the sim does not load it**. History of attempts (all `Status: FAILED` in WASM Debug):
  1. 0.1.0/0.1.1 — clang 23 / 18 with sign-ext + mutable-globals.
  2. 0.1.2 — MVP + bulk-memory.
  3. 0.1.3 + probes — 1 MB stack placed first (like Navigraph). Even an empty `module_init`, as 2024 and as 2020 module, compiles in the sim and then fails with `WASM: Error getting memory in module …`.
  Remaining differences to Asobo's build are inside the toolchain (`--stack-guard-page`, LLVM 15 vs 18/23) → switched to the SDK's toolchain. The Mac build stays as a quick compile check.
- Mac: `brew install msitools llvm lld`.

## 3. Packaging

- A Community package is a folder: `manifest.json`, `layout.json`, `modules/<name>.wasm`. Standalone modules in `modules/` are loaded at sim start (no gauge, no panel.cfg).
- `layout.json` = inventory of the payload files only — **not** `manifest.json`, not itself: `{ "content": [ { "path", "size", "date" } ] }`, `date` = Windows FILETIME (100 ns ticks since 1601-01-01 UTC).
- `manifest.json`: `dependencies`, `content_type: "MISC"`, `title`, `manufacturer`, `creator`, `package_version`, `minimum_game_version`, `release_notes.neutral.{LastUpdate,OlderHistory}` — no `total_package_size`.
- The core SDK contains no manifest/layout schema (the Package Builder generates them). Reference: the Package-Builder-built MobiFlight event module 1.0.1 release zip. v0.1.0 listed `manifest.json` in `layout.json` and had `total_package_size` → did not load (PING timeout, no console line); fixed in 0.1.1.
- `scripts/build-bridge-package.ts` (`make wasm-package`) generates both — no `fspackagetool`.

## 4. H:-events

- MSFS 2024 has a dedicated API, `fsEventsRegisterHEvent(name)` + `fsEventsHEventCall(id, FsVarParamArray)` (`MSFS/MSFS_Events.h`). Tested live with the H145: **every call returns `FS_EVENTS_ERROR_FAIL` (0xFFFFFFFF), no effect.** Retired (bridge 0.1.5 drops it).
- RPN `(>H:NAME)` via `execute_calculator_code` works reliably — same path MobiFlight/AAO use. The plugin sends `H:NAME` as RPN `(>H:NAME)`.
- H145: the L:-var reflects the switch after **0.25–1 s** (JS systems) — state tiles lag accordingly.
- While a sim menu is open (e.g. controls settings) H:-events have no effect — the cockpit isn't running.

## Protocol (v1)

Two ClientData areas, both created by the bridge at `module_init`. All little-endian, no padding.

| Area | Name | Layout | Written by |
|---|---|---|---|
| command | `fs24.bridge.cmd` | `u32 seq`, `u32 op`, `char arg[1024]` (1032 B) | plugin |
| response | `fs24.bridge.rsp` | `u32 seq`, `i32 status`, `f64 value`, `char text[256]` (272 B) | bridge (read-only for others) |

- The bridge subscribes to `cmd` with `ON_SET` — no polling, idle cost ≈ 0. `seq = 0` is ignored.
- Ops: `1 PING` → `value` = protocol version, `text` = bridge version. `3 RPN` (`arg` = code) → `value` = float result, `text` = string result. Op `2` (H:-event via the 2024 API) is retired; H:-events are RPN `(>H:NAME)`.
- Status: `0` ok, `1` unknown op, `2` empty arg, `5` RPN failed (`3`/`4` belonged to the retired op 2).
- One slot: the plugin serialises commands and matches the response by `seq`.

## Live results

| Check | Result |
|---|---|
| Module loads (Dev Mode → WASM debug lists it, console shows init line) | ✅ 0.1.4 (Asobo toolchain); stock-LLVM builds ❌ (`Error getting memory`) |
| PING round trip from the Mac (`scripts/bridge-ping.ts`) | ✅ 25 ms, remote SimConnect port 502, DA42 |
| `H:` via `fsEventsHEventCall` | ❌ always `FS_EVENTS_ERROR_FAIL`, no effect (H145) |
| `(>H:…)` via RPN (plugin `H:NAME`) | ✅ H145 `H145_SDK_OH_PITOT_1_ON/OFF` → `L:H145_SDK_OH_PITOT_1` 0 → 1 → 0 within 0.25–1 s |
| AAO toggle script via `RPN:` | ✅ toggles both ways |
| Plugin `SimClient.fire()` K / H / RPN, three concurrent RPN | ✅ serialised, 33 / 67 / 100 ms |
| RPN read `(A:PLANE ALTITUDE, feet)` | ✅ value returned, 33 ms |
| RPN write `(>K:TOGGLE_NAV_LIGHTS)` | ✅ `(A:LIGHT NAV, Bool)` 0 → 1 → 0 |
| Pause via RPN: `1 (>K:PAUSE_SET)`, `(>K:PAUSE_ON)`, `(>K:ACTIVE_PAUSE_TOGGLE)` | ❌ accepted (status 0), no effect — neither sets nor clears Active Pause (toolbar icon, blue dot when active). Same as external SimConnect in M01: MSFS 2024 ignores pause key events from any client. Workaround for users: Stream Deck's built-in Hotkey action with the sim's pause key binding. `E:SIMULATION TIME` keeps running during Active Pause → not usable as a pause indicator. |
