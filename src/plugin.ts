/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck from "@elgato/streamdeck";

import { SimCommand } from "./actions/command";
import { SimClient } from "./sim";
import { type GlobalSettings, targetFromSettings } from "./sim/global-settings";

streamDeck.logger.setLevel("info");

const sim = new SimClient(streamDeck.logger);

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	sim.setTarget(targetFromSettings(ev.settings));
});

streamDeck.actions.registerAction(new SimCommand(sim));

streamDeck
	.connect()
	.then(() => streamDeck.settings.getGlobalSettings<GlobalSettings>())
	.then((s) => sim.setTarget(targetFromSettings(s)))
	.catch((err) => streamDeck.logger.error("startup failed", err))
	.finally(() => sim.connect());
