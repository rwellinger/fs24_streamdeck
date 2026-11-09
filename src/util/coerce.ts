/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import type { SimValue } from "../sim/types";

export function toFiniteNumber(v: unknown): number | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : undefined;
}

export function coerceNumber(v: SimValue): number | undefined {
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
	}
	if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") {
		return Number.isFinite(v[0]) ? v[0] : undefined;
	}
	return undefined;
}

export function describeValue(v: SimValue): string {
	if (Array.isArray(v)) return `[${v.slice(0, 4).join(",")}${v.length > 4 ? ",…" : ""}]`;
	return `${v} (${typeof v})`;
}
