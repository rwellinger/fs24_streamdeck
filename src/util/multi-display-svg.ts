/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Runtime SVG renderer for the Multi-DataRef Display action. Same approach
// as wind-svg.ts — produce a 144×144 SVG, hand it to setImage() as a base64
// data URL. Gives us per-line font/size/color control that a flat setTitle()
// call can't deliver.

const SIZE = 144;
const BG = "#0d0d0d";
const TITLE_COLOR = "#ffffff";
const SLOT_LABEL_COLOR = "#94a3b8";
const SLOT_VALUE_COLOR = "#ffffff";
const ACCENT_COLOR = "#22c55e";
const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

const TITLE_BASELINE_Y = 22;
const TITLE_FONT_SIZE = 18;
const ACCENT_LINE_Y = 30;
const ACCENT_LINE_WIDTH = 64;
const ACCENT_LINE_HEIGHT = 2;
const SLOTS_TOP_WITH_TITLE = 44;
const SLOTS_TOP_NO_TITLE = 12;
const SLOTS_BOTTOM_MARGIN = 12;
const SIDE_PADDING = 12;

export interface SlotInput {
	label: string;
	value: string;
}

export interface MultiDisplayRenderInput {
	title?: string;
	// Only active slots (filtered upstream). The renderer adjusts font sizes
	// to the slot count so a 1-slot button uses its space.
	slots: SlotInput[];
}

export function renderMultiDisplaySvg(input: MultiDisplayRenderInput): string {
	const title = input.title?.trim() ?? "";
	const slots = input.slots;
	const n = slots.length;
	const hasTitle = title.length > 0;

	const slotsTop = hasTitle ? SLOTS_TOP_WITH_TITLE : SLOTS_TOP_NO_TITLE;
	const slotsHeight = SIZE - slotsTop - SLOTS_BOTTOM_MARGIN;
	const slotHeight = n > 0 ? slotsHeight / n : slotsHeight;

	const { valueFontSize, labelFontSize } = pickFontSizes(n);

	const titleEl = hasTitle
		? `<text x="${SIZE / 2}" y="${TITLE_BASELINE_Y}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${TITLE_FONT_SIZE}" font-weight="700"
        fill="${TITLE_COLOR}" letter-spacing="1">${escapeXml(title)}</text>
  <rect x="${(SIZE - ACCENT_LINE_WIDTH) / 2}" y="${ACCENT_LINE_Y}"
        width="${ACCENT_LINE_WIDTH}" height="${ACCENT_LINE_HEIGHT}" fill="${ACCENT_COLOR}"/>`
		: "";

	const slotEls = slots
		.map((slot, i) =>
			renderSlot(slot, slotsTop + slotHeight * (i + 0.5), valueFontSize, labelFontSize),
		)
		.join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  ${titleEl}
  ${slotEls}
</svg>`;
}

function renderSlot(
	slot: SlotInput,
	centerY: number,
	valueFontSize: number,
	labelFontSize: number,
): string {
	const hasLabel = slot.label.length > 0;
	const valueY = Math.round(centerY + valueFontSize * 0.35);
	if (!hasLabel) {
		return `<text x="${SIZE / 2}" y="${valueY}" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${valueFontSize}" font-weight="700"
        fill="${SLOT_VALUE_COLOR}">${escapeXml(slot.value)}</text>`;
	}
	const labelY = Math.round(centerY + labelFontSize * 0.35);
	return `<text x="${SIDE_PADDING}" y="${labelY}"
        font-family="${FONT_STACK}" font-size="${labelFontSize}" font-weight="500"
        fill="${SLOT_LABEL_COLOR}">${escapeXml(slot.label)}</text>
  <text x="${SIZE - SIDE_PADDING}" y="${valueY}" text-anchor="end"
        font-family="${FONT_STACK}" font-size="${valueFontSize}" font-weight="700"
        fill="${SLOT_VALUE_COLOR}">${escapeXml(slot.value)}</text>`;
}

function pickFontSizes(slotCount: number): { valueFontSize: number; labelFontSize: number } {
	if (slotCount <= 1) return { valueFontSize: 28, labelFontSize: 14 };
	if (slotCount === 2) return { valueFontSize: 24, labelFontSize: 13 };
	return { valueFontSize: 22, labelFontSize: 12 };
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
