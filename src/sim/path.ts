/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

/**
 * Readable/writable variable. `key` identifies one SimConnect subscription:
 * the same var with a different unit is a different subscription.
 *
 * - `A:NAME[:index], unit` — SimVar, unit mandatory
 * - `L:name[, unit]`       — local var, unit defaults to `Number`
 * - `B:name`               — input event (no unit)
 *
 * AAO-style wrapping in parentheses (`(A:LIGHT STROBE, Bool)`) is accepted so
 * names can be pasted from existing profiles.
 */
export type VarPath =
	| { kind: "A"; name: string; unit: string; key: string }
	| { kind: "L"; name: string; unit: string; key: string }
	| { kind: "B"; name: string; key: string };

export type ParseResult<T> = { ok: true; path: T } | { ok: false; error: string };

const DEFAULT_L_UNIT = "Number";

function unwrap(raw: string): string {
	let s = raw.trim();
	if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
	if (s.startsWith(">")) s = s.slice(1).trim();
	return s;
}

export function parseVarPath(raw: string): ParseResult<VarPath> {
	const s = unwrap(raw);
	if (!s) return { ok: false, error: "empty" };

	const m = /^([ALB]):(.*)$/i.exec(s);
	if (!m) return { ok: false, error: `missing A:/L:/B: prefix in "${s}"` };
	const kind = m[1].toUpperCase() as "A" | "L" | "B";
	const rest = m[2];

	const comma = rest.lastIndexOf(",");
	const name = (comma >= 0 ? rest.slice(0, comma) : rest).trim();
	const unit = comma >= 0 ? rest.slice(comma + 1).trim() : "";
	if (!name) return { ok: false, error: `missing name in "${s}"` };

	if (kind === "A") {
		if (!unit) return { ok: false, error: `A:-var needs a unit, e.g. "A:${name}, Bool"` };
		const upper = name.toUpperCase().replace(/\s+/g, " ");
		return {
			ok: true,
			path: { kind, name: upper, unit, key: `A:${upper}|${unit.toLowerCase()}` },
		};
	}
	if (kind === "L") {
		const u = unit || DEFAULT_L_UNIT;
		return { ok: true, path: { kind, name, unit: u, key: `L:${name}|${u.toLowerCase()}` } };
	}
	if (unit) return { ok: false, error: `B:-events take no unit ("${s}")` };
	const upper = name.toUpperCase();
	return { ok: true, path: { kind, name: upper, key: `B:${upper}` } };
}

/** K:-event name; prefix optional. */
export function parseEventName(raw: string): ParseResult<string> {
	const s = unwrap(raw).replace(/^K:/i, "").trim().toUpperCase();
	if (!s) return { ok: false, error: "empty" };
	if (!/^[A-Z0-9_]+$/.test(s)) return { ok: false, error: `invalid K:-event name "${s}"` };
	return { ok: true, path: s };
}

export type EventSpec = { name: string; value: number };

/** `K:NAME [value]` — e.g. `MAGNETO1_SET 3`; value defaults to 0. */
export function parseEventSpec(raw: string): ParseResult<EventSpec> {
	const parts = unwrap(raw)
		.split(/[\s,]+/)
		.filter(Boolean);
	if (parts.length === 0) return { ok: false, error: "empty" };
	if (parts.length > 2) return { ok: false, error: `too many parts in "${raw.trim()}"` };
	const name = parseEventName(parts[0]);
	if (!name.ok) return name;
	if (parts.length === 1) return { ok: true, path: { name: name.path, value: 0 } };
	const value = Number(parts[1]);
	if (!Number.isInteger(value))
		return { ok: false, error: `event value must be an integer ("${parts[1]}")` };
	return { ok: true, path: { name: name.path, value } };
}

export function describeVar(p: VarPath): string {
	return p.kind === "B" ? `B:${p.name}` : `${p.kind}:${p.name}, ${p.unit}`;
}
