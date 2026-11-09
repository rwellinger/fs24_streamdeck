# SimConnect spike (M01)

Findings from bringing up the walking skeleton against MSFS 2024 (MS Store). Partly from the plugin running **locally on the sim PC**, partly still open (remote smoke script).

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
| Remote connect Mac → sim PC (port 502) | ✅ | handshake OK (`SunRise 12.2`). MSFS listens on `0.0.0.0:502`; pitfall during setup: Mac had a second interface (Wi-Fi) and the firewall rule was created for the wrong port — `netstat -an \| findstr ":50"` on the sim PC shows what MSFS really listens on |
| Smoke script steps 2–7 (A: read, subscribe, L:, unknown K:, B: input events, quit behaviour) | open | needs remote connect |
| Offline tile on MSFS quit + auto-recovery | ✅ | tile appears after quit; after MSFS restart the button works again without restarting Stream Deck. A user-set title overlaps the tile (Stream Deck rule) → tile redesigned as bottom band |

## Conclusions so far

- The core chain Stream Deck → plugin → SimConnect → MSFS 2024 works with plain node-simconnect, no external app.
- End users need **no** `SimConnect.xml` change; remote config is a dev-only concern.
- Pause can't be driven from an external SimConnect client in 2024 → candidate for the WASM bridge (RPN).
- Open: does MSFS raise an exception for unknown K:-event names? The plugin's alert-on-typo relies on it (smoke step 5b).
