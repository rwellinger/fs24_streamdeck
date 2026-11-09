# SimConnect spike (M01)

Results of `scripts/smoke-simconnect.ts` against MSFS 2024 (MS Store) over remote SimConnect.
**Status: not yet run against the live sim** — fill in after the run.

## Setup

| | |
|---|---|
| Date | _TBD_ |
| MSFS version (from step 1) | _TBD_ |
| SimConnect version (from step 1) | _TBD_ |
| node-simconnect | 4.2.1 |
| Protocol requested | KittyHawk (also try `FS24_PROTOCOL=sunrise`) |
| Aircraft loaded | _TBD_ |
| Client | Mac, Node 24, TCP → sim PC port 500 |

## Paths (MS Store edition)

| File | Expected | Verified |
|---|---|---|
| `SimConnect.xml` | `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml` | _TBD_ |
| `UserCfg.opt` | `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt` | _TBD_ |
| Default local pipe name | `\\.\pipe\Microsoft Flight Simulator\SimConnect` (node-simconnect autodetect) | _TBD_ (from the `<Address>` of the pipe entry in `SimConnect.xml`) |

## Results

| Step | Result | Notes / exact errors |
|---|---|---|
| 1 connect, app name/version | _TBD_ | |
| 2 read `A:PLANE ALTITUDE, feet` / `A:LIGHT BEACON, Bool` | _TBD_ | |
| 3 subscribe `LIGHT BEACON` (SIM_FRAME + CHANGED) | _TBD_ | |
| 4 read L:-var via `L:` prefix | _TBD_ | |
| 5 `K:PAUSE_TOGGLE` ×2 | _TBD_ | |
| 5b unknown K:-event rejected? | _TBD_ | plugin relies on an exception here to show the alert |
| 6 B: input events (enumerate / get / set) | _TBD_ | decides M05 scope without WASM |
| 7 clean disconnect | _TBD_ | |
| 7b MSFS closed mid-run (`FS24_QUIT_WATCH_S`) | _TBD_ | quit / close / error / silent hang? |

## Conclusions

_TBD_
