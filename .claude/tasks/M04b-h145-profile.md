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

- [ ] Every action of the AAO profile has an equivalent, or is listed in the PR as deliberately dropped (with reason).
- [ ] Engine start, lights, AP modes/beeps, MFD softkeys tested in a real flight on the sim PC with the XL.
- [ ] State images follow the sim (switching in the virtual cockpit updates the button).
- [ ] Carried over from M04a: `var-display` press + auto-repeat (LUM key: value climbs while held, MFD powered) and `wind-display` heading-up (arrow turns with the aircraft, with wind set).
- [ ] `make check` green.
