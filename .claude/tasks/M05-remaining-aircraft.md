# M05 — Remaining aircraft: inventory + profiles

## Goal

Profiles for the user's other aircraft: DA42 (G1000 NXi), Kodiak (G1000 NXi), Cabri G2, R66.

## Scope

1. **Inventory per aircraft** (before building anything): the user's 10–15 most wanted buttons; for each, which var/event it uses (A:/K:/L:/B:/H:). Sources: MSFS Developer Mode → Behaviors debug window, HubHop presets. Write `docs/research/<aircraft>-inventory.md`.
2. Close gaps in actions found by the inventory (e.g. a G1000 softkey needs H: → already possible after M03).
3. Icons + profiles per aircraft in `profiles/`.

## Acceptance criteria

- [ ] Four inventory docs written.
- [ ] Four profiles committed, each tested in a flight on the sim PC.
- [ ] `make check` green.
