# fs24_streamdeck

Stream Deck plugin for **Microsoft Flight Simulator 2024**. Talks to the sim directly via SimConnect — no extra app, no background service.

> Status: early development (milestone M02). Actions: **Command**, **Variable Toggle**, **Variable Display**, **Variable Switch**, **Variable Lamp**.

## Requirements

- Windows 10/11 with MSFS 2024 (Microsoft Store edition tested)
- Elgato Stream Deck app 7.1 or newer

## Installation (Windows)

1. Download the latest build:
   GitHub → **Actions** → workflow **build** → newest green run → section **Artifacts** → `com.robertw.fs24.streamDeckPlugin`.
2. GitHub delivers the artifact as a `.zip`. Extract it; it contains `com.robertw.fs24.streamDeckPlugin`.
3. Double-click `com.robertw.fs24.streamDeckPlugin`. The Stream Deck app asks to install it — confirm.
4. The actions appear in the Stream Deck action list under the category **MSFS 2024**.

To update, repeat the steps — the new version replaces the old one. To uninstall, right-click the plugin in the Stream Deck app → *Uninstall*.

## Usage

### Command

Drag **MSFS 2024 → Command** onto a key and fill in the property inspector:

| Field | Meaning |
|---|---|
| **K:-Event** | Event name, e.g. `TOGGLE_NAV_LIGHTS`, `STROBES_TOGGLE`. The `K:` prefix is optional. Note: the pause events (`PAUSE_TOGGLE`, `PAUSE_SET`) have no effect in MSFS 2024 when sent this way. Event names: MSFS SDK docs ("Event IDs") or [HubHop](https://hubhop.mobiflight.com). |
| **Value** | Optional integer parameter of the event (default `0`). |
| **Feedback** | Hide the green check mark after a successful press. |

Key feedback:

- green check — event sent
- yellow triangle — no event name, invalid value, unknown event name, or the sim is not connected (details in the plugin log)
- **SIM OFFLINE** tile — no SimConnect connection for more than 3 s. The plugin retries automatically; as soon as MSFS is running again the tile disappears, no Stream Deck restart needed.

### Variables and events

Every variable field accepts:

| Syntax | Meaning | Example |
|---|---|---|
| `A:NAME[:index], unit` | SimVar — unit required | `A:LIGHT STROBE, Bool`, `A:ROTOR RPM:1, rpm` |
| `L:name[, unit]` | local var of the aircraft (unit default `Number`) | `L:H145_SDK_OH_PITOT_1` |
| `B:name` | input event (cockpit switch as the aircraft defines it) | `B:FUEL_PUMP` |

Event fields take `K:-event [value]`, e.g. `STROBES_TOGGLE` or `MAGNETO1_SET 3`. Names pasted from AAO, such as `(A:LIGHT STROBE, Bool)`, work as-is.

Under each field the property inspector shows the live value, or why it can't be read. Unknown `A:`/`B:` names show `not found`. Unknown `L:` vars read as `0` — MSFS doesn't report them.

### Variable Toggle

Two-state key. The image follows the **state variable** (ON if the value is closer to *Value ON* than to *Value OFF*). A press either writes ON/OFF to a variable, fires one K:-event (`STROBES_TOGGLE`), or fires separate ON/OFF events (`MAGNETO1_SET 3` / `MAGNETO1_SET 0`). *Hold mode* makes it momentary. Orientation, color and a label are drawn by the plugin.

### Variable Display

Shows a variable as the key title, formatted printf-style: `%d`, `%.1f`, `%d kt`.

### Variable Switch

N-position switch, e.g. off / on / auto. A short press steps toward *Max*, a long press (≥ 0.5 s) toward *Min*. It writes the new value, fires `EVENT <new value>`, or fires separate up/down events. *Labels* such as `0=OFF,1=ON,2=AUTO` set the title.

### Variable Lamp

Indicator light, lit while the variable equals *Value ON*. Read-only.

### Press condition

Toggle and Switch can require a condition before a press acts, e.g. *only if `A:ELECTRICAL MASTER BATTERY, Bool` == 1*. If the condition isn't met, the key shows the alert.

### Connection settings

Under **SimConnect connection** (in every Command key's property inspector — the setting is shared by all keys):

| Field | Meaning |
|---|---|
| **Sim host** | Leave **empty** when Stream Deck runs on the same PC as MSFS (normal case — verified with the MS Store edition, no `SimConnect.xml` change needed). Enter an IP address only if MSFS runs on a different computer. |
| **Port** | Only used with a host. Default `500` (MSFS's built-in local IPv4 port). For a remote sim use the port of your remote entry, e.g. `502` (see below). |

If the plugin can't connect while host is empty although MSFS is running, set **Sim host** to `127.0.0.1` and **Port** to `500` — this uses the local IPv4 entry MSFS 2024 ships in `SimConnect.xml`.

## Remote SimConnect (Stream Deck on another computer)

Needed only if Stream Deck runs on a different machine than MSFS (e.g. the developer setup: Mac + sim PC).

1. Close MSFS.
2. Open `SimConnect.xml` of the Microsoft Store edition:
   `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml`
   (paste the path into the Explorer address bar). Make a backup copy first.
3. MSFS 2024 already ships several `<SimConnect.Comm>` entries — a named pipe, IPv4 on port `500` and IPv6 on port `501`, all with `<Scope>local</Scope>`. **Leave them unchanged** (local tools and the plugin's local mode use them) and add a new entry inside `<SimBase.Document>` on a free port, e.g. `502`:

   ```xml
   <SimConnect.Comm>
       <Descr>Remote IPv4 (Stream Deck)</Descr>
       <Protocol>IPv4</Protocol>
       <Scope>global</Scope>
       <Address>192.168.1.50</Address>   <!-- LAN IP of the sim PC -->
       <Port>502</Port>
       <MaxClients>64</MaxClients>
       <MaxRecvSize>41088</MaxRecvSize>
   </SimConnect.Comm>
   ```

   Find the LAN IP with `ipconfig` (IPv4 address of the active adapter). Give the PC a fixed IP / DHCP reservation in your router so it doesn't change.
4. Allow the port in the Windows firewall — open **PowerShell as administrator** and run:

   ```powershell
   New-NetFirewallRule -DisplayName "MSFS SimConnect 502" -Direction Inbound -Protocol TCP -LocalPort 502 -Action Allow -Profile Private
   ```

   Your network must be set to *Private* (Settings → Network & Internet → properties of the connection).
5. Start MSFS, then set **Sim host** / **Port** in the plugin to the sim PC's IP and `502`.

To undo: restore the backup of `SimConnect.xml` and run `Remove-NetFirewallRule -DisplayName "MSFS SimConnect 502"`.

## Troubleshooting

Plugin log: `%APPDATA%\Elgato\StreamDeck\Plugins\com.robertw.fs24.sdPlugin\logs\` (Windows) or `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.robertw.fs24.sdPlugin/logs/` (macOS). Connection attempts, the detected sim version and every rejected event are logged there.

## Development

See [`CLAUDE.md`](CLAUDE.md) for architecture and conventions. Short version:

```bash
make setup      # npm install
make check      # Biome lint + tsc — required before every commit
make build      # → com.robertw.fs24.sdPlugin/bin/plugin.js
make deploy     # build + restart plugin in the local Stream Deck app
make icons      # regenerate button/action icons
make package    # → com.robertw.fs24.streamDeckPlugin
```

SimConnect smoke test against a remote sim:

```bash
FS24_HOST=<sim-pc-ip> FS24_PORT=502 npx tsx scripts/smoke-simconnect.ts
```

Options are documented at the top of `scripts/smoke-simconnect.ts`. Every push to `main` and every PR is built by GitHub Actions (`.github/workflows/build.yml`); the packaged plugin is attached to the run as an artifact.

## License

MIT — see [LICENSE](LICENSE).
