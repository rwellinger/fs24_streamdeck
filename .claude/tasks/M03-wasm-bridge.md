# M03 — WASM bridge: H:-events and RPN from the plugin

## Goal

A minimal in-sim WASM module that lets the plugin fire H:-events and execute RPN calculator code — the gap plain SimConnect can't close (92 % of H145 actions depend on it, see `docs/research/h145-aao-analysis.md`). Installed by the plugin itself; no separate app.

## Open questions — resolve first, document in `docs/research/wasm-bridge.md`

1. **SDK files:** where to get the MSFS 2024 SDK (WASM headers + libs) without installing it on the sim PC; whether extracting on the Mac works. Licence: may they live in a private CI cache / secret? Never in git (`/sdk/` is gitignored).
2. **Toolchain:** build on the Mac (clang + wasi-sdk or the SDK's own clang) vs. GitHub Actions (Windows runner). Prefer whatever needs no tooling on the sim PC.
3. **Packaging:** generate `layout.json` + package `manifest.json` by script (as MobiFlight/FBW do) instead of `fspackagetool`.
4. Does `execute_calculator_code` cover H:-events (`(>H:name)`) reliably in 2024, or is `trigger_key_event` / a dedicated API better?

## Scope

### WASM module (`wasm/`, C++)

- Standalone module (not a gauge), package name e.g. `fs24-streamdeck-bridge`.
- One SimConnect ClientData area for commands (plugin → sim) and one for responses (sim → plugin): fixed-size records, sequence number, status.
- Commands: `exec_rpn <string>` (covers H:-events and L:-var writes). Optional later: `read_rpn` for computed values.
- No polling loops beyond what the ClientData subscription needs; idle cost ≈ 0.
- Study MobiFlight's WASM module for the ClientData protocol — don't copy.

### Plugin side

- `src/sim/bridge.ts`: detect bridge presence (handshake with version), send RPN, timeout + `showAlert()` when absent.
- Path syntax extension: `H:EVENT_NAME` and `RPN:<code>` as press actions in `command` / `var-toggle`.
- **Self-install:** read `InstalledPackagesPath` from the MS Store `UserCfg.opt`, copy the bundled package into `Community/` if missing or outdated; the user confirms once (PI button or first-run prompt). Must work when the plugin runs on the sim PC only (the Mac dev loop skips this).

## Out of scope

H145 actions/profile (M04).

## Acceptance criteria

- [x] Module builds without any tooling on the sim PC; build documented and reproducible. — GitHub Actions Windows runner with the SDK's own LLVM, SDK fetched from the official URL into the Actions cache (`docs/research/wasm-bridge.md`).
- [x] With the H145 loaded: `H:H145_SDK_OH_PITOT_1_ON` from a `command` button switches the pitot heat; state readable via `L:H145_SDK_OH_PITOT_1`. — pilot + co-pilot pitot via buttons on the sim PC, switch state tile correct.
- [x] RPN string from a button works (e.g. the toggle script from the analysis doc). — toggle script toggles both ways.
- [x] Bridge missing → clear alert on press, no crash, log entry explains. — verified on the sim PC (MSFS started without the bridge).
- [x] No measurable sim FPS impact with the bridge loaded and idle (compare dev-mode FPS counter). — 60 fps capped, all green; WASM Debug callbacks avg 0.010 ms / max 0.028 ms.
- [x] `make check` green.

Answers to the open questions: `docs/research/wasm-bridge.md`. Self-install verified (linked package left alone; real install from the PI button, active after MSFS restart).
