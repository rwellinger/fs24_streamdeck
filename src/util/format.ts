/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

export interface FormatOptions {
	format?: string;
	unitScale?: number;
	precision?: number;
	zeroSnap?: number;
}

const DEFAULT_FORMAT = "%s";
const PRINTF_DEFAULT_FLOAT_PRECISION = 6;

const TOKEN_RE = /%(?:(\d*)(?:\.(\d+))?)?([sdif%])/g;

/** printf-style formatting of a numeric sim value (`%s`, `%d`, `%.1f`, `%%`). */
export function formatSimValue(value: number, opts: FormatOptions = {}): string {
	const format = opts.format && opts.format.length > 0 ? opts.format : DEFAULT_FORMAT;
	const n = scaleAndSnap(value, opts);

	return format.replace(TOKEN_RE, (_match, _width, tokenPrecision, type) => {
		if (type === "%") return "%";
		const explicitPrecision = tokenPrecision !== undefined ? Number(tokenPrecision) : undefined;
		const precision = explicitPrecision ?? opts.precision;
		if (type === "s") return precision !== undefined ? n.toFixed(precision) : n.toString();
		if (type === "d" || type === "i") return Math.trunc(n).toString();
		if (type === "f") return n.toFixed(precision ?? PRINTF_DEFAULT_FLOAT_PRECISION);
		return "";
	});
}

function scaleAndSnap(n: number, opts: FormatOptions): number {
	const scale = opts.unitScale;
	const scaled = scale !== undefined && Number.isFinite(scale) ? n * scale : n;
	const t = opts.zeroSnap;
	if (t !== undefined && Number.isFinite(t) && t > 0 && Math.abs(scaled) <= t) return 0;
	return scaled;
}
