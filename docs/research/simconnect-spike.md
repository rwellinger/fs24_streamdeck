# SimConnect spike (M01)

Findings from bringing up the walking skeleton against MSFS 2024 (MS Store). From the plugin running **locally on the sim PC** and the smoke script run **remotely from the Mac** (port 502, Cabri G2 loaded).

## Setup

| | |
|---|---|
| Date | 2026-11-09 |
| MSFS reported by SimConnect | `SunRise 12.2` (= MSFS 2024) |
| node-simconnect | 4.2.1 |
| Protocol requested | `KittyHawk` — accepted by MSFS 2024 |
| Aircraft | Guimbal Cabri G2 |
| Client | Stream Deck plugin on the sim PC (installed from CI artifact), host empty → local autodetect |

## Paths and default config (MS Store edition)

| Item | Result |
|---|---|
| `SimConnect.xml` | `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml` — exists |
| Default entries | named pipe, IPv4 port `500` (local scope), IPv6 port `501` |
| Remote dev entry | added: IPv4, global scope, LAN IP, port `502` + firewall rule (private profile) |
| Local connect (plugin on sim PC, host empty) | **works** — node-simconnect autodetect, no config needed |
| `UserCfg.opt` | not yet verified (needed in M03) |

## Results

| Check | Result | Notes |
|---|---|---|
| Connect locally, detect sim | ✅ | `SimConnect connected: SunRise 12.2 via local (autodetect)` |
| `K:STROBES_TOGGLE` | ✅ | strobe on/off (value is ignored) |
| `K:TOGGLE_NAV_LIGHTS` | ✅ | nav lights on/off |
| `K:PAUSE_TOGGLE` | ❌ no effect | sent without SimConnect exception, sim does not pause |
| `K:PAUSE_SET` 1/0 | ❌ no effect | same; community reports confirm pause events from external SimConnect clients don't work in 2024 — reportedly `1 (>K:PAUSE_SET)` works as RPN inside the sim → test via WASM bridge in M03 |
| Empty event name in PI | ⚠️ UX | placeholder looked like a value → user pressed with empty setting; placeholders changed to `e.g. …` |
| Remote connect Mac → sim PC (port 502) | ✅ | handshake OK (`SunRise 12.2`). MSFS listens on `0.0.0.0:502`; pitfall during setup: we tested port 503 while the XML entry is on 502 — `netstat -an \| findstr ":50"` on the sim PC shows what MSFS really listens on |
| A: read once (`PLANE ALTITUDE, feet`, `LIGHT BEACON, Bool`) | ✅ | remote, ~60 ms round trip |
| A: subscribe `LIGHT STROBE` (SIM_FRAME + CHANGED) | ✅ | 21 updates for 20 flips, one per change, latency not noticeable |
| L: read with `L:` prefix | ⚠️ inconclusive | Cabri has no H145 vars → `0`, **no exception**: unknown L:-vars read as 0 (cannot detect typos). Re-test with H145 for a real value |
| Unknown K:-event name | ✅ rejected | `NAME_UNRECOGNIZED (7)` on `MapClientEventToSimEvent` → plugin's alert-on-typo works |
| B: enumerate input events | ✅ | Cabri: 106 entries, **with duplicates** (same names/hashes repeated) → dedupe by hash |
| B: get / set / read back `FUEL_PUMP` | ✅ | 1 → set 0 → read 0 → set 1 → read 1; AAO's `IE:` names = SimConnect input event names |
| MSFS quit while connected (step 7b) | open | not run yet |
| Offline tile on MSFS quit + auto-recovery | ✅ | tile appears after quit; after MSFS restart the button works again without restarting Stream Deck. A user-set title overlaps the tile (Stream Deck rule) → tile redesigned as bottom band |

## Conclusions so far

- The core chain Stream Deck → plugin → SimConnect → MSFS 2024 works with plain node-simconnect, no external app.
- End users need **no** `SimConnect.xml` change; remote config is a dev-only concern.
- Pause can't be driven from an external SimConnect client in 2024 → candidate for the WASM bridge (RPN).
- Unknown K:-names are rejected (`NAME_UNRECOGNIZED`), unknown L:-vars are not (read as 0).
- B:-input events work over plain SimConnect (enumerate, get, set) → in scope for M02; no WASM needed for them.
