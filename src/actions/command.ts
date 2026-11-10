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

import { TIMINGS } from "../const";
import type { SimClient } from "../sim";
import { describePressAction, type PressAction, parsePressAction } from "../sim/path";
import { toFiniteNumber } from "../util/coerce";
import { clearOffline, setOffline } from "../util/error-tile";
import { trimString } from "../util/settings";

type CommandSettings = JsonObject & {
	eventName?: string;
	eventValue?: string;
	autoRepeat?: boolean;
	hideConfirmation?: boolean;
};

type Repeater = { initial: NodeJS.Timeout; interval?: NodeJS.Timeout };

@action({ UUID: "com.robertw.fs24.command" })
export class SimCommand extends SingletonAction<CommandSettings> {
	private readonly visible = new Map<string, KeyAction<CommandSettings>>();
	private readonly repeaters = new Map<string, Repeater>();

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
		this.stopRepeater(ev.action.id);
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

		let press: PressAction = parsed.path;
		const rawValue = trimString(s.eventValue);
		if (press.kind === "K" && rawValue) {
			const value = toFiniteNumber(rawValue);
			if (value === undefined || !Number.isInteger(value)) {
				streamDeck.logger.warn(`command: invalid eventValue "${rawValue}"`);
				await ev.action.showAlert();
				return;
			}
			press = { ...press, value };
		}

		const label = describePressAction(press);
		try {
			await this.sim.fire(press);
			streamDeck.logger.info(`command: ${label}`);
			if (s.autoRepeat === true) this.startRepeater(ev.action.id, press);
			if (s.hideConfirmation !== true) await ev.action.showOk();
		} catch (err) {
			streamDeck.logger.error(`command failed: ${label}`, err);
			await ev.action.showAlert();
		}
	}

	override onKeyUp(ev: KeyUpEvent<CommandSettings>): Promise<void> {
		this.stopRepeater(ev.action.id);
		return Promise.resolve();
	}

	private startRepeater(actionId: string, press: PressAction): void {
		this.stopRepeater(actionId);
		const entry: Repeater = {
			initial: setTimeout(() => {
				entry.interval = setInterval(() => {
					this.sim
						.fire(press)
						.catch((err) =>
							streamDeck.logger.error(
								`command repeat failed: ${describePressAction(press)}`,
								err,
							),
						);
				}, TIMINGS.REPEAT_INTERVAL_MS);
			}, TIMINGS.REPEAT_INITIAL_DELAY_MS),
		};
		this.repeaters.set(actionId, entry);
	}

	private stopRepeater(actionId: string): void {
		const r = this.repeaters.get(actionId);
		if (!r) return;
		clearTimeout(r.initial);
		if (r.interval) clearInterval(r.interval);
		this.repeaters.delete(actionId);
	}

	private onSimOffline(): void {
		for (const id of [...this.repeaters.keys()]) this.stopRepeater(id);
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
