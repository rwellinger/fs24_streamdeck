/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import type { StateStyle } from "./state-rules";

// Runtime tile for the var-state action: annunciator look — colored frame,
// tinted background and colored text when lit, dim gray when "off". Same
// 144×144 / system font approach as lamp-svg.ts.

const SIZE = 144;
const BG = "#0d0d0d";
const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const TITLE_COLOR = "#cbd5e1";
const TITLE_FONT_SIZE = 18;
const TITLE_BASELINE_Y = 24;
const FRAME_INSET = 6;
const FRAME_WIDTH = 4;
const MAX_FONT_SIZE = 40;
const MIN_FONT_SIZE = 14;
const CHAR_WIDTH_EM = 0.6;
const LINE_HEIGHT_EM = 1.15;

const PALETTE: Record<StateStyle, { frame: string; fill: string; text: string }> = {
	off: { frame: "#2a2a2a", fill: BG, text: "#7a7a7a" },
	white: { frame: "#e5e7eb", fill: "#1f2937", text: "#ffffff" },
	green: { frame: "#22c55e", fill: "#0f2a18", text: "#4ade80" },
	amber: { frame: "#f59e0b", fill: "#2d1f05", text: "#fbbf24" },
	red: { frame: "#ef4444", fill: "#2d0b0b", text: "#f87171" },
	blue: { frame: "#3b82f6", fill: "#0b1a33", text: "#60a5fa" },
	cyan: { frame: "#06b6d4", fill: "#062a30", text: "#22d3ee" },
};

export interface StateTileInput {
	style: StateStyle;
	title?: string;
	text: string;
}

export function renderStateTileSvg(input: StateTileInput): string {
	const p = PALETTE[input.style];
	const title = input.title?.trim() ?? "";
	const lines = input.text.split("\n").filter((l, _i, all) => l.length > 0 || all.length === 1);

	const top = title ? TITLE_BASELINE_Y + 8 : FRAME_INSET + FRAME_WIDTH;
	const bottom = SIZE - FRAME_INSET - FRAME_WIDTH;
	const areaHeight = bottom - top;
	const areaWidth = SIZE - 2 * (FRAME_INSET + FRAME_WIDTH) - 8;
	const longest = Math.max(1, ...lines.map((l) => l.length));
	const fontSize = Math.max(
		MIN_FONT_SIZE,
		Math.min(
			MAX_FONT_SIZE,
			Math.floor(areaWidth / (longest * CHAR_WIDTH_EM)),
			Math.floor(areaHeight / (lines.length * LINE_HEIGHT_EM)),
		),
	);
	const lineHeight = fontSize * LINE_HEIGHT_EM;
	const firstBaseline =
		top + (areaHeight - lineHeight * lines.length) / 2 + lineHeight / 2 + fontSize * 0.35;

	const titleEl = title
		? `<text x="${SIZE / 2}" y="${TITLE_BASELINE_Y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${TITLE_FONT_SIZE}" font-weight="700" fill="${TITLE_COLOR}" letter-spacing="1">${escapeXml(title)}</text>`
		: "";
	const textEls = lines
		.map(
			(l, i) =>
				`<text x="${SIZE / 2}" y="${Math.round(firstBaseline + i * lineHeight)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="800" fill="${p.text}">${escapeXml(l)}</text>`,
		)
		.join("");
	const frameSize = SIZE - 2 * FRAME_INSET;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  <rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${frameSize}" height="${frameSize}" rx="10" fill="${p.fill}" stroke="${p.frame}" stroke-width="${FRAME_WIDTH}"/>
  ${titleEl}${textEls}
</svg>`;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
