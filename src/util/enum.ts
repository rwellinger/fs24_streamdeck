/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

export interface EnumMap {
	enumLut: Map<number, string>;
	enumMaxIndex: number | undefined;
	enumValid: boolean;
}

export function parseEnumMap(raw: string): EnumMap {
	const trimmed = raw.trim();
	const lut = new Map<number, string>();
	if (!trimmed) return { enumLut: lut, enumMaxIndex: undefined, enumValid: true };
	const parts = trimmed
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	let valid = true;
	let maxIndex: number | undefined;
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq <= 0 || eq === part.length - 1) {
			valid = false;
			continue;
		}
		const keyRaw = part.slice(0, eq).trim();
		const valueRaw = part.slice(eq + 1).trim();
		const key = Number(keyRaw);
		if (!Number.isInteger(key) || !valueRaw) {
			valid = false;
			continue;
		}
		if (maxIndex === undefined || key > maxIndex) maxIndex = key;
		lut.set(key, valueRaw);
	}
	return { enumLut: lut, enumMaxIndex: maxIndex, enumValid: valid };
}
