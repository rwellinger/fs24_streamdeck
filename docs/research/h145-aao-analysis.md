# HPG H145 — Variable/Event Analysis (2026-11-09)

Source material (local only, **not** in this repo — third-party licence):
`~/Downloads/H145_2_0_vsL6a/H145_AxisAndOhsScripts.xml` (AAO scripts, Jan 2025, MSFS 2024-ready)
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
- `S:` (109 reads, 2 writes) — AAO-internal script variables; becomes plugin-side state here

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
