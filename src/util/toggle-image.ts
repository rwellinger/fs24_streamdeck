/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Runtime renderer for the toggle tile — a sliding on/off switch with an
// optional baked-in static label. dataref-toggle renders this whenever the user
// picks a non-default orientation/color or sets a Static Label, pushing it over
// the manifest state image via setImage(). Baking (rather than a title overlay)
// keeps the label pinned regardless of state; offering orientation + color here
// means the user gets visual variety without uploading custom images (an
// uploaded image takes precedence over setImage() and would hide the label).
//
// Mirrors dataref-switch / switch-image: same orientation + bodyColor knobs,
// same Top/Bottom label placement.

import { svgToDataUrl } from "./switch-image";

export { svgToDataUrl };

const SIZE = 144;
const BG = "#0d0d0d";

const TRACK_THICKNESS = 36;
const TRACK_BORDER = "#444444";
const OFF_TRACK_FILL = "#2d2d2d";
const HANDLE_RADIUS = TRACK_THICKNESS / 2 - 3;
const HANDLE_INSET = 4;

// Body color palette. "on" is the track fill in the ON state (OFF is always the
// muted gray above, so the slider reads as off/on at a glance); "handle" is the
// sliding knob. White needs a dark knob so it doesn't vanish against the light
// track.
export type ToggleBodyColor = "gray" | "red" | "green" | "white" | "blue";

const TOGGLE_PALETTE: Record<ToggleBodyColor, { on: string; handle: string }> = {
	gray: { on: "#2d2d2d", handle: "#e0e0e0" },
	red: { on: "#ef4444", handle: "#ffffff" },
	green: { on: "#22c55e", handle: "#ffffff" },
	blue: { on: "#3b82f6", handle: "#ffffff" },
	white: { on: "#d4d4d8", handle: "#3f3f46" },
};

// Horizontal track (long axis X): off = handle left, on = handle right.
const H_LONG = 100;
const H_TOP_DEFAULT = 30;
const H_TOP_WITH_TOP_LABEL = 58;

// Vertical track (long axis Y): on = handle top, off = handle bottom ("switch
// up = on", the intuitive default). Use the invert flag upstream to flip it.
// Long axis shrinks + shifts to clear a top/bottom label.
const V_TOP_NO_LABEL = 22;
const V_LONG_NO_LABEL = 100;
const V_TOP_WITH_TOP_LABEL = 50;
const V_TOP_WITH_BOTTOM_LABEL = 20;
const V_LONG_WITH_LABEL = 74;

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const LABEL_COLOR = "#ffffff";
const LABEL_FONT_SIZE = 22;
const LABEL_TOP_BASELINE_Y = 22;
const LABEL_BOTTOM_BASELINE_Y = 134;

export type ToggleLabelPosition = "top" | "bottom";
export type ToggleOrientation = "vertical" | "horizontal";

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderToggleStateSvg(
	state: "off" | "on",
	label = "",
	labelPos: ToggleLabelPosition = "top",
	orientation: ToggleOrientation = "horizontal",
	bodyColor: ToggleBodyColor = "gray",
): string {
	const hasLabel = label.length > 0;
	const palette = TOGGLE_PALETTE[bodyColor];
	const trackFill = state === "on" ? palette.on : OFF_TRACK_FILL;

	let trackX: number;
	let trackY: number;
	let trackW: number;
	let trackH: number;
	let handleCx: number;
	let handleCy: number;

	if (orientation === "vertical") {
		trackW = TRACK_THICKNESS;
		trackX = (SIZE - trackW) / 2;
		if (!hasLabel) {
			trackY = V_TOP_NO_LABEL;
			trackH = V_LONG_NO_LABEL;
		} else if (labelPos === "top") {
			trackY = V_TOP_WITH_TOP_LABEL;
			trackH = V_LONG_WITH_LABEL;
		} else {
			trackY = V_TOP_WITH_BOTTOM_LABEL;
			trackH = V_LONG_WITH_LABEL;
		}
		handleCx = SIZE / 2;
		handleCy =
			state === "on"
				? trackY + HANDLE_RADIUS + HANDLE_INSET
				: trackY + trackH - HANDLE_RADIUS - HANDLE_INSET;
	} else {
		trackH = TRACK_THICKNESS;
		trackW = H_LONG;
		trackX = (SIZE - trackW) / 2;
		trackY = hasLabel && labelPos === "top" ? H_TOP_WITH_TOP_LABEL : H_TOP_DEFAULT;
		handleCy = trackY + trackH / 2;
		handleCx =
			state === "off"
				? trackX + HANDLE_RADIUS + HANDLE_INSET
				: trackX + trackW - HANDLE_RADIUS - HANDLE_INSET;
	}

	let labelEl = "";
	if (hasLabel) {
		const baselineY = labelPos === "top" ? LABEL_TOP_BASELINE_Y : LABEL_BOTTOM_BASELINE_Y;
		labelEl = `<text x="${SIZE / 2}" y="${baselineY}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${LABEL_FONT_SIZE}" font-weight="800"
        fill="${LABEL_COLOR}" letter-spacing="1">${escapeXml(label)}</text>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${labelEl}
  <rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="${TRACK_THICKNESS / 2}"
        fill="${trackFill}" stroke="${TRACK_BORDER}" stroke-width="2"/>
  <circle cx="${handleCx}" cy="${handleCy}" r="${HANDLE_RADIUS}" fill="${palette.handle}"/>
</svg>`;
}
