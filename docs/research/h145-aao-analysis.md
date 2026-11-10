# HPG H145 — Variable/Event Analysis (2026-11-09)

Source material (local only, gitignored `references/h145_aao/` — third-party licence):
`H145_AxisAndOhsScripts.xml` (AAO scripts, Jan 2025, MSFS 2024-ready)
and `H145.streamDeckProfile` (AAO Stream Deck XL profile, ~200 actions, 10 pages).

## Findings

AAO scripts (97 real scripts, separators excluded) — what each script **writes**:

| Writes | Scripts | Reachable via plain SimConnect |
|---|---|---|
| H: only | 71 | no |
| H: + L: | 14 | no |
| H: + K: | 4 | no |
| K: only | 8 | yes (AP HDG/ALT/IAS fast) |

→ 89/97 (92 %) need an H:-event.

AAO Stream Deck profile — references across all actions:

- Writes: 98× `>H:`, 78× `>K:`, 2× `>L:`
- Reads (state/display): 283× `L:`, 93× `A:` — all readable via SimConnect
- `S:` (109 reads, 2 writes) — **inline RPN expressions** `(S:<rpn>)` computing a value (visibility / text of gauge layers). Correction 2026-11-10: not script state. → plugin-side RPN evaluator (M04a)

Distinct names: 104 H:-events, 25 L:-vars. Nearly all follow HPG's hardware SDK naming.

## Pattern

HPG's hardware SDK is uniform — state from an L:-var, switching via `_ON` / `_OFF` H:-events:

```
(L:H145_SDK_OH_PITOT_1, Number) 0 == if{ 1 (>H:H145_SDK_OH_PITOT_1_ON) } els{ 1 (>H:H145_SDK_OH_PITOT_1_OFF) }
```

MFD softkeys are plain H:-events (`H:MFD1_SoftKey_T1`, `H:MFD2_SoftKey_KnobOuterClockwise`, …).
Display/mode state uses non-SDK L:-vars (`L:MFD1_Mode`, `L:HPGAP_CYC_LR`, …).

## Consequence

- Read side: plain SimConnect is sufficient.
- Write side: the H145 is unusable without the in-sim WASM bridge (M03).
- Authoritative name lists: HPG H145 User Guide, chapters "L:Vars" and "H:Events"
  (<https://davuxcom.github.io/hpg-docs-2/docs/pdf/H145%20User%20Guide.pdf>).
  Cross-check presets on HubHop (MSFS filter) which shows the calculator code per preset.

## Inventory 2026-11-10 (M04a)

213 buttons on 8 pages (+1 empty): 40 native Stream Deck (page nav / profile / text), 54 `aao.event`, 34 `aao.toggle`, 3 `aao.onoff`, 20 value gauges with a press event (`gaugetext` / `steamgauge` / `slidergauge`), 60 `aao.multigauge`, 2 `aao.btn` (AAO virtual-joystick button → no equivalent, dropped).

- `(>K:HYPE_H145-<label>)` in the profile is not a K:-event but a call of the AAO script `<label>` in group `HYPE_H145`. All 49 referenced scripts resolve; bodies are SDK `_ON`/`_OFF` toggles or `1 (>H:X)`, runnable as `RPN:` via the bridge. Exceptions: one `(WAIT:50)` (battery master, AAO-only), two nested script calls.
- Scripts keep page/mode state in AAO-created L:-vars (`L:MFD1_Mode`, `L:MFD2_B3_Mode`, `L:MFD2_B5_Mode`, `L:MFD4_Mode`, `L:H145LAVACS`, `L:SwitchLAVACSPrev`, `L:AAOWindVal`). They drift when the VC is clicked directly — same as with AAO.
- `multigauge` = stacked image/text layers, each visible when an RPN expression holds. Semantics: MFD softkey highlight (17), AP mode lamps + bug values (12), mode-dependent beep labels (8), engine status / battery (3), wind rose (4), hover vector / bucket / hoist cable (graphic).
- All 72 referenced L:-vars read live via SimConnect TCP with plausible values (non-existent L:-vars would also read 0).
- SimConnect ignores the unit on L:-vars: `(L:H145_SDK_MFD2_NavSource, Bool)` returns 3 (verified live).
