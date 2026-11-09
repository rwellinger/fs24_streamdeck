/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck, {
	type DidReceiveSettingsEvent,
	type KeyAction,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../../sim";
import { parseVarPath, type VarPath } from "../../sim/path";
import { clearOffline, setNotFound, setOffline } from "../../util/error-tile";

export const STATE_DIRTY = -1;

/** Per-key state shared by every action that renders one subscribed var. */
export interface VarState<TSettings extends JsonObject> {
	action: KeyAction<TSettings>;
	/** Raw path text from the settings — compared to detect changes. */
	pathText: string;
	path?: VarPath;
	label: string;
	/** `undefined` = no value yet, `null` = var unknown. */
	value: number | null | undefined;
	unsubscribe?: () => void;
	/** Last rendered visual state; STATE_DIRTY forces the next render. */
	rendered: number;
	renderChain?: Promise<void>;
}

/**
 * Subscribes the key's read var, keeps `state.value` current and calls
 * `render()` on every change. Subscriptions survive SimConnect reconnects (the
 * client re-registers them), so offline/online only swaps the tile.
 */
export abstract class VarAction<
	TSettings extends JsonObject,
	TState extends VarState<TSettings>,
> extends SingletonAction<TSettings> {
	protected readonly states = new Map<string, TState>();

	constructor(
		protected readonly sim: SimClient,
		protected readonly logName: string,
	) {
		super();
		this.sim.on("offline", () => this.onSimOffline());
		this.sim.on("online", () => this.onSimOnline());
		this.sim.on("aircraftChanged", () => {
			for (const state of this.states.values()) {
				state.rendered = STATE_DIRTY;
				this.update(state);
			}
		});
	}

	protected abstract createState(action: KeyAction<TSettings>, settings: TSettings): TState;

	/** Applies new settings; returns the (possibly changed) read path text. */
	protected abstract applySettings(state: TState, settings: TSettings): void;

	/** Draws `state.value` (a number). Only called with a resolved value. */
	protected abstract render(state: TState, value: number): Promise<void>;

	override async onWillAppear(ev: WillAppearEvent<TSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const state = this.createState(ev.action, ev.payload.settings ?? ({} as TSettings));
		this.states.set(ev.action.id, state);
		if (this.sim.isOffline()) await setOffline(ev.action);
		this.subscribe(state);
	}

	override onWillDisappear(ev: WillDisappearEvent<TSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) {
			state.unsubscribe?.();
			this.states.delete(ev.action.id);
		}
		return Promise.resolve();
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (!state) return;
		const before = state.pathText;
		this.applySettings(state, ev.payload.settings ?? ({} as TSettings));
		state.rendered = STATE_DIRTY;
		if (state.pathText !== before) {
			state.unsubscribe?.();
			state.unsubscribe = undefined;
			state.value = undefined;
			this.subscribe(state);
			return;
		}
		this.update(state);
	}

	protected subscribe(state: TState): void {
		state.path = undefined;
		if (!state.pathText) {
			state.action
				.setTitle(state.label)
				.catch((err) => streamDeck.logger.warn(`${this.logName}: setTitle failed`, err));
			return;
		}
		const parsed = parseVarPath(state.pathText);
		if (!parsed.ok) {
			streamDeck.logger.warn(
				`${this.logName}: invalid path "${state.pathText}": ${parsed.error}`,
			);
			state.value = null;
			this.update(state);
			return;
		}
		state.path = parsed.path;
		state.unsubscribe = this.sim.subscribe(parsed.path, (value) => {
			state.value = value;
			this.update(state);
		});
	}

	/** Renders the current value, serialised per key. */
	protected update(state: TState): void {
		if (this.sim.isOffline()) return;
		const value = state.value;
		const previous = state.renderChain ?? Promise.resolve();
		state.renderChain = previous
			.catch(() => {})
			.then(async () => {
				if (value === undefined) return;
				if (value === null) {
					state.rendered = STATE_DIRTY;
					await setNotFound(state.action, state.label);
					return;
				}
				await this.render(state, value);
			})
			.catch((err) => {
				streamDeck.logger.warn(`${this.logName}: render failed`, err);
			});
	}

	private onSimOffline(): void {
		for (const state of this.states.values()) {
			state.rendered = STATE_DIRTY;
			setOffline(state.action).catch((err) =>
				streamDeck.logger.warn(`${this.logName}: setOffline failed`, err),
			);
		}
	}

	private onSimOnline(): void {
		for (const state of this.states.values()) {
			state.rendered = STATE_DIRTY;
			clearOffline(state.action)
				.then(() => this.update(state))
				.catch((err) =>
					streamDeck.logger.warn(`${this.logName}: clearOffline failed`, err),
				);
		}
	}
}
