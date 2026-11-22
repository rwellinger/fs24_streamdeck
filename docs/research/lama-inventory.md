# Lama SA315B (Taog's Hangar) — inventory

Marketplace package `taog-lama-sa315` 1.3.0 (OneStore, installed under `Packages\Official2020` — an
MSFS 2020 aircraft running in 2024 with little conversion). Aircraft `TITLE` starts with `Lama SA315B`.

## Sources

- The package is encrypted (`.fsarchive`); systems/model XML cannot be read. The interior glTF
  (`model/lama_int_lod01.gltf.fsc`) is only zlib-compressed — its node names list the cockpit
  controls, but carry no behaviours.
- Live, read-only over SimConnect (2026-11-22): input-event enumeration (90 B: events) plus a
  change watch on B: events and common A: SimVars during a cold & dark start-up.
- No AAO profile exists for this aircraft.

## Verified during start-up (state → var)

| Control | Read | Write / trigger |
|---|---|---|
| Rotor brake | `A:ROTOR BRAKE HANDLE POS, Percent`, `A:ROTOR BRAKE ACTIVE, Bool` | `K:ROTOR_BRAKE` (not tested) |
| Fuel valve | `A:FUELSYSTEM VALVE SWITCH:1, Bool` | `B:FUEL_VALVE_1` |
| Battery | `A:ELECTRICAL MASTER BATTERY, Bool` | `B:ELECTRICAL_BATTERY_1` |
| Generator | `A:GENERAL ENG MASTER ALTERNATOR:1, Bool` | `B:ELECTRICAL_ALTERNATOR_1` |
| Strobe | `A:LIGHT STROBE, Bool`, `A:LIGHT STROBE ON, Bool` | **not controllable** — see below |
| Starter (held ~24 s) | `A:GENERAL ENG STARTER:1, Bool`, `A:GENERAL ENG STARTER ACTIVE:1, Bool` | `K:TOGGLE_STARTER1` reported not working; probably internal state like the strobe |
| Landing light | `A:LIGHT LANDING, Bool` | `B:LIGHTING_LANDING_1` (verified write) |
| Starter cover (?) | `B:DEICE_PANEL_ALTERNATE_COVER` | same |
| Pitot heat | `A:PITOT HEAT, Bool` | `B:DEICE_PITOT_1` |
| Governor | `A:ROTOR GOV SWITCH POS, Bool`, `A:ROTOR GOV ACTIVE, Bool` | not tested |
| Engine running | `A:GENERAL ENG COMBUSTION:1, Bool` | – |

Displays (live values, engine running): `A:ROTOR RPM PCT:1`, `A:TURB ENG N1:1`, `A:TURB ENG ITT:1`
(Celsius), `A:ENG TORQUE PERCENT:1`, `A:ENG OIL PRESSURE:1` (PSI), `A:FUEL TOTAL QUANTITY`
(Gallons), `A:ELECTRICAL MAIN BUS VOLTAGE`.

## Strobe: read-only

The strobe switch keeps its position in aircraft-internal state (the INI framework the Lama is
built on). Only a mouse click changes it; everything set from outside is reverted in the same frame.

| Tried | Result |
|---|---|
| `K:STROBES_TOGGLE` / `_ON` / `_OFF` / `_SET` over SimConnect | no effect |
| `(>K:STROBES_ON)` / `(>K:STROBES_OFF)` as RPN via the WASM bridge | `A:LIGHT STROBE` flips, Lama reverts it at once |
| `L:INI_STROBE_LIGHT_SWITCH` write | no effect; unchanged by a mouse click |
| `L:S_OH_EXT_LT_STROBE` write | no effect |
| AAO event observer (K: and H:) on a mouse click | only the `(>K:STROBES_ON)` side effect, no H: event |

A mouse click moves `A:LIGHT STROBE` / `A:LIGHT STROBE ON` reliably → the profile shows the strobe
as a `var-state` indicator only. The starter likely behaves the same way.

## Present but not yet verified

- B: events: `LIGHTING_LANDING_1`, `LIGHTING_PANEL_1`, `LIGHTING_GLARESHIELD_1`,
  `TAOG_LIGHT_SEARCH_X` / `_Y` (search light pan/tilt), `FUEL_CUTOFF_1`, `DEICE_ENGINE_1`,
  `PASSENGER_CABIN_AIR_1`, `SAFETY_ELT_1`, `INSTRUMENT_ATTITUDE_INDICATOR_CAGE`,
  `INSTRUMENT_CLOCK_STOPWATCH`, `HELICOPTER_ENGINE_THROTTLE_1`, trims, full `NAVCOM_*` / `AS430_*` sets.
- Cockpit nodes without a B: event (likely L: vars, names unknown): search light switch, blower,
  DIR GYRO/ATT switch, fuel pump, clutch, cargo hook and all `VIS_*` options (sling, bambi bucket,
  winch, skis/wheels/floats, mirror, doors, camera mount).
  → Behaviors debug window, or an L:-var listing command in the WASM bridge.

## Camera (read live)

| View | `CAMERA STATE` | `CAMERA VIEW TYPE AND INDEX:0` / `:1` | `CAMERA SUBSTATE` |
|---|---|---|---|
| Cockpit pilot | 2 | 1 / 7 | 1 |
| External / custom external | 3 | 0 / 0 | 1–2 |
| Instrument view (probable) | 2 | 2 / 0 | 5 |

Custom camera slots are not distinguishable in these vars → loaded via the Stream Deck hotkey
action (the profile uses Numpad 1–9, the user's own bindings). Writing `CAMERA VIEW TYPE AND INDEX`
had no effect; `K:VIEW_CAMERA_SELECT_n` / `K:VIEW_RESET` neither (test may have run with the sim
in a menu).
