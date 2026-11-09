/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck, {
	action,
	type KeyAction,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../sim";
import { coerceNumber } from "../util/coerce";
import { clearOffline, setOffline } from "../util/error-tile";
import { trimString } from "../util/settings";

type CommandSettings = JsonObject & {
	eventName?: string;
	eventValue?: string;
	hideConfirmation?: boolean;
};

@action({ UUID: "com.robertw.fs24.command" })
export class SimCommand extends SingletonAction<CommandSettings> {
	private readonly visible = new Map<string, KeyAction<CommandSettings>>();

	constructor(private readonly sim: SimClient) {
		super();
		this.sim.on("offline", () => this.onSimOffline());
		this.sim.on("online", () => this.onSimOnline());
	}

	override async onWillAppear(ev: WillAppearEvent<CommandSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		this.visible.set(ev.action.id, ev.action);
		if (this.sim.isOffline()) {
			await setOffline(ev.action);
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<CommandSettings>): Promise<void> {
		this.visible.delete(ev.action.id);
		return Promise.resolve();
	}

	override async onKeyDown(ev: KeyDownEvent<CommandSettings>): Promise<void> {
		const name = trimString(ev.payload.settings?.eventName);
		if (!name) {
			streamDeck.logger.warn("command: eventName is empty");
			await ev.action.showAlert();
			return;
		}

		const rawValue = trimString(ev.payload.settings?.eventValue);
		const value = rawValue ? coerceNumber(rawValue) : 0;
		if (value === undefined || !Number.isInteger(value)) {
			streamDeck.logger.warn(`command: invalid eventValue "${rawValue}"`);
			await ev.action.showAlert();
			return;
		}

		try {
			await this.sim.transmitEvent(name, value);
			streamDeck.logger.info(`command: ${name} (${value})`);
			if (ev.payload.settings?.hideConfirmation !== true) {
				await ev.action.showOk();
			}
		} catch (err) {
			streamDeck.logger.error(`command failed: ${name}`, err);
			await ev.action.showAlert();
		}
	}

	private onSimOffline(): void {
		for (const a of this.visible.values()) {
			setOffline(a).catch((err) => streamDeck.logger.warn("command: setOffline failed", err));
		}
	}

	private onSimOnline(): void {
		for (const a of this.visible.values()) {
			clearOffline(a).catch((err) =>
				streamDeck.logger.warn("command: clearOffline failed", err),
			);
		}
	}
}
