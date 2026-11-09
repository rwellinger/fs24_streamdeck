/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

export function toFiniteNumber(v: unknown): number | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : undefined;
}
