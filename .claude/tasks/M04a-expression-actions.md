# M04a — Expression-driven actions (H145 prerequisites)

## Goal

Close the feature gaps the AAO H145 profile exposed, generically (reusable for M05), so M04b can convert the profile mechanically.

## Background (inventory 2026-11-10, reference files in gitignored `references/h145_aao/`)

213 buttons on 8 pages: 40 native Stream Deck (page nav / text), 54 `aao.event`, 37 `aao.toggle`/`onoff`, 20 value gauges with a press event, **60 `aao.multigauge`** (layered images/texts, each layer shown when an RPN expression holds), 2 `aao.btn` (AAO joystick emulation → dropped).

- AAO `(S:<rpn>)` = inline RPN expression computing a value, **not** script state.
- AAO `(>K:HYPE_H145-<label>)` = call of an AAO script from the XML; all resolve to RPN bodies runnable via the bridge (`RPN:`).
- State the scripts keep lives in AAO-created L:-vars (`L:MFD1_Mode`, …) — written by the RPN, read via SimConnect. No plugin state needed.
- L:-var units are ignored by SimConnect in 2024 (`L:…, Bool` returns the raw number, verified live).

## Scope

1. **Plugin-side RPN evaluator** (`src/util/rpn.ts`): compile once, extract `(A:…)`/`(L:…)` refs, subscribe them via `VarRegistry`, re-evaluate on change. Subset: arithmetic, comparisons, `and`/`or`/`!`/`not`, `if{ } els{ }`, `sN`/`lN`/`spN`, `d`/`p`/`r`, `abs`/`min`/`max`/`neg`/`flr`/`ceil`/`near`, `dnor`/`dgrd`/`rddg`. Unknown token → compile error (no silent misbehaviour). Bridge evaluation was rejected: ~33 ms per serialised round trip, polling only.
2. **`var-state` action**: ordered state list (`condition | style | text`), first match wins; text placeholders `{<rpn>}` with optional format; press action (K:/H:/RPN:), auto-repeat, long press.
3. **`command`**: long-press action.
4. **`var-display`**: optional press action + auto-repeat.
5. **`wind-display`**: port from xp_streamdeck (A:AMBIENT WIND DIRECTION/VELOCITY, PLANE HEADING DEGREES TRUE).

Graphic AAO gauges (hover vector, bambi bucket, hoist cable, slider art) become text/lamp tiles via `var-state`; dedicated renderers only if missed in flight.

## Acceptance criteria

- [x] RPN evaluator covers every `S:` / visibility expression of the AAO profile (script check against the inventory: 141/142; the wind-rose rotation `ddiff` is replaced by `wind-display`).
- [ ] `var-state`, `wind-display`, long press, display press work against the live sim (H145 loaded).
  - [x] `var-state` follows `L:H145_SDK_DOOR_COCKPIT_L` (gray → amber "DOOR L / OPEN"), press fires the H:-event (sim PC + XL, 2026-11-10)
  - [x] `command` long press: short = left door, held ≥ 500 ms = right door, no short fire on hold (2026-11-10)
  - [ ] `var-display` press + auto-repeat (`H:MFD1_SoftKey_LUM_UP`, value `A:LIGHT POTENTIOMETER:9, Percent` climbs while held)
  - [ ] `wind-display` heading-up (arrow turns with the aircraft)
- [x] `make check` green.
