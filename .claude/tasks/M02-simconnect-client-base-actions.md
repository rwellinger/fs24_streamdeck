# M02 — SimConnect client + base actions

## Goal

A robust SimConnect client with subscriptions, and the core actions that cover the "standard" aircraft (Cabri G2, R66, DA42, Kodiak) without the WASM bridge.

## Prerequisites

M01 done; read `docs/research/simconnect-spike.md` first — its findings override assumptions here.

### Carried over from M01 (do first)

- **Remote dev loop:** Mac → sim PC on port `503` doesn't connect yet (entry + firewall rule exist). Start with `nc -vz <sim-pc-ip> 503`, then fix SimConnect.xml / firewall / network profile.
- **Smoke script** (`scripts/smoke-simconnect.ts`) against the live sim, Cabri loaded: `FS24_PORT=503 FS24_WATCH_VAR="LIGHT STROBE" FS24_BEVENT=FUEL_PUMP FS24_BEVENT_VALUE=1 FS24_QUIT_WATCH_S=120`; L:-var step again with the H145. Fill the open rows in the spike doc. Step 6 decides whether B:-events are in scope below; step 5b decides whether unknown K:-names can be detected.
- **Offline tile:** a user-set Stream Deck title always overrides `setTitle()`, so it overlaps "SIM OFFLINE". Redesign `renderSimOfflineIcon()` as a top/bottom band that leaves the centre free for the title.

## Scope

### Client (`src/sim/`)

- Variable path syntax, parsed once (replaces X-Plane's `dataref-path`): `A:NAME[:index], unit`, `L:name[, unit]`, `B:name`, `K:EVENT`. Unit defaults: `Number` for L:, mandatory for A:.
- Subscriptions: one data definition per (path, unit), ref-counted across buttons; `PERIOD_SIM_FRAME` + `CHANGED`. Re-register all definitions/events after reconnect (IDs are connection-scoped).
- K:-events with optional value (`HEADING_BUG_SET 180`); repeat for nudges via `TIMINGS`.
- Writing settable A:-vars and L:-vars.
- B:-input events (read/set/subscribe) — only if M01 confirmed they work.
- Aircraft change: re-resolve on `AircraftLoaded` / flight load; L:-vars of the previous aircraft must not leak.
- Narrow `SimValue` to what SimConnect actually delivers; strip X-Plane `data`-type decoding from `format.ts`.

### Actions (port from xp_streamdeck, rename `dataref-*` → `var-*`)

| Action | X-Plane source | Notes |
|---|---|---|
| `command` | `command.ts` | K:-event (+value), long-press repeat |
| `var-toggle` | `dataref-toggle.ts` | state from any readable var; press = K:-event **or** write value; on/off images |
| `var-display` | `dataref-display.ts` | printf format via `formatSimValue` |
| `var-switch` | `dataref-switch.ts` | 3-position |
| `var-lamp` | `dataref-lamp.ts` | |
| `rotary` / `encoder` | `rotary.ts`, `encoder.ts` | Stream Deck + dials, if wanted |

Also port `condition.ts` (press condition) if a ported action needs it. Rename the action-library icon keys in `scripts/generate-icons.ts` / `template.ts` together with the actions.

### PI

Port `xplane-pi-helpers.js` as `sim-pi-helpers.js`; field hints show the path syntax.

## Out of scope

H:-events, RPN, H145-specific actions (M03/M04), profiles per aircraft (M05).

## Acceptance criteria

- [ ] Cabri G2: strobe / nav light toggle shows live state and switches (the Cabri has no beacon); IAS/altitude display updates smoothly.
- [ ] DA42: AP HDG mode toggle + heading bug nudge (K:-events) work; bug value display updates.
- [ ] Aircraft change without restarting Stream Deck: buttons re-bind, no stale values.
- [ ] MSFS restart: all buttons recover (offline tile → live).
- [ ] `make check` green.

## Verification

Manual run from the Mac against the sim PC with the four aircraft above; note results per aircraft in the milestone issue (no PRs during development).
