# M06 — Release pipeline

## Goal

Tag → GitHub release with everything the sim PC needs; installing an update = double-click, nothing else.

## Scope

- Port `scripts/release.mjs` + `.github/workflows/release.yml` from xp_streamdeck (version bump in `package.json` + `manifest.json`, tag, push).
- CI builds the WASM bridge (per M03's decision on SDK access) and bundles it **inside** the `.streamDeckPlugin`, so the plugin's self-install (M03) always ships a matching bridge version.
- Release assets: `com.robertw.fs24.streamDeckPlugin` (+ profiles zip).
- `INSTALL.md`: sim-PC steps for an end user (plugin double-click, confirm bridge install, done) and dev steps (SimConnect remote config).
- `make release VERSION=x.y.z`.

## Acceptance criteria

- [ ] Tag produces a release with working artefacts, without any manual step.
- [ ] Fresh install on the sim PC from the release only: plugin + bridge work with the H145.
- [ ] Update from a previous release replaces the bridge in `Community/`.
