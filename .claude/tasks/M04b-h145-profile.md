# M04b — HPG H145 profile

Depends on M04a (expression-driven actions). Reference files: gitignored `references/h145_aao/`.

## Goal

Replace the user's AAO-based H145 Stream Deck XL profile with one built on this plugin — same functional coverage, no external app.

## Inputs

- `docs/research/h145-aao-analysis.md` — patterns and counts.
- Local reference (not in repo): `references/h145_aao/H145.streamDeckProfile` (AAO, ~200 actions on 10 pages) and `references/h145_aao/H145_AxisAndOhsScripts.xml`.
- HPG H145 User Guide, L:Vars / H:Events chapters.

## Scope

- **Converter** `scripts/convert-aao.ts` (pattern: xp_streamdeck `convert-pilotsdeck.ts`, fflate, no shell zip): AAO profile + script XML → this plugin. Resolves `(>K:HYPE_H145-<label>)` to the script RPN (inline nested script calls, report `(WAIT:n)`), maps
  - `aao.event` → `command` (repeat, long press)
  - `aao.toggle` / `aao.onoff` → `var-toggle` (`event` / `event-on-off`; SDK `_ON`/`_OFF` pattern split where it matches, else `RPN:`)
  - value gauges → `var-display` with press action, or `var-switch` (ECP)
  - `aao.multigauge` → `var-state` (visibility layers → ordered states), wind gauge → `wind-display`
  - native Stream Deck actions (page nav, text) kept, page UUIDs remapped
  - prints a report of everything dropped or simplified.
- AAO images are third-party art — never copied; tiles are rendered by the plugin.
- Icons: catalog rows for the H145 buttons (`make icons`) where a static image helps.
- Profile: `profiles/H145.streamDeckProfile` (generated, own work — may be committed).

## Acceptance criteria

- [ ] Every action of the AAO profile has an equivalent, or is listed in issue #4 as deliberately dropped (with reason).
- [ ] Engine start, lights, AP modes/beeps, MFD softkeys tested in a real flight on the sim PC with the XL.
- [ ] State images follow the sim (switching in the virtual cockpit updates the button).
- [ ] Carried over from M04a: `var-display` press + auto-repeat (LUM key: value climbs while held, MFD powered) and `wind-display` heading-up (arrow turns with the aircraft, with wind set).
- [ ] `make check` green.

## Verification

Record results per step in issue #4 (no PRs during development).

**Mac (no sim):**

1. `tsx scripts/convert-aao.ts` on the reference files: report lists every AAO action as converted, simplified or dropped — counts add up to the profile's total; no unresolved `HYPE_H145-*` script calls, every `(WAIT:n)` reported.
2. Every generated RPN compiles with `src/util/rpn.ts` (read side) or is accepted by `parsePressAction` (press side); the converter fails on errors instead of emitting a broken button.
3. Unzip `profiles/H145.streamDeckProfile`: all pages present, page-nav targets point at remapped UUIDs, no AAO image files inside.
4. Optional, sim running: `scripts/smoke-state.ts` against a sample of the generated `var-state` rules (AP lamps, MFD softkey highlight).
5. `make check` green.

**Sim PC (`make gh-build` artefact, XL, H145 loaded cold & dark):**

1. Install the plugin, double-click the profile, select it on the XL. Install the WASM bridge from the PI if it's missing. Page nav: every page reachable and back.
2. Cold start → engines running using only the deck: battery, fuel pumps, engine start sequence; the engine status tiles follow.
3. Lights: every light button toggles; flip the same switch in the VC → the tile follows (state image criterion).
4. MFD: softkeys on every MFD, mode-dependent highlight follows `L:MFD*_Mode`; LUM key held → brightness climbs (auto-repeat, MFD powered).
5. In flight: AP modes on and off, mode lamps and bug values match the VC; beep keys (short, long, held) move the bugs; mode-dependent beep labels switch.
6. Wind display with wind set in the weather: the arrow turns with the heading (heading-up).
7. Aircraft change (or reload) and reconnect (restart the sim): tiles recover with no plugin restart.
8. Go through the drop list from the converter report: confirm every drop is intentional.
