/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Live check of the var-state pipeline (rules → subscriptions → evaluation)
// against a running sim, without Stream Deck. Prints the matching rule and
// text on every change; optionally fires press actions in between.
//
//   FS24_HOST=10.0.1.215 FS24_PORT=502 \
//   FS24_RULES=$'(L:MFD1_Mode) 1 == | green | NAVD\n* | off | NAVD' \
//   FS24_PRESS='RPN:1 (>L:MFD1_Mode);RPN:0 (>L:MFD1_Mode)' \
//   npx tsx scripts/smoke-state.ts
//
// FS24_PRESS: `;`-separated press actions, fired 1.5 s apart after the first
// evaluation. FS24_WATCH_S: how long to watch (default 8).

import { SimClient } from "../src/sim";
import type { VarPath } from "../src/sim/path";
import { parsePressAction } from "../src/sim/path";
import { parseRules, renderTemplate, selectRule, templateVars } from "../src/util/state-rules";

const HOST = process.env.FS24_HOST ?? "";
const PORT = Number(process.env.FS24_PORT ?? 500);
const WATCH_S = Number(process.env.FS24_WATCH_S ?? 8);

const rules = parseRules(process.env.FS24_RULES ?? "");
if (!rules.ok) {
	console.error(`rules: ${rules.error}`);
	process.exit(2);
}
const presses = (process.env.FS24_PRESS ?? "")
	.split(";")
	.map((s) => s.trim())
	.filter(Boolean)
	.map((s) => {
		const p = parsePressAction(s);
		if (!p.ok) {
			console.error(`press "${s}": ${p.error}`);
			process.exit(2);
		}
		return p.path;
	});

const quiet = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} };
const sim = new SimClient(quiet);
sim.setTarget(HOST ? { host: HOST, port: PORT } : null);

const vars = new Map<string, VarPath>();
for (const r of rules.path) {
	for (const v of [...(r.condition?.vars ?? []), ...templateVars(r.text)]) vars.set(v.key, v);
}
const values = new Map<string, number | null>();
const t0 = Date.now();
let last = "";

const evaluate = () => {
	const lookup = (k: string) => values.get(k);
	const rule = selectRule(rules.path, lookup);
	if (rule === undefined) return;
	const text = rule?.text ? renderTemplate(rule.text, lookup) : "";
	const line = rule ? `line ${rule.line} ${rule.style} "${text ?? "…"}"` : "no match";
	if (line === last) return;
	last = line;
	console.log(`[${((Date.now() - t0) / 1000).toFixed(2)} s] ${line}`);
};

// "online" is only emitted after an "offline", so poll for the first connect.
const firePresses = async () => {
	while (!sim.isConnected()) await new Promise((r) => setTimeout(r, 100));
	console.log(`connected, ${vars.size} var(s)`);
	for (const p of presses) {
		await new Promise((r) => setTimeout(r, 1500));
		try {
			await sim.fire(p);
			console.log(`[${((Date.now() - t0) / 1000).toFixed(2)} s] fired ${JSON.stringify(p)}`);
		} catch (err) {
			console.log(`fire failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
};
for (const path of vars.values()) {
	sim.subscribe(path, (v) => {
		values.set(path.key, v);
		evaluate();
	});
}
sim.connect();
firePresses().catch((err) => console.error(err));
setTimeout(() => process.exit(0), WATCH_S * 1000);
