/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

/*
 * Build the Lama SA315B (Taog's Hangar) profile from the button list below —
 * the aircraft is encrypted and has no AAO profile to convert. Vars come from
 * docs/research/lama-inventory.md. One page, Stream Deck XL (8 × 4).
 *
 * One-shot starting point: the committed profile was reworked by hand in the
 * Stream Deck app afterwards (icons, order) — rerunning overwrites that rework.
 *
 *   npx tsx scripts/build-lama-profile.ts [out.streamDeckProfile]
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { zipSync } from "fflate";
import { parsePressAction, parseVarPath } from "../src/sim/path";
import { parseRules } from "../src/util/state-rules";

const PLUGIN_UUID = "com.robertw.fs24";
const PROFILE_NAME = "Lama SA315B (fs24)";
const DEFAULT_OUT = "profiles/Lama.streamDeckProfile";
const XL_MODEL = "20GAT9901";

type Json = Record<string, unknown>;

/** Windows modifier bits of the Stream Deck hotkey action. */
const MOD = { shift: 1, ctrl: 2, alt: 4, win: 8 } as const;
type Hotkey = { key?: string; mods?: (keyof typeof MOD)[] };

type Button =
	| { kind: "toggle"; label: string; state: string; write?: string; event?: string }
	| {
			kind: "display";
			label: string;
			var: string;
			precision?: number;
			press?: string;
			repeat?: boolean;
	  }
	| { kind: "state"; title: string; text: string; rules: string }
	| { kind: "hotkey"; title: string; hotkey: Hotkey };

const SL = (axis: "X" | "Y", step: number): string =>
	`RPN:(B:TAOG_LIGHT_SEARCH_${axis}) ${step} + (>B:TAOG_LIGHT_SEARCH_${axis})`;

// Rows top → bottom, 8 buttons each; `null` leaves the key empty.
const LAYOUT: (Button | null)[][] = [
	[
		{
			kind: "toggle",
			label: "BATT",
			state: "A:ELECTRICAL MASTER BATTERY, Bool",
			write: "B:ELECTRICAL_BATTERY_1",
		},
		{
			kind: "toggle",
			label: "GEN",
			state: "A:GENERAL ENG MASTER ALTERNATOR:1, Bool",
			write: "B:ELECTRICAL_ALTERNATOR_1",
		},
		{
			kind: "toggle",
			label: "FUEL VALVE",
			state: "A:FUELSYSTEM VALVE SWITCH:1, Bool",
			write: "B:FUEL_VALVE_1",
		},
		{ kind: "toggle", label: "COVER", state: "B:DEICE_PANEL_ALTERNATE_COVER" },
		{
			kind: "toggle",
			label: "STARTER",
			state: "A:GENERAL ENG STARTER:1, Bool",
			event: "K:TOGGLE_STARTER1",
		},
		{
			kind: "toggle",
			label: "ROTOR BRAKE",
			state: "A:ROTOR BRAKE ACTIVE, Bool",
			event: "K:ROTOR_BRAKE",
		},
		{
			kind: "toggle",
			label: "GOV",
			state: "A:ROTOR GOV SWITCH POS, Bool",
			event: "K:ROTOR_GOV_SWITCH_TOGGLE",
		},
		{ kind: "toggle", label: "PITOT", state: "A:PITOT HEAT, Bool", write: "B:DEICE_PITOT_1" },
	],
	[
		{
			kind: "toggle",
			label: "LANDING",
			state: "A:LIGHT LANDING, Bool",
			write: "B:LIGHTING_LANDING_1",
		},
		{
			kind: "toggle",
			label: "STROBE",
			state: "A:LIGHT STROBE, Bool",
			event: "K:STROBES_TOGGLE",
		},
		{
			kind: "display",
			label: "SL UP",
			var: "B:TAOG_LIGHT_SEARCH_Y",
			precision: 1,
			press: SL("Y", 2.5),
			repeat: true,
		},
		{
			kind: "display",
			label: "SL DOWN",
			var: "B:TAOG_LIGHT_SEARCH_Y",
			precision: 1,
			press: SL("Y", -2.5),
			repeat: true,
		},
		{
			kind: "display",
			label: "SL LEFT",
			var: "B:TAOG_LIGHT_SEARCH_X",
			precision: 1,
			press: SL("X", -2.5),
			repeat: true,
		},
		{
			kind: "display",
			label: "SL RIGHT",
			var: "B:TAOG_LIGHT_SEARCH_X",
			precision: 1,
			press: SL("X", 2.5),
			repeat: true,
		},
		{
			kind: "state",
			title: "ENGINE",
			text: "OFF",
			rules: [
				"(A:GENERAL ENG STARTER ACTIVE:1, Bool) | amber | START",
				"(A:GENERAL ENG COMBUSTION:1, Bool) | green | RUN",
			].join("\n"),
		},
		{ kind: "display", label: "AGL FT", var: "A:PLANE ALT ABOVE GROUND, Feet" },
	],
	[
		{ kind: "display", label: "ROTOR %", var: "A:ROTOR RPM PCT:1, Percent" },
		{ kind: "display", label: "N1 %", var: "A:TURB ENG N1:1, Percent" },
		{ kind: "display", label: "ITT °C", var: "A:TURB ENG ITT:1, Celsius" },
		{ kind: "display", label: "TQ %", var: "A:ENG TORQUE PERCENT:1, Percent" },
		{ kind: "display", label: "OIL PSI", var: "A:ENG OIL PRESSURE:1, PSI" },
		{ kind: "display", label: "FUEL GAL", var: "A:FUEL TOTAL QUANTITY, Gallons" },
		{
			kind: "display",
			label: "VOLT",
			var: "A:ELECTRICAL MAIN BUS VOLTAGE, Volts",
			precision: 1,
		},
		{ kind: "display", label: "IAS KT", var: "A:AIRSPEED INDICATED, Knots" },
	],
	[
		// MSFS default "Load custom camera n" = Alt+n; the last three need the user's own binding.
		{ kind: "hotkey", title: "CAM\n1", hotkey: { key: "1", mods: ["alt"] } },
		{ kind: "hotkey", title: "CAM\n2", hotkey: { key: "2", mods: ["alt"] } },
		{ kind: "hotkey", title: "CAM\n3", hotkey: { key: "3", mods: ["alt"] } },
		{ kind: "hotkey", title: "CAM\n4", hotkey: { key: "4", mods: ["alt"] } },
		{ kind: "hotkey", title: "CAM\n5", hotkey: { key: "5", mods: ["alt"] } },
		{ kind: "hotkey", title: "INSTR\nPREV", hotkey: {} },
		{ kind: "hotkey", title: "INSTR\nNEXT", hotkey: {} },
		{ kind: "hotkey", title: "COCKPIT", hotkey: {} },
	],
];

const errors: string[] = [];

function guid(seed: string): string {
	const h = createHash("sha1").update(`fs24:${seed}`).digest("hex").toUpperCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function checkVar(raw: string, where: string): void {
	const r = parseVarPath(raw);
	if (!r.ok) errors.push(`${where}: var "${raw}": ${r.error}`);
}

function checkPress(raw: string, where: string): void {
	const r = parsePressAction(raw);
	if (!r.ok) errors.push(`${where}: action "${raw}": ${r.error}`);
}

const EMPTY_KEY = {
	KeyCmd: false,
	KeyCtrl: false,
	KeyModifiers: 0,
	KeyOption: false,
	KeyShift: false,
	NativeCode: 146,
	QTKeyCode: 33554431,
	VKeyCode: -1,
};

function hotkeySettings(h: Hotkey): Json {
	const keys: Json[] = [];
	if (h.key) {
		const mods = h.mods ?? [];
		const code = h.key.toUpperCase().charCodeAt(0);
		keys.push({
			KeyCmd: mods.includes("win"),
			KeyCtrl: mods.includes("ctrl"),
			KeyModifiers: mods.reduce((n, m) => n | MOD[m], 0),
			KeyOption: mods.includes("alt"),
			KeyShift: mods.includes("shift"),
			NativeCode: code,
			QTKeyCode: code,
			VKeyCode: code,
		});
	}
	while (keys.length < 4) keys.push({ ...EMPTY_KEY });
	return { Coalesce: true, Hotkeys: keys };
}

function mapButton(b: Button, where: string): { uuid: string; settings: Json; title: string } {
	switch (b.kind) {
		case "toggle": {
			checkVar(b.state, where);
			const settings: Json = {
				varPath: b.state,
				valueOn: "1",
				valueOff: "0",
				staticLabel: b.label,
			};
			if (b.event) {
				checkPress(b.event, where);
				Object.assign(settings, { triggerMode: "event", event: b.event });
			} else {
				if (b.write) checkVar(b.write, where);
				Object.assign(settings, {
					triggerMode: "write",
					...(b.write ? { writePath: b.write } : {}),
				});
			}
			return { uuid: `${PLUGIN_UUID}.var-toggle`, settings, title: "" };
		}
		case "display": {
			checkVar(b.var, where);
			const settings: Json = {
				varPath: b.var,
				label: b.label,
				precision: String(b.precision ?? 0),
			};
			if (b.press) {
				checkPress(b.press, where);
				settings.pressAction = b.press;
				if (b.repeat) settings.autoRepeat = true;
			}
			return { uuid: `${PLUGIN_UUID}.var-display`, settings, title: "" };
		}
		case "state": {
			const r = parseRules(b.rules);
			if (!r.ok) errors.push(`${where}: rules: ${r.error}`);
			return {
				uuid: `${PLUGIN_UUID}.var-state`,
				settings: { title: b.title, text: b.text, states: b.rules },
				title: "",
			};
		}
		case "hotkey":
			return {
				uuid: "com.elgato.streamdeck.system.hotkey",
				settings: hotkeySettings(b.hotkey),
				title: b.title,
			};
	}
}

interface PluginManifest {
	Version: string;
	Name: string;
	Actions: { UUID: string; Name: string; States: Json[] }[];
}

function buildAction(b: Button, col: number, row: number, plugin: PluginManifest): Json {
	const where = `${col},${row}`;
	const m = mapButton(b, where);
	const state = (title: string): Json => ({
		FontSize: 9,
		ShowTitle: true,
		Title: title,
		TitleAlignment: "middle",
		TitleColor: "#ffffff",
		OutlineThickness: 2,
	});
	if (m.uuid === "com.elgato.streamdeck.system.hotkey") {
		return {
			ActionID: guid(`lama-action-${where}`).toLowerCase(),
			LinkedTitle: false,
			Name: "Hotkey",
			Plugin: { Name: "Activate a Key Command", UUID: m.uuid, Version: "1.0" },
			Resources: null,
			Settings: m.settings,
			State: 0,
			States: [state(m.title)],
			UUID: m.uuid,
		};
	}
	const def = plugin.Actions.find((a) => a.UUID === m.uuid);
	if (!def) throw new Error(`action ${m.uuid} not in plugin manifest`);
	return {
		ActionID: guid(`lama-action-${where}`).toLowerCase(),
		LinkedTitle: false,
		Name: def.Name,
		Plugin: { Name: plugin.Name, UUID: PLUGIN_UUID, Version: plugin.Version },
		Resources: null,
		Settings: m.settings,
		State: 0,
		States: def.States.map(() => state(m.title)),
		UUID: m.uuid,
	};
}

function main(): void {
	const outPath = process.argv[2] ?? DEFAULT_OUT;
	const plugin = JSON.parse(
		readFileSync("com.robertw.fs24.sdPlugin/manifest.json", "utf8"),
	) as PluginManifest;

	const actions: Record<string, Json> = {};
	LAYOUT.forEach((row, r) => {
		if (row.length > 8) errors.push(`row ${r}: ${row.length} buttons, XL has 8`);
		row.forEach((b, c) => {
			if (b) actions[`${c},${r}`] = buildAction(b, c, r, plugin);
		});
	});
	if (errors.length) {
		console.error(
			`✗ ${errors.length} errors — ${outPath} not written\n${errors.map((e) => `  ${e}`).join("\n")}`,
		);
		process.exit(1);
	}

	const root = guid(PROFILE_NAME);
	const page = guid(`${PROFILE_NAME}:page0`);
	// Stream Deck keeps "Default" as a separate empty page; the button page must be listed in Pages.
	const defaultPage = guid(`${PROFILE_NAME}:default`);
	const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
	const files: Record<string, Uint8Array> = {
		"package.json": enc({
			AppVersion: "7.6.1.23033",
			DeviceModel: XL_MODEL,
			DeviceSettings: null,
			FormatVersion: 1,
			OSType: "Windows",
			OSVersion: "10.0.26300",
			RequiredPlugins: [PLUGIN_UUID],
		}),
		[`Profiles/${root}.sdProfile/manifest.json`]: enc({
			Device: { Model: XL_MODEL, UUID: "" },
			Name: PROFILE_NAME,
			Pages: {
				Current: page.toLowerCase(),
				Default: defaultPage.toLowerCase(),
				Pages: [page.toLowerCase()],
			},
			Version: "3.0",
		}),
		[`Profiles/${root}.sdProfile/Profiles/${defaultPage}/manifest.json`]: enc({
			Controllers: [{ Actions: null, Type: "Keypad" }],
			Icon: "",
			Name: "",
		}),
		[`Profiles/${root}.sdProfile/Profiles/${page}/manifest.json`]: enc({
			Controllers: [{ Actions: actions, Type: "Keypad" }],
			Icon: "",
			Name: "",
		}),
	};
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, zipSync(files));
	console.log(`${Object.keys(actions).length} buttons → ${outPath}`);
}

main();
