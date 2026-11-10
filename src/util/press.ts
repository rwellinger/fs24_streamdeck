/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck, { type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { TIMINGS } from "../const";
import type { SimClient } from "../sim";
import {
	describePressAction,
	type ParseResult,
	type PressAction,
	parsePressAction,
} from "../sim/path";
import { trimString } from "./settings";

export interface PressConfig {
	short: PressAction;
	/** Fired instead of `short` once the key is held past the long-press threshold. */
	long?: PressAction;
	/** Ignored when `long` is set — a held key can't mean both. */
	repeat: boolean;
	confirm: boolean;
}

export type PressSettings = {
	pressAction?: string;
	longPressAction?: string;
	autoRepeat?: boolean;
	hideConfirmation?: boolean;
};

/** `undefined` = no press configured (display-only key). */
export function parsePressSettings(s: PressSettings): ParseResult<PressConfig> | undefined {
	const shortText = trimString(s.pressAction);
	const longText = trimString(s.longPressAction);
	if (!shortText && !longText) return undefined;
	const short = parsePressAction(shortText);
	if (!short.ok) return { ok: false, error: `press action: ${short.error}` };
	return withLong(
		{ short: short.path, repeat: s.autoRepeat === true, confirm: s.hideConfirmation !== true },
		longText,
	);
}

export function withLong(base: PressConfig, longText: string): ParseResult<PressConfig> {
	if (!longText) return { ok: true, path: base };
	const long = parsePressAction(longText);
	if (!long.ok) return { ok: false, error: `long press action: ${long.error}` };
	return { ok: true, path: { ...base, long: long.path } };
}

type Pending = {
	config: PressConfig;
	longTimer?: NodeJS.Timeout;
	longFired: boolean;
	repeatDelay?: NodeJS.Timeout;
	repeatInterval?: NodeJS.Timeout;
};

/** Per-key press handling: short / long press and auto-repeat while held. */
export class PressController<T extends JsonObject> {
	private readonly pending = new Map<string, Pending>();

	constructor(
		private readonly sim: SimClient,
		private readonly logName: string,
	) {}

	async down(action: KeyAction<T>, config: PressConfig): Promise<void> {
		this.cancel(action.id);
		const p: Pending = { config, longFired: false };
		this.pending.set(action.id, p);
		if (config.long) {
			const long = config.long;
			p.longTimer = setTimeout(() => {
				p.longTimer = undefined;
				p.longFired = true;
				this.fire(action, long, config.confirm).catch(() => {});
			}, TIMINGS.LONG_PRESS_THRESHOLD_MS);
			return;
		}
		if (!(await this.fire(action, config.short, config.confirm))) return;
		if (config.repeat && this.pending.get(action.id) === p) this.startRepeat(p);
	}

	async up(action: KeyAction<T>): Promise<void> {
		const p = this.pending.get(action.id);
		this.cancel(action.id);
		if (p?.config.long && !p.longFired)
			await this.fire(action, p.config.short, p.config.confirm);
	}

	cancel(actionId: string): void {
		const p = this.pending.get(actionId);
		if (!p) return;
		clearTimeout(p.longTimer);
		clearTimeout(p.repeatDelay);
		clearInterval(p.repeatInterval);
		this.pending.delete(actionId);
	}

	cancelAll(): void {
		for (const id of [...this.pending.keys()]) this.cancel(id);
	}

	private startRepeat(p: Pending): void {
		const press = p.config.short;
		p.repeatDelay = setTimeout(() => {
			p.repeatInterval = setInterval(() => {
				this.sim
					.fire(press)
					.catch((err) =>
						streamDeck.logger.error(
							`${this.logName}: repeat failed: ${describePressAction(press)}`,
							err,
						),
					);
			}, TIMINGS.REPEAT_INTERVAL_MS);
		}, TIMINGS.REPEAT_INITIAL_DELAY_MS);
	}

	private async fire(
		action: KeyAction<T>,
		press: PressAction,
		confirm: boolean,
	): Promise<boolean> {
		const label = describePressAction(press);
		try {
			await this.sim.fire(press);
			streamDeck.logger.info(`${this.logName}: ${label}`);
			if (confirm) await action.showOk();
			return true;
		} catch (err) {
			streamDeck.logger.error(`${this.logName}: press failed: ${label}`, err);
			await action.showAlert();
			return false;
		}
	}
}
