# fs24_streamdeck

Stream Deck plugin for **Microsoft Flight Simulator 2024**. Talks to the sim directly via SimConnect — no extra app, no background service.

> Status: early development (milestone M01). The only action so far is **Command** (fire any K:-event, e.g. `PAUSE_TOGGLE`).

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
| **K:-Event** | Event name, e.g. `PAUSE_TOGGLE`, `TOGGLE_BEACON_LIGHTS`. The `K:` prefix is optional. Event names: MSFS SDK docs ("Event IDs") or [HubHop](https://hubhop.mobiflight.com). |
| **Value** | Optional integer parameter of the event (default `0`). |
| **Feedback** | Hide the green check mark after a successful press. |

Key feedback:

- green check — event sent
- yellow triangle — no event name, invalid value, unknown event name, or the sim is not connected (details in the plugin log)
- **SIM OFFLINE** tile — no SimConnect connection for more than 3 s. The plugin retries automatically; as soon as MSFS is running again the tile disappears, no Stream Deck restart needed.

### Connection settings

Under **SimConnect connection** (in every Command key's property inspector — the setting is shared by all keys):

| Field | Meaning |
|---|---|
| **Sim host** | Leave **empty** when Stream Deck runs on the same PC as MSFS (normal case). Enter an IP address only if MSFS runs on a different computer. |
| **Port** | Only used with a host. Default `500`. |

If the plugin can't connect while host is empty although MSFS is running, set **Sim host** to `127.0.0.1` and **Port** to `500` and add the IPv4 entry described below (bind address `127.0.0.1`).

## Remote SimConnect (Stream Deck on another computer)

Needed only if Stream Deck runs on a different machine than MSFS (e.g. the developer setup: Mac + sim PC).

1. Close MSFS.
2. Open `SimConnect.xml` of the Microsoft Store edition:
   `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\SimConnect.xml`
   (paste the path into the Explorer address bar). Make a backup copy first.
3. Inside `<SimBase.Document>`, keep the existing pipe entry and add:

   ```xml
   <SimConnect.Comm>
       <Descr>Static IP4 port</Descr>
       <Protocol>IPv4</Protocol>
       <Scope>global</Scope>
       <Address>192.168.1.50</Address>   <!-- LAN IP of the sim PC -->
       <Port>500</Port>
       <MaxClients>64</MaxClients>
       <MaxRecvSize>41088</MaxRecvSize>
   </SimConnect.Comm>
   ```

   Find the LAN IP with `ipconfig` (IPv4 address of the active adapter). Give the PC a fixed IP / DHCP reservation in your router so it doesn't change.
4. Allow the port in the Windows firewall — open **PowerShell as administrator** and run:

   ```powershell
   New-NetFirewallRule -DisplayName "MSFS SimConnect 500" -Direction Inbound -Protocol TCP -LocalPort 500 -Action Allow -Profile Private
   ```

   Your network must be set to *Private* (Settings → Network & Internet → properties of the connection).
5. Start MSFS, then set **Sim host** / **Port** in the plugin to the sim PC's IP and `500`.

To undo: restore the backup of `SimConnect.xml` and run `Remove-NetFirewallRule -DisplayName "MSFS SimConnect 500"`.

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
FS24_HOST=<sim-pc-ip> FS24_PORT=500 npx tsx scripts/smoke-simconnect.ts
```

Options are documented at the top of `scripts/smoke-simconnect.ts`. Every push to `main` and every PR is built by GitHub Actions (`.github/workflows/build.yml`); the packaged plugin is attached to the run as an artifact.

## License

MIT — see [LICENSE](LICENSE).
