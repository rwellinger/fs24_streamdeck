/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Single source of truth for the 3-position switch tile — used both at build
// time (scripts/generate-icons.ts writes the unlabeled defaults into the
// plugin bundle) and at runtime (src/actions/dataref-switch.ts renders a
// labeled variant whenever the user sets a Static Label or picks the
// horizontal orientation).
//
// Body fill is a mid-grey so a white Stream Deck title overlay stays readable
// against the switch shape; the canvas stays near-black so the body still
// pops.

const SIZE = 144;
const BG = "#0d0d0d";

// Body color palette. "gray" is the default; "red" / "green" are picked from
// the PI when the user wants a hard visual cue (e.g. red for emergency cut-off
// switches, green for normal-operating system switches). Darker fill + lighter
// border = standard cockpit-switch look that stays readable against #0d0d0d.
export type SwitchBodyColor = "gray" | "red" | "green";

const BODY_PALETTE: Record<SwitchBodyColor, { fill: string; border: string }> = {
	gray: { fill: "#4a4a4a", border: "#8a8a8a" },
	red: { fill: "#b91c1c", border: "#ef4444" },
	green: { fill: "#166534", border: "#22c55e" },
};

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const LABEL_COLOR = "#ffffff";
const LABEL_FONT_SIZE = 22;
const LABEL_TOP_BASELINE_Y = 22;
const LABEL_BOTTOM_BASELINE_Y = 134;

// Vertical body extents (long axis is Y, short axis is X).
const BODY_VERTICAL_DEFAULT_TOP = 24;
const BODY_VERTICAL_DEFAULT_BOTTOM = 120;
const BODY_VERTICAL_WITH_LABEL_TOP_TOP = 50;
const BODY_VERTICAL_WITH_LABEL_TOP_BOTTOM = 124;
const BODY_VERTICAL_WITH_LABEL_BOTTOM_TOP = 20;
const BODY_VERTICAL_WITH_LABEL_BOTTOM_BOTTOM = 94;
const BODY_VERTICAL_W = 64;
const BODY_VERTICAL_R = 32;

// Horizontal body extents (long axis is X, short axis is Y). The body is a
// fixed-width strip; vertical placement shifts to leave room for a top or
// bottom label.
const BODY_HORIZONTAL_LEFT = 24;
const BODY_HORIZONTAL_RIGHT = 120;
const BODY_HORIZONTAL_HEIGHT = 64;
const BODY_HORIZONTAL_TOP_NO_LABEL = (SIZE - BODY_HORIZONTAL_HEIGHT) / 2;
const BODY_HORIZONTAL_TOP_WITH_TOP_LABEL = 50;
const BODY_HORIZONTAL_TOP_WITH_BOTTOM_LABEL = 30;

export type SwitchOrientation = "vertical" | "horizontal";
export type SwitchTilePosition = "min" | "mid" | "max";
export type SwitchLabelPosition = "top" | "bottom";

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function verticalPath(
	position: SwitchTilePosition,
	hasLabel: boolean,
	labelPos: SwitchLabelPosition,
): string {
	let bodyTop: number;
	let bodyBottom: number;
	if (!hasLabel) {
		bodyTop = BODY_VERTICAL_DEFAULT_TOP;
		bodyBottom = BODY_VERTICAL_DEFAULT_BOTTOM;
	} else if (labelPos === "top") {
		bodyTop = BODY_VERTICAL_WITH_LABEL_TOP_TOP;
		bodyBottom = BODY_VERTICAL_WITH_LABEL_TOP_BOTTOM;
	} else {
		bodyTop = BODY_VERTICAL_WITH_LABEL_BOTTOM_TOP;
		bodyBottom = BODY_VERTICAL_WITH_LABEL_BOTTOM_BOTTOM;
	}

	const left = (SIZE - BODY_VERTICAL_W) / 2;
	const right = left + BODY_VERTICAL_W;
	const r = BODY_VERTICAL_R;

	if (position === "min") {
		// "Switch pushed up": rounded top, flat bottom.
		return `M ${left} ${bodyBottom} L ${right} ${bodyBottom} L ${right} ${bodyTop + r} Q ${right} ${bodyTop} ${right - r} ${bodyTop} L ${left + r} ${bodyTop} Q ${left} ${bodyTop} ${left} ${bodyTop + r} Z`;
	}
	if (position === "max") {
		// "Switch pushed down": flat top, rounded bottom.
		return `M ${left} ${bodyTop} L ${right} ${bodyTop} L ${right} ${bodyBottom - r} Q ${right} ${bodyBottom} ${right - r} ${bodyBottom} L ${left + r} ${bodyBottom} Q ${left} ${bodyBottom} ${left} ${bodyBottom - r} Z`;
	}
	// Stadium pill — all four corners rounded.
	return `M ${left} ${bodyTop + r} Q ${left} ${bodyTop} ${left + r} ${bodyTop} L ${right - r} ${bodyTop} Q ${right} ${bodyTop} ${right} ${bodyTop + r} L ${right} ${bodyBottom - r} Q ${right} ${bodyBottom} ${right - r} ${bodyBottom} L ${left + r} ${bodyBottom} Q ${left} ${bodyBottom} ${left} ${bodyBottom - r} Z`;
}

function horizontalPath(
	position: SwitchTilePosition,
	hasLabel: boolean,
	labelPos: SwitchLabelPosition,
): string {
	let bodyTop: number;
	if (!hasLabel) {
		bodyTop = BODY_HORIZONTAL_TOP_NO_LABEL;
	} else if (labelPos === "top") {
		bodyTop = BODY_HORIZONTAL_TOP_WITH_TOP_LABEL;
	} else {
		bodyTop = BODY_HORIZONTAL_TOP_WITH_BOTTOM_LABEL;
	}
	const bodyBottom = bodyTop + BODY_HORIZONTAL_HEIGHT;
	const bodyLeft = BODY_HORIZONTAL_LEFT;
	const bodyRight = BODY_HORIZONTAL_RIGHT;
	const r = BODY_HORIZONTAL_HEIGHT / 2;

	if (position === "min") {
		// "Switch pushed left": rounded left, flat right.
		return `M ${bodyRight} ${bodyTop} L ${bodyLeft + r} ${bodyTop} Q ${bodyLeft} ${bodyTop} ${bodyLeft} ${bodyTop + r} L ${bodyLeft} ${bodyBottom - r} Q ${bodyLeft} ${bodyBottom} ${bodyLeft + r} ${bodyBottom} L ${bodyRight} ${bodyBottom} Z`;
	}
	if (position === "max") {
		// "Switch pushed right": flat left, rounded right.
		return `M ${bodyLeft} ${bodyTop} L ${bodyRight - r} ${bodyTop} Q ${bodyRight} ${bodyTop} ${bodyRight} ${bodyTop + r} L ${bodyRight} ${bodyBottom - r} Q ${bodyRight} ${bodyBottom} ${bodyRight - r} ${bodyBottom} L ${bodyLeft} ${bodyBottom} Z`;
	}
	// Horizontal stadium pill — all four corners rounded.
	return `M ${bodyLeft + r} ${bodyTop} L ${bodyRight - r} ${bodyTop} Q ${bodyRight} ${bodyTop} ${bodyRight} ${bodyTop + r} L ${bodyRight} ${bodyBottom - r} Q ${bodyRight} ${bodyBottom} ${bodyRight - r} ${bodyBottom} L ${bodyLeft + r} ${bodyBottom} Q ${bodyLeft} ${bodyBottom} ${bodyLeft} ${bodyBottom - r} L ${bodyLeft} ${bodyTop + r} Q ${bodyLeft} ${bodyTop} ${bodyLeft + r} ${bodyTop} Z`;
}

export function renderSwitchStateSvg(
	position: SwitchTilePosition,
	orientation: SwitchOrientation = "vertical",
	label = "",
	labelPos: SwitchLabelPosition = "top",
	bodyColor: SwitchBodyColor = "gray",
): string {
	const hasLabel = label.length > 0;
	const path =
		orientation === "horizontal"
			? horizontalPath(position, hasLabel, labelPos)
			: verticalPath(position, hasLabel, labelPos);

	let labelEl = "";
	if (hasLabel) {
		const baselineY = labelPos === "top" ? LABEL_TOP_BASELINE_Y : LABEL_BOTTOM_BASELINE_Y;
		labelEl = `<text x="${SIZE / 2}" y="${baselineY}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${LABEL_FONT_SIZE}" font-weight="800"
        fill="${LABEL_COLOR}" letter-spacing="1">${escapeXml(label)}</text>`;
	}

	const palette = BODY_PALETTE[bodyColor];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${labelEl}
  <path d="${path}" fill="${palette.fill}" stroke="${palette.border}" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
}

export function svgToDataUrl(svg: string): string {
	const b64 = Buffer.from(svg, "utf-8").toString("base64");
	return `data:image/svg+xml;base64,${b64}`;
}
