/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Runtime SVG renderer for the DataRef Lamp action. Output is a base64 data
// URL suitable for KeyAction.setImage(). Follows the same pattern as
// wind-svg.ts / switch-image.ts: 144×144 canvas, system font stack, no
// embedded font (runtime tiles tolerate a small per-OS font difference).

const SIZE = 144;
const BG = "#0d0d0d";

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const LABEL_COLOR = "#ffffff";
const LABEL_FONT_SIZE = 22;
const LABEL_TOP_BASELINE_Y = 22;
const LABEL_BOTTOM_BASELINE_Y = 134;

const DIM_FILL = "#1f1f1f";
const DIM_RIM = "#3a3a3a";

export type LampColor = "blue" | "green" | "yellow" | "orange" | "red";
export type LampLabelPosition = "top" | "bottom";

const PALETTE: Record<LampColor, { lit: string; glow: string }> = {
	blue: { lit: "#3b82f6", glow: "#60a5fa" },
	green: { lit: "#22c55e", glow: "#4ade80" },
	yellow: { lit: "#eab308", glow: "#facc15" },
	orange: { lit: "#f59e0b", glow: "#fbbf24" },
	red: { lit: "#ef4444", glow: "#f87171" },
};

export interface LampRenderInput {
	color: LampColor;
	isLit: boolean;
	label?: string;
	labelPosition?: LampLabelPosition;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLampSvg(input: LampRenderInput): string {
	const label = input.label ?? "";
	const hasLabel = label.length > 0;
	const labelPos: LampLabelPosition = input.labelPosition ?? "top";
	const palette = PALETTE[input.color];

	// Lamp center & radius depend on whether a label is rendered and where it
	// sits — leave ~30 px of vertical room for the label.
	let cy: number;
	let radius: number;
	if (!hasLabel) {
		cy = SIZE / 2;
		radius = 44;
	} else if (labelPos === "top") {
		cy = 88;
		radius = 42;
	} else {
		cy = 58;
		radius = 42;
	}
	const cx = SIZE / 2;

	let labelEl = "";
	if (hasLabel) {
		const baselineY = labelPos === "top" ? LABEL_TOP_BASELINE_Y : LABEL_BOTTOM_BASELINE_Y;
		labelEl = `<text x="${cx}" y="${baselineY}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${LABEL_FONT_SIZE}" font-weight="800"
        fill="${LABEL_COLOR}" letter-spacing="1">${escapeXml(label)}</text>`;
	}

	let lampEl: string;
	if (input.isLit) {
		// Two halo rings (low-opacity glow) under a bright body, plus a small
		// off-center highlight on the upper-left for a 3D "lit" feel.
		const haloOuter = radius + 10;
		const haloInner = radius + 4;
		const highlightR = radius * 0.35;
		const highlightCx = cx - radius * 0.32;
		const highlightCy = cy - radius * 0.32;
		lampEl = `
  <circle cx="${cx}" cy="${cy}" r="${haloOuter}" fill="${palette.glow}" opacity="0.18"/>
  <circle cx="${cx}" cy="${cy}" r="${haloInner}" fill="${palette.glow}" opacity="0.35"/>
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${palette.lit}"/>
  <circle cx="${highlightCx}" cy="${highlightCy}" r="${highlightR}" fill="${palette.glow}" opacity="0.55"/>`;
	} else {
		lampEl = `
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${DIM_FILL}" stroke="${DIM_RIM}" stroke-width="2"/>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${labelEl}${lampEl}
</svg>`;
}

export function renderLampDataUrl(input: LampRenderInput): string {
	const svg = renderLampSvg(input);
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
