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
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../sim";
import { type PressAction, parsePressAction } from "../sim/path";
import { toFiniteNumber } from "../util/coerce";
import { clearOffline, setOffline } from "../util/error-tile";
import { PressController, withLong } from "../util/press";
import { trimString } from "../util/settings";

type CommandSettings = JsonObject & {
	eventName?: string;
	eventValue?: string;
	longEventName?: string;
	autoRepeat?: boolean;
	hideConfirmation?: boolean;
};

@action({ UUID: "com.robertw.fs24.command" })
export class SimCommand extends SingletonAction<CommandSettings> {
	private readonly visible = new Map<string, KeyAction<CommandSettings>>();
	private readonly press: PressController<CommandSettings>;

	constructor(private readonly sim: SimClient) {
		super();
		this.press = new PressController(sim, "command");
		this.sim.on("offline", () => this.onSimOffline());
		this.sim.on("online", () => this.onSimOnline());
	}

	override async onWillAppear(ev: WillAppearEvent<CommandSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		this.visible.set(ev.action.id, ev.action);
		// Reset in both directions: the Stream Deck app keeps the last image across
		// plugin restarts/reinstalls, so a stale offline band would otherwise stay.
		await (this.sim.isOffline() ? setOffline(ev.action) : clearOffline(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<CommandSettings>): Promise<void> {
		this.press.cancel(ev.action.id);
		this.visible.delete(ev.action.id);
		return Promise.resolve();
	}

	override async onKeyDown(ev: KeyDownEvent<CommandSettings>): Promise<void> {
		const s = ev.payload.settings ?? {};
		const parsed = parsePressAction(trimString(s.eventName));
		if (!parsed.ok) {
			streamDeck.logger.warn(`command: event: ${parsed.error}`);
			await ev.action.showAlert();
			return;
		}

		let short: PressAction = parsed.path;
		const rawValue = trimString(s.eventValue);
		if (short.kind === "K" && rawValue) {
			const value = toFiniteNumber(rawValue);
			if (value === undefined || !Number.isInteger(value)) {
				streamDeck.logger.warn(`command: invalid eventValue "${rawValue}"`);
				await ev.action.showAlert();
				return;
			}
			short = { ...short, value };
		}

		const config = withLong(
			{ short, repeat: s.autoRepeat === true, confirm: s.hideConfirmation !== true },
			trimString(s.longEventName),
		);
		if (!config.ok) {
			streamDeck.logger.warn(`command: ${config.error}`);
			await ev.action.showAlert();
			return;
		}
		await this.press.down(ev.action, config.path);
	}

	override async onKeyUp(ev: KeyUpEvent<CommandSettings>): Promise<void> {
		await this.press.up(ev.action);
	}

	private onSimOffline(): void {
		this.press.cancelAll();
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
