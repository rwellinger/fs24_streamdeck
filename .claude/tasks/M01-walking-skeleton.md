# M01 — Walking Skeleton: one button pauses MSFS over remote SimConnect

## Goal

Prove the whole chain end-to-end with the thinnest possible slice:
Stream Deck app on the **Mac** → plugin → `node-simconnect` over TCP → MSFS 2024 on the **sim PC** → sim pauses.
Everything later builds on this loop; if it doesn't work, the dev-setup concept ("sim PC stays clean") must be revisited before anything else.

## Scope

### Part A — sim PC configuration (user, guided)

- Locate the MS Store `SimConnect.xml` (expected: `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml`). Verify the path, correct it in `CLAUDE.md`.
- Add a TCP/IPv4 `SimConnect.Comm` entry bound to the PC's LAN address on a fixed port (e.g. 500), keep the local pipe entry.
- Windows firewall: inbound rule for that port, private network only.
- No other software on the sim PC.

### Part B — smoke script (Mac)

`scripts/smoke-simconnect.ts` (tsx, not bundled), host/port via env (`FS24_HOST`, `FS24_PORT`):

1. Connect, log app name/version (proves 2024 is detected).
2. Read `A:PLANE ALTITUDE, feet` and `A:LIGHT BEACON, Bool` once.
3. Subscribe to `A:LIGHT BEACON, Bool` with `PERIOD_SIM_FRAME` + `DATA_REQUEST_FLAG_CHANGED`; log changes for 20 s while the user flips the switch.
4. Read an L:-var with the `L:` prefix — use an H145 SDK var (`L:H145_SDK_OH_PITOT_1, Number`) if the H145 is loaded, otherwise any L:-var of the loaded aircraft.
5. Fire `K:PAUSE_TOGGLE` twice (on/off).
6. **Input events (B:):** enumerate input events of the loaded aircraft, log count + first 20 names; read one, set one. Result decides how much of M05 works without the WASM bridge.
7. Disconnect cleanly; also observe behaviour when MSFS is closed mid-run (error vs. silent hang).

Write the findings (what worked, what didn't, exact errors) into `docs/research/simconnect-spike.md`.

### Part C — plugin skeleton

- Scaffold the bundle `com.robertw.fs24.sdPlugin/` (`manifest.json`, `bin/`, `imgs/`, `ui/`) — `npx streamdeck create` into a temp dir and take manifest/structure from there, or adapt xp_streamdeck's manifest. UUID `com.robertw.fs24`, manifest OS: Windows **and** macOS (macOS only so the plugin runs in the Mac dev loop).
- `src/sim/client.ts`: minimal connection (connect, reconnect with backoff, `isOffline()`, event mapping for K:-events). No subscriptions yet.
- Connection target configurable via a global setting (host/port, default `localhost` / pipe). Set from the PI of the action.
- One action `command` (K:-event by name, e.g. `PAUSE_TOGGLE`), PI with one text field. `showOk()` / `showAlert()` per conventions; offline tile via `error-tile.ts`.
- `make icons` works (bundle `imgs/` dir exists), `make build` produces `bin/plugin.js`.

## Out of scope

Subscriptions in the plugin, display/toggle actions, WASM, packaging for the sim PC.

## Acceptance criteria

- [ ] Smoke script runs from the Mac against the sim PC; steps 1–5 succeed, step 6 result documented.
- [ ] `docs/research/simconnect-spike.md` written; MS Store paths in `CLAUDE.md` verified.
- [ ] Button on the (virtual) Stream Deck on the Mac pauses/unpauses MSFS on the sim PC.
- [ ] MSFS closed → button shows offline tile; MSFS restarted → button works again without restarting Stream Deck.
- [ ] `make check` and `make build` green.

## Verification

1. `FS24_HOST=<pc-ip> FS24_PORT=500 npx tsx scripts/smoke-simconnect.ts`
2. `make deploy`, press the button, observe pause in the sim.
3. Quit MSFS → press → alert/offline tile. Start MSFS, load a flight → press → pause works.
