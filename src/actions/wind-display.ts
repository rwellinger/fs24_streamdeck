/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../sim";
import { parseVarPath, type VarPath } from "../sim/path";
import { clearOffline, setOffline } from "../util/error-tile";
import { PressController, type PressSettings, parsePressSettings } from "../util/press";
import { trimStringOr } from "../util/settings";
import { renderWindDataUrl } from "../util/wind-svg";

type WindDisplaySettings = JsonObject &
	PressSettings & {
		label?: string;
		arrowConvention?: "from" | "to";
		headingUp?: boolean;
		showDirection?: boolean;
	};

type Slot = "dir" | "speed" | "oat" | "heading";

const VARS: Record<Slot, VarPath> = {
	dir: mustParse("A:AMBIENT WIND DIRECTION, Degrees"),
	speed: mustParse("A:AMBIENT WIND VELOCITY, Knots"),
	oat: mustParse("A:AMBIENT TEMPERATURE, Celsius"),
	heading: mustParse("A:PLANE HEADING DEGREES TRUE, Degrees"),
};

interface State {
	action: KeyAction<WindDisplaySettings>;
	settings: WindDisplaySettings;
	values: Partial<Record<Slot, number>>;
	unsubscribers: (() => void)[];
	lastUrl?: string;
}

@action({ UUID: "com.robertw.fs24.wind-display" })
export class WindDisplay extends SingletonAction<WindDisplaySettings> {
	private readonly states = new Map<string, State>();
	private readonly press: PressController<WindDisplaySettings>;

	constructor(private readonly sim: SimClient) {
		super();
		this.press = new PressController(sim, "wind-display");
		sim.on("offline", () => this.onSimOffline());
		sim.on("online", () => this.onSimOnline());
	}

	override async onWillAppear(ev: WillAppearEvent<WindDisplaySettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const state: State = {
			action: ev.action,
			settings: ev.payload.settings ?? {},
			values: {},
			unsubscribers: [],
		};
		this.states.set(ev.action.id, state);
		await (this.sim.isOffline() ? setOffline(ev.action) : clearOffline(ev.action));
		for (const slot of Object.keys(VARS) as Slot[]) {
			state.unsubscribers.push(
				this.sim.subscribe(VARS[slot], (v) => {
					state.values[slot] = v ?? undefined;
					this.render(state);
				}),
			);
		}
		this.render(state);
	}

	override onWillDisappear(ev: WillDisappearEvent<WindDisplaySettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) for (const u of state.unsubscribers) u();
		this.press.cancel(ev.action.id);
		this.states.delete(ev.action.id);
		return Promise.resolve();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<WindDisplaySettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) {
			state.settings = ev.payload.settings ?? {};
			this.render(state);
		}
		return Promise.resolve();
	}

	override async onKeyDown(ev: KeyDownEvent<WindDisplaySettings>): Promise<void> {
		const config = parsePressSettings(ev.payload.settings ?? {});
		if (!config) return;
		if (!config.ok) {
			streamDeck.logger.warn(`wind-display: ${config.error}`);
			await ev.action.showAlert();
			return;
		}
		await this.press.down(ev.action, config.path);
	}

	override async onKeyUp(ev: KeyUpEvent<WindDisplaySettings>): Promise<void> {
		await this.press.up(ev.action);
	}

	private render(state: State): void {
		if (this.sim.isOffline()) return;
		const s = state.settings;
		const url = renderWindDataUrl({
			label: trimStringOr(s.label, "WIND"),
			directionDeg: state.values.dir,
			speed: state.values.speed,
			oat: state.values.oat,
			arrowConvention: s.arrowConvention === "from" ? "from" : "to",
			rotationOffsetDeg: s.headingUp === true ? (state.values.heading ?? 0) : 0,
			showDirection: s.showDirection === true,
		});
		if (url === state.lastUrl) return;
		state.lastUrl = url;
		state.action
			.setImage(url)
			.catch((err) => streamDeck.logger.warn("wind-display: setImage failed", err));
	}

	private onSimOffline(): void {
		this.press.cancelAll();
		for (const state of this.states.values()) {
			state.lastUrl = undefined;
			setOffline(state.action).catch((err) =>
				streamDeck.logger.warn("wind-display: setOffline failed", err),
			);
		}
	}

	private onSimOnline(): void {
		for (const state of this.states.values()) {
			clearOffline(state.action)
				.then(() => this.render(state))
				.catch((err) => streamDeck.logger.warn("wind-display: clearOffline failed", err));
		}
	}
}

function mustParse(text: string): VarPath {
	const p = parseVarPath(text);
	if (!p.ok) throw new Error(`wind-display: ${p.error}`);
	return p.path;
}
