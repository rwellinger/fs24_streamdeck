# fs24_streamdeck — Stream Deck Plugin for MSFS 2024

## Goal

A Stream Deck plugin (Windows; Elgato Stream Deck XL) that controls Microsoft Flight Simulator 2024 — generic enough to drive any SimVar, L:-var, K:-event, B:-input event or H:-event from a button, including state-based images.

**Hard product rule: no external app, no daemon.** The user installs the Stream Deck plugin and nothing else that runs as its own process. AAO, SPAD.neXt, FSUIPC, MobiFlight Connector were rejected precisely because they need one. The only permitted extra is our own WASM module inside the sim (runs in the MSFS process, no separate process), and the plugin installs it itself.

Sibling project: `~/Workspace/x-plane/xp_streamdeck` (X-Plane 12). Sim-agnostic code was **copied** from there once (not forked, no shared package). Divergence is accepted; extract a shared library only if identical changes keep landing in both repos.

## Architecture — two components

1. **Stream Deck plugin** (TypeScript, Node 24, `@elgato/streamdeck`) — talks SimConnect directly via `node-simconnect` (pure JS protocol implementation, no native addon). Covers A:-SimVars, K:-events, L:-vars (via `L:` prefix in data definitions, SDK ≥ SU12), B:-input events.
2. **WASM bridge** (C++, MSFS SDK, `wasm/`) — tiny in-sim module reached via SimConnect ClientData. Only for what SimConnect cannot do: fire H:-events, execute RPN calculator code. No logic beyond that.

## Tech Stack

- **Language:** TypeScript (strict), C++ (WASM bridge only)
- **Runtime:** Node.js 24+ (required by `@elgato/streamdeck`)
- **SimConnect client:** `node-simconnect` (npm, EvenAR)
- **Bundler:** Rollup
- **Property Inspector:** HTML + vanilla JS + `@elgato/sdpi-components` v4
- **Target:** Windows 10/11 (sim PC). The manifest also lists macOS — only so the plugin runs in the Mac dev loop, not a supported end-user platform. MSFS 2024 is the **Microsoft Store** edition.
- **Plugin UUID:** `com.robertw.fs24` → bundle `com.robertw.fs24.sdPlugin/`

## Development Setup — the sim PC stays clean

| Task | Where |
|---|---|
| Write / build / lint TS plugin | Mac |
| Run the plugin against the live sim | Stream Deck app on the **Mac**, SimConnect over TCP to the sim PC |
| Compile WASM bridge | Mac (clang/wasi-sdk) or GitHub Actions — never on the sim PC |
| Package the WASM module | script-generated `layout.json` / `manifest.json`, no `fspackagetool` |
| Debug WASM | MSFS Developer Mode console |
| Final acceptance | sim PC: double-click `.streamDeckPlugin`, like a normal user |

**No Node, Visual Studio, MSFS SDK or any dev tool gets installed on the sim PC.** The only allowed changes there: SimConnect remote-access config (`SimConnect.xml`) plus a firewall rule, and installing the release artefacts.

MS Store paths:
- `SimConnect.xml`: `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml` (verified M01). Ships with a pipe, IPv4 `500` and IPv6 `501` entry (local scope). Remote dev access = additional global IPv4 entry on `502`. A plugin on the sim PC connects locally with no config (node-simconnect autodetect).
- `UserCfg.opt` (holds `InstalledPackagesPath`, → Community folder): `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt` (not yet verified — needed in M03)

### MSFS SDK licensing

SDK headers/libs must **never** be committed (`/sdk/` is gitignored). The repo is **public** (since M01) — SDK files and third-party profiles/scripts must stay out. How CI obtains them is decided in M03.

## MSFS variable model (vs. X-Plane)

| MSFS | Read | Write | Path |
|---|---|---|---|
| `A:` SimVar | yes | some (settable SimVars) | SimConnect, needs **unit** (`A:LIGHT BEACON, Bool`), index via `:n` |
| `K:` event | – | trigger (+ value) | SimConnect `MapClientEventToSimEvent`. Pause events (`PAUSE_TOGGLE`/`PAUSE_SET`) have no effect in 2024 from an external client → test via WASM RPN in M03 |
| `L:` var | yes | yes | SimConnect data definition with `L:` prefix |
| `L:1:` scoped var (2024-native aircraft) | flaky | flaky | known SimConnect issues — avoid, fall back to WASM |
| `B:` input event | yes | yes | SimConnect InputEvent API — verified (enumerate/get/set); enumeration contains duplicates, dedupe by hash |
| `H:` event | – | trigger | **WASM bridge only** |
| RPN calculator code | – | execute | **WASM bridge only** |

- SimConnect IDs (define/request/event IDs) are **connection-scoped** — re-register on every reconnect.
- X-Plane `beginCommand`/`endCommand` (hold) has no equivalent; emulate per action.
- Aircraft-specific names: HPG H145 analysis in `docs/research/h145-aao-analysis.md`. Third-party AAO scripts / profiles are reference only — never commit them.

## Project Structure

```
fs24_streamdeck/
├── com.robertw.fs24.sdPlugin/   # Plugin bundle (created in M01)
├── src/
│   ├── plugin.ts                # Entry; registers actions (M01)
│   ├── actions/                 # One file per action type
│   ├── sim/                     # SimConnect client, subscriptions, WASM bridge client
│   └── util/                    # Helpers (copied from xp_streamdeck)
├── wasm/                        # C++ WASM bridge (M03)
├── scripts/                     # tsx utilities (icon generator, smoke tests)
├── docs/research/               # Aircraft analyses
└── .claude/tasks/               # Milestone task files
```

## Working Style

- **Walking skeleton first, then layer up.** M01 (one button → MSFS pause, over remote SimConnect) is the foundation.
- **One milestone per session.** Each `.md` in `.claude/tasks/` is self-contained. Re-read it; don't rely on earlier session context.
- **Issue first:** every milestone has a GitHub issue; PRs reference it with `Closes #N`.
- **English** in all code, comments, manifest strings and milestone files. Communication with the user is German.
- **Default to no comments.** Only when the *why* is non-obvious.
- **No premature abstractions.** Three similar lines beat a flexible factory.
- **Verification before claiming done.** Run each milestone's verification steps.
- **Pre-commit gate:** `make check` (Biome lint + `tsc --noEmit`) must be green.

## Action Implementation Conventions (inherited from xp_streamdeck)

- **Settings type:** `type FooSettings = JsonObject & { … }`; `JsonObject` comes from `@elgato/utils`.
- **Feedback on `keyDown`:** `showOk()` on success (optionally opt-out), `showAlert()` on **every** failure path including empty/invalid config. Never gate `showAlert()` behind a setting.
- **Checkboxes:** unchecked = baseline, checked = opt-in deviation; test with `=== true`.
- **PI** lives in `com.robertw.fs24.sdPlugin/ui/<action>.html`, sdpi-components v4 from `https://sdpi-components.dev/releases/v4/sdpi-components.js`.
- **No floating promises** (Biome `noFloatingPromises`). `.catch((err) => streamDeck.logger.error(...))` or `await`.
- Read settings via `ev.payload.settings`; trim string inputs.
- **`STATE_DIRTY = -1`** to force the next render after settings change / reconnect / re-subscription.

## Shared Helpers (copied, adapt as needed)

- `src/sim/types.ts` — `SimValue` (replaces X-Plane's `DataRefValue`; narrow it once the SimConnect client exists).
- `src/util/coerce.ts` — `toFiniteNumber`, `coerceNumber`, `describeValue`.
- `src/util/settings.ts` — `trimString`, `trimStringOr`, `normalizeFormat`.
- `src/util/format.ts` — `formatSimValue` (printf-style). Still contains X-Plane `data`-type decoding — strip it when the first display action lands.
- `src/util/error-tile.ts` — offline / not-found tiles.
- `src/util/*-svg.ts`, `*-image.ts` — runtime tile renderers (lamp, switch, toggle, selector, multi-display, wind).
- `src/const.ts` — `TIMINGS`, `TOLERANCE_FLOAT`.

Not copied (X-Plane-specific, port when needed): `dataref-path`, `condition`, `macro-*`, all actions, the client, all PIs. Port from `~/Workspace/x-plane/xp_streamdeck/src/` when a milestone needs them.

## Button Icon Pipeline

Copied 1:1 from xp_streamdeck — see that repo's `CLAUDE.md` for the full description (kinds `toggle` / `display` / `nudge` / `background`, groups → accent color in `GROUP_ACCENT`, Inter font embedded). `make icons` → `out/icons/`. Action-library icon names in `scripts/generate-icons.ts` / `template.ts` still use X-Plane action names (`dataref-*`) — rename together with the actions.

## Test Environment Reality

- Dev Mac: no physical Stream Deck (virtual deck), no MSFS. MSFS 2024 runs on the Windows sim PC only.
- Live testing = Stream Deck on the Mac + remote SimConnect to the sim PC.
- Final hardware verification on the sim PC with the Stream Deck XL.
- An aircraft must be loaded and running for its L:/H: names to exist.

## References

- MSFS 2024 SDK docs: <https://docs.flightsimulator.com/msfs2024/html/Introduction/Introduction.htm>
- node-simconnect: <https://github.com/EvenAR/node-simconnect>
- MobiFlight WASM module (architectural reference for the bridge, study don't copy): <https://github.com/MobiFlight/MobiFlight-WASM-Module>
- HubHop presets (variable discovery): <https://hubhop.mobiflight.com>
- Elgato plugin samples: <https://github.com/elgatosf/streamdeck-plugin-samples>
