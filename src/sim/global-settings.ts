/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import type { JsonObject } from "@elgato/utils";

import { toFiniteNumber } from "../util/coerce";
import { trimString } from "../util/settings";
import type { SimTarget } from "./client";

export type GlobalSettings = JsonObject & {
	simHost?: string;
	simPort?: string | number;
};

export const DEFAULT_REMOTE_PORT = 500;

/** Empty host → local autodetect (pipe/registry on the sim PC itself). */
export function targetFromSettings(s: GlobalSettings | undefined): SimTarget {
	const host = trimString(s?.simHost);
	if (!host) return null;
	const rawPort = s?.simPort;
	const port = toFiniteNumber(typeof rawPort === "string" ? rawPort.trim() : rawPort);
	const valid = port !== undefined && Number.isInteger(port) && port > 0 && port < 65536;
	return { host, port: valid ? port : DEFAULT_REMOTE_PORT };
}
