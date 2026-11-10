/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Runtime SVG renderer for the Wind Display action. Output is a base64 data
// URL suitable for KeyAction.setImage(). Kept separate from the build-time
// renderer in scripts/icons/template.ts so the plugin bundle stays slim.

const SIZE = 144;
const BG = "#0d0d0d";
const ARROW_COLOR = "#22c55e";
const TEXT_COLOR = "#ffffff";
const SUB_TEXT_COLOR = "#94a3b8";
const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

export interface WindRenderInput {
	label?: string;
	directionDeg?: number;
	speed?: number;
	oat?: number;
	speedUnit?: string;
	// "to" = arrow points where the wind is going (PFD convention).
	// "from" = arrow points at the source of the wind (weather chart).
	arrowConvention?: "from" | "to";
	/** Arrow rotation offset, e.g. the heading for a heading-up rose. */
	rotationOffsetDeg?: number;
	/** Prefix the speed with the direction as `DDD/` (aviation notation). */
	showDirection?: boolean;
}

export function renderWindSvg(input: WindRenderInput): string {
	const dir = input.directionDeg;
	const speed = input.speed;
	const oat = input.oat;
	const label = input.label ?? "WIND";
	const speedUnit = input.speedUnit ?? "kt";
	const convention = input.arrowConvention ?? "to";

	const dirValid = dir !== undefined && Number.isFinite(dir);
	// AMBIENT WIND DIRECTION is "where the wind comes from". For the PFD-style
	// "to"-arrow we rotate by +180°.
	const arrowDeg = dirValid
		? (convention === "to" ? (dir as number) + 180 : (dir as number)) -
			(input.rotationOffsetDeg ?? 0)
		: 0;

	const cx = SIZE / 2;
	const cy = 80;
	const shaftHalf = 30;
	const headHalf = 14;

	const speedValid = speed !== undefined && Number.isFinite(speed);
	const speedText = !speedValid
		? "—"
		: input.showDirection && dirValid
			? `${String(Math.round(dir as number) % 360).padStart(3, "0")}/${Math.round(speed as number)}`
			: `${Math.round(speed as number)} ${speedUnit}`;

	const oatText = oat !== undefined && Number.isFinite(oat) ? formatOat(oat) : null;

	const arrowEl = dirValid
		? `<g transform="translate(${cx},${cy}) rotate(${arrowDeg})">
    <line x1="0" y1="${shaftHalf}" x2="0" y2="${-shaftHalf + headHalf}"
          stroke="${ARROW_COLOR}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="0,${-shaftHalf} ${headHalf},${-shaftHalf + headHalf + 2} ${-headHalf},${-shaftHalf + headHalf + 2}"
             fill="${ARROW_COLOR}"/>
  </g>`
		: `<text x="${cx}" y="${cy + 6}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="20" font-weight="700"
        fill="${SUB_TEXT_COLOR}">—</text>`;

	const oatEl = oatText
		? `<text x="${SIZE - 8}" y="24" text-anchor="end"
        font-family="${FONT_STACK}" font-size="20" font-weight="700"
        fill="${SUB_TEXT_COLOR}">${escapeXml(oatText)}</text>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  <text x="8" y="22"
        font-family="${FONT_STACK}" font-size="16" font-weight="700"
        fill="${TEXT_COLOR}" letter-spacing="1">${escapeXml(label)}</text>
  ${oatEl}
  ${arrowEl}
  <text x="${cx}" y="${SIZE - 16}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="24" font-weight="800"
        fill="${TEXT_COLOR}">${escapeXml(speedText)}</text>
</svg>`;
}

export function renderWindDataUrl(input: WindRenderInput): string {
	const svg = renderWindSvg(input);
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function formatOat(c: number): string {
	const rounded = Math.round(c);
	return rounded >= 0 ? `+${rounded}°C` : `${rounded}°C`;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
