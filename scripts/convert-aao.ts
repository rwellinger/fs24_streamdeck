/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

/*
 * Convert an Axis and Ohs (AAO) `.streamDeckProfile` into a profile for this
 * plugin. One-shot tool: the result is reworked by hand in the Stream Deck app
 * afterwards and committed — rerunning overwrites that rework.
 *
 * - `(>K:<group>-<label>)` is an AAO script call; it is resolved against the
 *   script XML (nested calls inlined, `(WAIT:n)` removed and reported).
 * - AAO images are third-party art: never copied. Tiles are rendered by the
 *   plugin; native Stream Deck actions keep their title only.
 *
 *   npx tsx scripts/convert-aao.ts <profile.streamDeckProfile> <scripts.xml> [out.streamDeckProfile]
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { parsePressAction, parseVarPath } from "../src/sim/path";
import { compileRpn } from "../src/util/rpn";
import { parseRules, parseTemplate } from "../src/util/state-rules";

const PLUGIN_UUID = "com.robertw.fs24";
const SCRIPT_GROUP = "HYPE_H145";
const PROFILE_NAME = "H145 (fs24)";
const DEFAULT_OUT = "profiles/H145.streamDeckProfile";

type Json = Record<string, unknown>;
type Mapped = { uuid: string; settings: Json; title?: string };

const report = {
	counts: new Map<string, number>(),
	notes: [] as string[],
	dropped: [] as string[],
	errors: [] as string[],
};

let where = "";
const note = (msg: string) => report.notes.push(`[${where}] ${msg}`);
const fail = (msg: string) => report.errors.push(`[${where}] ${msg}`);

const str = (v: unknown): string =>
	typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- scripts

function loadScripts(xml: string): Map<string, string> {
	const decode = (s: string) =>
		s
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, "&");
	const scripts = new Map<string, string>();
	for (const m of xml.matchAll(/<Script>([\s\S]*?)<\/Script>/g)) {
		const field = (k: string) =>
			decode(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`).exec(m[1])?.[1] ?? "");
		scripts.set(`${field("group").trim()}-${field("label").trim()}`, squash(field("script")));
	}
	return scripts;
}

let scripts = new Map<string, string>();

function inlineScript(label: string, depth = 0): string {
	const body = scripts.get(`${SCRIPT_GROUP}-${label.trim()}`);
	if (body === undefined) {
		fail(`unknown AAO script "${label}"`);
		return "";
	}
	if (depth > 5) {
		fail(`script recursion too deep at "${label}"`);
		return body;
	}
	let out = body.replace(
		new RegExp(`(?:-?\\d+(?:\\.\\d+)?\\s+)?\\(>K:${SCRIPT_GROUP}-([^)]+)\\)`, "g"),
		(_, inner: string) => {
			note(`inlined nested script "${inner.trim()}"`);
			return inlineScript(inner, depth + 1);
		},
	);
	out = out.replace(/\(WAIT:(\d+)\)/g, (_, ms: string) => {
		note(`removed (WAIT:${ms}) from script "${label}" — the bridge runs the code in one go`);
		return "";
	});
	// "(>H:NAME )" → "(>H:NAME)"
	return squash(out.replace(/\(\s*([^()]*?)\s*\)/g, "($1)"));
}

// ---------------------------------------------------------------- press / read

/** AAO event field → press action string of this plugin (`K:…`, `H:…`, `RPN:…`). */
function pressAction(raw: unknown, value: unknown = "1"): string | undefined {
	const s = squash(str(raw));
	if (!s || s === "0") return undefined;
	let out: string;
	const script = new RegExp(`^\\(>K:${SCRIPT_GROUP}-(.+)\\)$`).exec(s);
	const h = /^\(>H:([^,)]+?)\s*(?:,[^)]*)?\)$/.exec(s);
	const k = /^\(>K:([^,)]+?)\s*(?:,[^)]*)?\)$/.exec(s);
	const rpn = /^\(>S:([\s\S]*)\)$/.exec(s);
	if (script) {
		const body = inlineScript(script[1]);
		const single = /^1 \(>H:([\w.:-]+)\)$/.exec(body);
		out = single ? `H:${single[1]}` : `RPN:${body}`;
	} else if (h) out = `H:${h[1]}`;
	else if (k) {
		const v = str(value);
		out = v && v !== "0" ? `K:${k[1]} ${v}` : `K:${k[1]}`;
	} else if (rpn) out = `RPN:${squash(rpn[1])}`;
	else {
		fail(`unrecognised event "${s}"`);
		return undefined;
	}
	const parsed = parsePressAction(out);
	if (!parsed.ok) fail(`press action "${out}": ${parsed.error}`);
	return out;
}

/** AAO read expression → RPN text (`(S:<rpn>)` unwrapped, plain var kept as `(X:…)`). */
function readRpn(raw: unknown): string | undefined {
	const s = squash(str(raw));
	if (!s || /^\(L:DummyVar\)$/i.test(s) || /^\(A:\s*,/.test(s)) return undefined;
	const m = /^\(S:([\s\S]*)\)$/.exec(s);
	return m ? squash(m[1]) : s;
}

/** Plain var path (`L:X, Number`) when the read is a single variable, else undefined. */
function plainVar(rpn: string): string | undefined {
	if (!/^\([ALB]:[^()]*\)$/i.test(rpn)) return undefined;
	const inner = rpn.slice(1, -1);
	return parseVarPath(inner).ok ? inner : undefined;
}

function checkRpn(rpn: string, what: string): boolean {
	const r = compileRpn(rpn);
	if (!r.ok) fail(`${what} "${rpn}": ${r.error}`);
	return r.ok;
}

// ---------------------------------------------------------------- labels

const STRIP_PREFIX = /^(H145_SDK_|HYPE_H145-|MISC[ _]|APCP_|AP[ _]|ELEC_|INT LIGHTS_)/i;

/** Label from the raw AAO event: the script label for script calls, else the event name. */
function eventLabel(raw: unknown): string {
	const m = /^\(>[HK]:([^,)]+)/.exec(squash(str(raw)));
	return m ? labelFrom(m[1].trim()) : "";
}

function labelFrom(raw: string | undefined): string {
	if (!raw) return "";
	let s = raw.replace(/^(RPN|H|K):/, "").replace(/\s+\d+$/, "");
	if (s.startsWith("RPN:") || s.includes("(")) return "";
	for (let i = 0; i < 3; i++) s = s.replace(STRIP_PREFIX, "");
	return wrap(
		s
			.replace(/_(TOGGLE|SET)$/i, "")
			.replace(/[_-]+/g, " ")
			.toUpperCase(),
	);
}

function titleOf(action: Json): string {
	const states = Array.isArray(action.States) ? (action.States as Json[]) : [];
	const t = str(states[0]?.Title);
	return t
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.join("\n");
}

/** Break a label into Stream Deck title lines of ≤ 8 chars where possible. */
function wrap(s: string): string {
	const lines: string[] = [];
	for (const w of squash(s).split(" ")) {
		const last = lines.length - 1;
		if (last >= 0 && lines[last].length + w.length + 1 <= 8) lines[last] += ` ${w}`;
		else lines.push(w);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------- mappers

function count(kind: string) {
	report.counts.set(kind, (report.counts.get(kind) ?? 0) + 1);
}

function pressSettings(s: Json): Json {
	const out: Json = {};
	const short = pressAction(s.simevt, s.onevtval);
	const long = pressAction(s.longsimevt, s.onevtval);
	if (short) out.pressAction = short;
	if (long) out.longPressAction = long;
	if (str(s.repeatAction) === "1" && short) out.autoRepeat = true;
	if (s.upsimevt) note(`release event "${str(s.upsimevt)}" dropped`);
	return out;
}

function mapEvent(s: Json, title: string): Mapped {
	const eventName = pressAction(s.simevt, s.onevtval);
	const longEventName = pressAction(s.longsimevt, s.onevtval);
	if (s.upsimevt) note(`release event "${str(s.upsimevt)}" dropped`);
	const settings: Json = { eventName: eventName ?? "" };
	if (longEventName) settings.longEventName = longEventName;
	if (str(s.repeatAction) === "1") settings.autoRepeat = true;
	count("command");
	return { uuid: "command", settings, title: title || eventLabel(s.simevt) };
}

function mapToggle(s: Json, title: string): Mapped {
	const read = readRpn(s.simvar);
	const varPath = read && plainVar(read);
	if (!varPath) fail(`toggle state "${str(s.simvar)}" is not a plain variable`);
	const event = pressAction(s.simevt, s.onevtval);
	const valueOn = str(s.onvarval) || "1";
	count("var-toggle");
	return {
		uuid: "var-toggle",
		settings: {
			varPath: varPath ?? "",
			triggerMode: "event",
			event: event ?? "",
			valueOn,
			valueOff: "0",
			strictOnMatch: valueOn !== "1",
			staticLabel: (
				title || labelFrom(varPath?.replace(/^L:/, "").replace(/,.*$/, ""))
			).replace(/\n/g, " "),
		},
	};
}

function mapOnOff(s: Json, title: string): Mapped {
	const read = readRpn(s.simvar);
	const varPath = read && plainVar(read);
	if (!varPath) fail(`on/off state "${str(s.simvar)}" is not a plain variable`);
	const eventOn = pressAction(s.onsimevt, s.onevtval);
	const eventOff = pressAction(s.offsimevt, s.offevtval);
	count("var-toggle");
	return {
		uuid: "var-toggle",
		settings: {
			varPath: varPath ?? "",
			triggerMode: "event-on-off",
			eventOn: eventOn ?? "",
			eventOff: eventOff ?? "",
			valueOn: str(s.onvarval) || "1",
			valueOff: str(s.offevtval) || "0",
			strictOnMatch: true,
			staticLabel: (title || eventLabel(s.onsimevt)).replace(/\n/g, " "),
		},
	};
}

/** Value expression with AAO multiplier / offset applied, as RPN. */
function scaled(rpn: string, multiplier: unknown, offset: unknown): string {
	let out = rpn;
	const m = Number(str(multiplier) || "1");
	const o = Number(str(offset) || "0");
	if (Number.isFinite(m) && m !== 1) out += ` ${m} *`;
	if (Number.isFinite(o) && o !== 0) out += ` ${o} +`;
	return out;
}

function mapGauge(kind: string, s: Json, title: string): Mapped {
	const read = readRpn(s.simvar);
	const press = pressSettings(s);
	if (str(s.altsimvar)) note(`${kind}: second value "${str(s.altsimvar)}" dropped`);
	if (kind !== "gaugetext") note(`${kind}: needle/slider graphic → number`);
	const label = title.replace(/\n/g, " ");
	if (!read) {
		fail(`${kind} without a value`);
		return { uuid: "var-display", settings: { ...press, varPath: "", label } };
	}
	const varPath = plainVar(read);
	const precision = str(s.fractions) || "0";
	const textGauge = kind === "gaugetext";
	if (varPath) {
		count("var-display");
		const settings: Json = { ...press, varPath, label, precision };
		if (textGauge && str(s.multiplier) && Number(str(s.multiplier)) !== 1)
			settings.unitScale = str(s.multiplier);
		return { uuid: "var-display", settings };
	}
	const expr = textGauge ? scaled(read, s.multiplier, s.varoffset) : read;
	checkRpn(expr, `${kind} value`);
	count("var-state");
	return {
		uuid: "var-state",
		settings: { ...press, title: label, text: `{${expr}|%.${precision}f}`, states: "" },
	};
}

const STATE_WORDS = new Set([
	"start",
	"idle",
	"fail",
	"slow",
	"fast",
	"dim",
	"max",
	"engage",
	"on",
	"off",
	"red",
]);
const NOISE_WORDS = new Set(["on", "off", "back", "label", "button", "mask", "batt", "png", "red"]);

function layerStyle(layer: Json): string {
	const tokens = `${str(layer.header)} ${str(layer.picFile)}`.toLowerCase().split(/[^a-z0-9]+/);
	if (tokens.includes("onground") || tokens.includes("ground")) return "off";
	if (tokens.some((t) => ["fail", "red", "unav", "warn"].includes(t))) return "red";
	if (tokens.some((t) => ["start", "idle", "engage", "dim", "slow"].includes(t))) return "amber";
	if (tokens.some((t) => t.startsWith("mask"))) return "off";
	if (tokens.some((t) => t === "off" || t.endsWith("off"))) return "off";
	if (tokens.some((t) => ["on", "max", "fast", "label"].includes(t))) return "green";
	return "white";
}

function layerWords(layer: Json): string {
	return str(layer.header)
		.split(/\s+/)
		.filter((w) => w && !NOISE_WORDS.has(w.toLowerCase()))
		.join(" ")
		.toUpperCase();
}

function layerCondition(layer: Json): string | undefined {
	const v = squash(str(layer.visivar));
	if (!v) return undefined;
	const s = /^\(S:([\s\S]*)\)$/.exec(v);
	if (s) return squash(s[1]);
	return `${v} ${str(layer.visival) || "0"} ==`;
}

function mapMultigauge(s: Json, title: string): Mapped {
	const layers = (Array.isArray(s.imagedefs) ? s.imagedefs : []) as Json[];
	const texts = (Array.isArray(s.textdefs) ? s.textdefs : []) as Json[];
	const press = pressSettings(s);

	const wind = layers.find((l) => /AMBIENT WIND DIRECTION/.test(str(l.rsimvar)));
	if (wind) {
		count("wind-display");
		note("wind gauge → wind-display (baro / OAT texts dropped)");
		return {
			uuid: "wind-display",
			settings: {
				...press,
				headingUp: /PLANE HEADING/.test(str(wind.rsimvar)),
				label: title.replace(/\n/g, " "),
			},
		};
	}

	const base = layers.find(
		(l) =>
			!str(l.visivar) &&
			!l.xsimvar &&
			!l.ysimvar &&
			!l.rsimvar &&
			!/^mask/i.test(str(l.picFile)),
	);
	const defaultText =
		title || eventLabel(s.simevt) || (base && layerWords(base) ? wrap(layerWords(base)) : "");

	const values: string[] = [];
	for (const t of texts) {
		const raw = str(t.simvar);
		if (!raw || raw.startsWith("TXT:")) continue;
		const rpn = readRpn(raw);
		if (!rpn) continue;
		const expr = scaled(rpn, t.multiplier, t.varoffset);
		if (!checkRpn(expr, `text "${str(t.header)}"`)) continue;
		values.push(`{${expr}|%.${str(t.fractions) || "0"}f}`);
		if (str(t.visivar)) note(`text "${str(t.header)}": visibility condition dropped`);
	}
	const withValues = (text: string) =>
		[text.replace(/\n/g, "\\n"), ...values].filter(Boolean).join("\\n");

	const rules: string[] = [];
	const seen = new Set<string>();
	for (const layer of layers) {
		if (layer.xsimvar || layer.ysimvar || layer.rsimvar) {
			note(`moving layer "${str(layer.header)}" dropped`);
			continue;
		}
		const cond = layerCondition(layer);
		if (!cond) continue;
		if (cond.includes("|")) {
			fail(`layer "${str(layer.header)}": condition contains "|"`);
			continue;
		}
		if (seen.has(cond)) {
			note(`layer "${str(layer.header)}" repeats an earlier condition — dropped`);
			continue;
		}
		seen.add(cond);
		if (!checkRpn(cond, `layer "${str(layer.header)}"`)) continue;
		const style = layerStyle(layer);
		let words = layerWords(layer);
		if (style === "off" && /ground/i.test(str(layer.header))) words = "GND";
		const onlyState = words
			?.split(" ")
			.every((w) => STATE_WORDS.has(w.toLowerCase()) || w === "GND");
		const text = !words
			? defaultText
			: onlyState && defaultText
				? `${defaultText}\n${words}`
				: wrap(words);
		// AAO paints later layers on top; var-state takes the first match.
		rules.unshift(`${cond} | ${style} | ${withValues(text)}`);
	}

	if (rules.length === 0 && values.length === 0) {
		count("command");
		note("multigauge without state → command");
		return {
			uuid: "command",
			settings: {
				eventName: (press.pressAction as string) ?? "",
				...(press.longPressAction ? { longEventName: press.longPressAction } : {}),
				...(press.autoRepeat ? { autoRepeat: true } : {}),
			},
			title: defaultText,
		};
	}

	const states = rules.join("\n");
	const parsed = parseRules(states);
	if (!parsed.ok) fail(`state rules: ${parsed.error}`);
	const text = withValues(defaultText);
	if (!parseTemplate(text).ok) fail(`default text "${text}" does not parse`);
	count("var-state");
	return { uuid: "var-state", settings: { ...press, title: "", text, states } };
}

function mapAao(uuid: string, s: Json, title: string): Mapped | undefined {
	switch (uuid.replace("com.lorby-si.aao.", "")) {
		case "event":
			return mapEvent(s, title);
		case "toggle":
			return mapToggle(s, title);
		case "onoff":
			return mapOnOff(s, title);
		case "gaugetext":
		case "steamgauge":
		case "slidergauge":
			return mapGauge(uuid.replace("com.lorby-si.aao.", ""), s, title);
		case "multigauge":
			return mapMultigauge(s, title);
		default:
			return undefined;
	}
}

// ---------------------------------------------------------------- profile

interface PluginManifest {
	Version: string;
	Name: string;
	Actions: { UUID: string; Name: string; States: Json[] }[];
}

function convertAction(action: Json, plugin: PluginManifest): boolean {
	const uuid = str(action.UUID);
	const title = titleOf(action);
	const states = (Array.isArray(action.States) ? action.States : []) as Json[];

	if (uuid.startsWith("com.elgato.streamdeck.")) {
		for (const st of states) delete st.Image;
		count(`native ${uuid.replace("com.elgato.streamdeck.", "")}`);
		if (uuid.endsWith("profile.rotate"))
			note("profile switch points at a profile outside this one");
		return true;
	}
	const mapped = mapAao(uuid, (action.Settings ?? {}) as Json, title);
	if (!mapped) {
		report.dropped.push(
			`[${where}] ${uuid} "${title}" — no equivalent (AAO virtual joystick button)`,
		);
		return false;
	}

	const fullUuid = `${PLUGIN_UUID}.${mapped.uuid}`;
	const def = plugin.Actions.find((a) => a.UUID === fullUuid);
	if (!def) throw new Error(`action ${fullUuid} not in plugin manifest`);
	const font = states[0]?.FontSize ?? 9;
	action.UUID = fullUuid;
	action.Name = def.Name;
	action.Settings = mapped.settings;
	action.State = 0;
	action.LinkedTitle = false;
	action.States = def.States.map(() => ({
		FontSize: font,
		ShowTitle: true,
		Title: mapped.title ?? "",
		TitleAlignment: "middle",
		TitleColor: "#ffffff",
		OutlineThickness: 2,
	}));
	action.Plugin = { Name: plugin.Name, UUID: PLUGIN_UUID, Version: plugin.Version };
	return true;
}

function profileUuid(): string {
	const h = createHash("sha1").update(`fs24:${PROFILE_NAME}`).digest("hex").toUpperCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function main(): void {
	const [, , profileArg, scriptsArg, outArg] = process.argv;
	if (!profileArg || !scriptsArg) {
		console.error(
			"Usage: npx tsx scripts/convert-aao.ts <profile.streamDeckProfile> <scripts.xml> [out]",
		);
		process.exit(2);
	}
	const outPath = outArg ?? DEFAULT_OUT;
	scripts = loadScripts(readFileSync(scriptsArg, "utf8"));
	const plugin = JSON.parse(
		readFileSync("com.robertw.fs24.sdPlugin/manifest.json", "utf8"),
	) as PluginManifest;

	const zip = unzipSync(new Uint8Array(readFileSync(profileArg)));
	const out: Record<string, Uint8Array> = {};
	const newRoot = `${profileUuid()}.sdProfile`;
	let buttons = 0;

	for (const [path, bytes] of Object.entries(zip)) {
		if (!path.endsWith("/manifest.json")) continue; // images (third-party art) and .bak files stay out
		const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Json;
		const target = path.replace(/^[^/]+\.sdProfile\//, `${newRoot}/`);
		if (Array.isArray(manifest.Controllers)) {
			const page = path.split("/").at(-2) ?? path;
			for (const ctl of manifest.Controllers as Json[]) {
				const actions = (ctl.Actions ?? {}) as Record<string, Json>;
				for (const [coord, action] of Object.entries(actions)) {
					where = `${page.slice(0, 4)} ${coord}`;
					buttons++;
					if (!convertAction(action, plugin)) delete actions[coord];
				}
			}
		} else if (manifest.Device) {
			manifest.Name = PROFILE_NAME;
			(manifest.Device as Json).UUID = "";
		}
		out[target] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
	}

	console.log(`\nAAO → fs24 (${buttons} buttons)\n`);
	for (const [k, n] of [...report.counts].sort()) console.log(`  ${k.padEnd(24)} ${n}`);
	console.log(`  ${"dropped".padEnd(24)} ${report.dropped.length}`);
	const dump = (title: string, lines: string[]) => {
		if (lines.length)
			console.log(`\n${title} (${lines.length}):\n${lines.map((l) => `  ${l}`).join("\n")}`);
	};
	dump("Dropped", report.dropped);
	dump("Simplified", report.notes);
	dump("ERRORS", report.errors);
	if (report.errors.length) {
		console.error(`\n✗ ${report.errors.length} errors — ${outPath} not written\n`);
		process.exit(1);
	}
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, zipSync(out));
	console.log(`\n→ ${outPath}\n`);
}

main();
