/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(HERE, "fonts/InterVariable.ttf");

const fontBytes = readFileSync(FONT_PATH);
const fontBase64 = fontBytes.toString("base64");

// Unique name so we never resolve to a system-installed Inter and break
// reproducibility across machines that have a different Inter version.
export const FONT_FAMILY = "XPSDInter";

export const FONT_STYLE_BLOCK = `<defs><style>@font-face{font-family:'${FONT_FAMILY}';src:url(data:font/ttf;base64,${fontBase64}) format('truetype');font-weight:100 900;font-style:normal;}</style></defs>`;

// Inject the @font-face block right after the opening <svg ...> tag. Works
// for any SVG produced by template.ts whose root is <svg ...>.
export function withEmbeddedFont(svg: string): string {
	return svg.replace(/<svg([^>]*)>/, `<svg$1>${FONT_STYLE_BLOCK}`);
}
