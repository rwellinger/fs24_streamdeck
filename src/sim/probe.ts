/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { SimClient } from "./client";
import { describePressAction, parseEventName, parsePressAction, parseVarPath } from "./path";

type ProbeKind = "var" | "event" | "kevent";
type ProbeRequest = { type: "probe"; field: string; kind: ProbeKind; text: string };

/**
 * PI live preview: the property inspector can't talk to SimConnect, so it
 * sends the text of a path field and gets back what the plugin sees
 * (value / unknown / syntax error). See ui/sim-pi-helpers.js.
 */
export function installProbeHandler(sim: SimClient): void {
	streamDeck.ui.onSendToPlugin<JsonValue>((ev) => {
		const req = ev.payload as Partial<ProbeRequest> | null;
		if (!req || req.type !== "probe" || typeof req.field !== "string") return;
		const kind: ProbeKind = req.kind === "event" || req.kind === "kevent" ? req.kind : "var";
		answer(sim, kind, String(req.text ?? ""))
			.then((result) =>
				streamDeck.ui.sendToPropertyInspector({
					type: "probe",
					field: req.field ?? "",
					...result,
				}),
			)
			.catch((err) => streamDeck.logger.warn("probe failed", err));
	});
}

async function answer(
	sim: SimClient,
	kind: ProbeKind,
	text: string,
): Promise<{ state: string; text: string }> {
	if (!text.trim()) return { state: "empty", text: "" };
	if (kind === "kevent") {
		const name = parseEventName(text);
		return name.ok
			? { state: "ok", text: `K:${name.path}` }
			: { state: "error", text: name.error };
	}
	if (kind === "event") {
		const press = parsePressAction(text);
		if (!press.ok) return { state: "error", text: press.error };
		const label = describePressAction(press.path);
		if (press.path.kind === "K") return { state: "ok", text: label };
		if (!sim.isConnected()) return { state: "offline", text: `${label} — sim not connected` };
		try {
			return { state: "ok", text: `${label} — via WASM bridge ${await sim.bridgeVersion()}` };
		} catch {
			return { state: "not-found", text: `${label} — WASM bridge not responding` };
		}
	}
	const parsed = parseVarPath(text);
	if (!parsed.ok) return { state: "error", text: parsed.error };
	if (!sim.isConnected()) return { state: "offline", text: "sim not connected" };
	try {
		const value = await sim.read(parsed.path);
		return { state: "ok", text: `= ${Number.isInteger(value) ? value : value.toFixed(3)}` };
	} catch (err) {
		return { state: "not-found", text: err instanceof Error ? err.message : String(err) };
	}
}
