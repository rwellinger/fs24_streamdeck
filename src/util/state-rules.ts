/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import type { ParseResult, VarPath } from "../sim/path";
import { formatSimValue } from "./format";
import { compileRpn, evalRpn, type RpnProgram, type VarLookup } from "./rpn";

/*
 * Rule list of the var-state action, one rule per line:
 *
 *   <condition> | <style> | <text>
 *
 * - condition: RPN expression, true when non-zero; `*` or empty = always.
 * - style: off | white | green | amber | red | blue | cyan.
 * - text: optional; empty falls back to the action's default text. `\n` breaks
 *   the line, `{<rpn>}` or `{<rpn>|<printf>}` inserts a live value
 *   (default format `%.0f`).
 *
 * First matching rule wins. `#` starts a comment line. The condition is split
 * off at the first two `|`, so use `or` instead of `||` there.
 */

export const STATE_STYLES = ["off", "white", "green", "amber", "red", "blue", "cyan"] as const;
export type StateStyle = (typeof STATE_STYLES)[number];

type Segment = { kind: "text"; text: string } | { kind: "value"; expr: RpnProgram; format: string };

export interface Template {
	segments: Segment[];
}

export interface StateRule {
	line: number;
	/** `undefined` = always matches. */
	condition?: RpnProgram;
	style: StateStyle;
	/** `undefined` = use the default text. */
	text?: Template;
}

const DEFAULT_VALUE_FORMAT = "%.0f";

export function parseTemplate(raw: string): ParseResult<Template> {
	const segments: Segment[] = [];
	let literal = "";
	let i = 0;
	while (i < raw.length) {
		const ch = raw[i];
		if (ch === "\\" && raw[i + 1] === "n") {
			literal += "\n";
			i += 2;
			continue;
		}
		if (ch !== "{") {
			literal += ch;
			i++;
			continue;
		}
		const end = matchingBrace(raw, i);
		if (end < 0) return { ok: false, error: `unclosed "{" in "${raw}"` };
		const inner = raw.slice(i + 1, end);
		const bar = inner.lastIndexOf("|");
		const hasFormat = bar >= 0 && inner.slice(bar + 1).includes("%");
		const expr = compileRpn(hasFormat ? inner.slice(0, bar) : inner);
		if (!expr.ok) return { ok: false, error: `{${inner}}: ${expr.error}` };
		if (literal) segments.push({ kind: "text", text: literal });
		literal = "";
		segments.push({
			kind: "value",
			expr: expr.path,
			format: hasFormat ? inner.slice(bar + 1).trim() : DEFAULT_VALUE_FORMAT,
		});
		i = end + 1;
	}
	if (literal) segments.push({ kind: "text", text: literal });
	return { ok: true, path: { segments } };
}

function matchingBrace(s: string, open: number): number {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		if (s[i] === "{") depth++;
		else if (s[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

export function parseRules(raw: string): ParseResult<StateRule[]> {
	const rules: StateRule[] = [];
	const lines = raw.split(/\r?\n/);
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n].trim();
		if (!line || line.startsWith("#")) continue;
		const first = line.indexOf("|");
		const second = first < 0 ? -1 : line.indexOf("|", first + 1);
		if (first < 0)
			return { ok: false, error: `line ${n + 1}: expected "condition | style | text"` };
		const condText = line.slice(0, first).trim();
		const styleText = (second < 0 ? line.slice(first + 1) : line.slice(first + 1, second))
			.trim()
			.toLowerCase();
		const bodyText = second < 0 ? "" : line.slice(second + 1).trim();

		const style = (STATE_STYLES as readonly string[]).includes(styleText)
			? (styleText as StateStyle)
			: undefined;
		if (!style) {
			return {
				ok: false,
				error: `line ${n + 1}: unknown style "${styleText}" (${STATE_STYLES.join(", ")})`,
			};
		}
		let condition: RpnProgram | undefined;
		if (condText && condText !== "*") {
			const c = compileRpn(condText);
			if (!c.ok) return { ok: false, error: `line ${n + 1}: ${c.error}` };
			condition = c.path;
		}
		let text: Template | undefined;
		if (bodyText) {
			const t = parseTemplate(bodyText);
			if (!t.ok) return { ok: false, error: `line ${n + 1}: ${t.error}` };
			text = t.path;
		}
		rules.push({ line: n + 1, condition, style, text });
	}
	return { ok: true, path: rules };
}

export function templateVars(t: Template | undefined): VarPath[] {
	if (!t) return [];
	return t.segments.flatMap((s) => (s.kind === "value" ? s.expr.vars : []));
}

/** `undefined` while a referenced value is still missing. */
export function renderTemplate(t: Template, lookup: VarLookup): string | undefined {
	let out = "";
	for (const s of t.segments) {
		if (s.kind === "text") {
			out += s.text;
			continue;
		}
		const v = evalRpn(s.expr, lookup);
		if (v === undefined) return undefined;
		out += formatSimValue(v, { format: s.format });
	}
	return out;
}

/**
 * First rule whose condition holds. `undefined` while a condition before the
 * match can't be evaluated yet (missing value) — the caller keeps the old tile.
 */
export function selectRule(rules: StateRule[], lookup: VarLookup): StateRule | null | undefined {
	for (const r of rules) {
		if (!r.condition) return r;
		const v = evalRpn(r.condition, lookup);
		if (v === undefined) return undefined;
		if (v !== 0) return r;
	}
	return null;
}
