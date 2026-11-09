/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Runtime-rendered tile for the display-selector action. The big number in
// the middle is the current selector value; the row of dots near the top
// signals "this is a cycling selector" at a glance and shows which position
// out of N is active. Both update via setImage() on every value change.

const SIZE = 144;
const BG = "#0d0d0d";

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

const DOT_RADIUS = 7;
const DOT_PREFERRED_SPACING = 22;
const DOT_ROW_MAX_WIDTH = SIZE - 24;
const DOT_Y = 32;
// Beyond this we can't fit the dots edge-to-edge — fall back to no dots
// and let the number alone communicate the position.
const MAX_DOTS = 10;
const DOT_ACTIVE = "#06b6d4";
const DOT_INACTIVE = "#3a3a3a";

const NUM_COLOR = "#ffffff";
const NUM_FONT_SIZE = 58;
const NUM_Y_NO_LABEL = 100;
const NUM_Y_WITH_LABEL = 92;

const LABEL_COLOR = "#9ca3af";
const LABEL_FONT_SIZE = 18;
const LABEL_Y = 128;

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderDots(count: number, current: number): string {
	if (count < 2 || count > MAX_DOTS) return "";
	// Tighten spacing past 6 dots so the row still fits with the bigger radius.
	const spacing = Math.min(DOT_PREFERRED_SPACING, DOT_ROW_MAX_WIDTH / (count - 1));
	const totalWidth = (count - 1) * spacing;
	const startX = (SIZE - totalWidth) / 2;
	let out = "";
	for (let i = 1; i <= count; i++) {
		const cx = startX + (i - 1) * spacing;
		const fill = i === current ? DOT_ACTIVE : DOT_INACTIVE;
		out += `<circle cx="${cx}" cy="${DOT_Y}" r="${DOT_RADIUS}" fill="${fill}"/>`;
	}
	return out;
}

export function renderSelectorSvg(opts: { value: number; count: number; label?: string }): string {
	const { value, count, label } = opts;
	const hasLabel = label !== undefined && label.length > 0;
	const dots = renderDots(count, value);
	const numY = hasLabel ? NUM_Y_WITH_LABEL : NUM_Y_NO_LABEL;
	const labelEl = hasLabel
		? `<text x="${SIZE / 2}" y="${LABEL_Y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${LABEL_FONT_SIZE}" fill="${LABEL_COLOR}">${escapeXml(label)}</text>`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${dots}
  <text x="${SIZE / 2}" y="${numY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${NUM_FONT_SIZE}" font-weight="700" fill="${NUM_COLOR}">${value}</text>
  ${labelEl}
</svg>`;
}

export function svgToDataUrl(svg: string): string {
	const b64 = Buffer.from(svg, "utf-8").toString("base64");
	return `data:image/svg+xml;base64,${b64}`;
}
