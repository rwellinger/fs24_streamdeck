/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck from "@elgato/streamdeck";

import { SimCommand } from "./actions/command";
import { VarDisplay } from "./actions/var-display";
import { VarLamp } from "./actions/var-lamp";
import { VarSwitch } from "./actions/var-switch";
import { VarToggle } from "./actions/var-toggle";
import { SimClient } from "./sim";
import { type GlobalSettings, targetFromSettings } from "./sim/global-settings";
import { installProbeHandler } from "./sim/probe";

streamDeck.logger.setLevel("info");

const sim = new SimClient(streamDeck.logger);

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	sim.setTarget(targetFromSettings(ev.settings));
});

streamDeck.actions.registerAction(new SimCommand(sim));
streamDeck.actions.registerAction(new VarToggle(sim));
streamDeck.actions.registerAction(new VarDisplay(sim));
streamDeck.actions.registerAction(new VarSwitch(sim));
streamDeck.actions.registerAction(new VarLamp(sim));
installProbeHandler(sim);

streamDeck
	.connect()
	.then(() => streamDeck.settings.getGlobalSettings<GlobalSettings>())
	.then((s) => sim.setTarget(targetFromSettings(s)))
	.catch((err) => streamDeck.logger.error("startup failed", err))
	.finally(() => sim.connect());
