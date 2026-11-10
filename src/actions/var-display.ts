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
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../sim";
import { toFiniteNumber } from "../util/coerce";
import { combineTitle } from "../util/error-tile";
import { formatSimValue } from "../util/format";
import { PressController, type PressSettings, parsePressSettings } from "../util/press";
import { normalizeFormat, resolveZeroSnap, trimString } from "../util/settings";
import { STATE_DIRTY, VarAction, type VarState } from "./base/var-action";

type VarDisplaySettings = JsonObject &
	PressSettings & {
		varPath?: string;
		label?: string;
		format?: string;
		unitScale?: string | number;
		precision?: string | number;
		snapZero?: boolean;
		zeroThreshold?: string | number;
	};

interface State extends VarState<VarDisplaySettings> {
	format: string;
	unitScale?: number;
	precision?: number;
	zeroSnap?: number;
	lastText?: string;
}

@action({ UUID: "com.robertw.fs24.var-display" })
export class VarDisplay extends VarAction<VarDisplaySettings, State> {
	private readonly press: PressController<VarDisplaySettings>;

	constructor(sim: SimClient) {
		super(sim, "var-display");
		this.press = new PressController(sim, "var-display");
		sim.on("offline", () => this.press.cancelAll());
	}

	override onWillDisappear(ev: WillDisappearEvent<VarDisplaySettings>): Promise<void> {
		this.press.cancel(ev.action.id);
		return super.onWillDisappear(ev);
	}

	/** Display-only unless a press action is set — then a press fires it. */
	override async onKeyDown(ev: KeyDownEvent<VarDisplaySettings>): Promise<void> {
		const config = parsePressSettings(ev.payload.settings ?? {});
		if (!config) return;
		if (!config.ok) {
			streamDeck.logger.warn(`var-display: ${config.error}`);
			await ev.action.showAlert();
			return;
		}
		await this.press.down(ev.action, config.path);
	}

	override async onKeyUp(ev: KeyUpEvent<VarDisplaySettings>): Promise<void> {
		await this.press.up(ev.action);
	}

	protected override createState(a: KeyAction<VarDisplaySettings>, s: VarDisplaySettings): State {
		const state: State = {
			action: a,
			pathText: "",
			label: "",
			value: undefined,
			rendered: STATE_DIRTY,
			format: "",
		};
		this.applySettings(state, s);
		return state;
	}

	protected override applySettings(state: State, s: VarDisplaySettings): void {
		state.pathText = trimString(s.varPath);
		state.label = trimString(s.label);
		state.format = normalizeFormat(s.format);
		state.unitScale = toFiniteNumber(s.unitScale);
		state.precision = toFiniteNumber(s.precision);
		state.zeroSnap = resolveZeroSnap(s.snapZero, s.zeroThreshold);
		state.lastText = undefined;
	}

	protected override async render(state: State, value: number): Promise<void> {
		const text = combineTitle(
			state.label,
			formatSimValue(value, {
				format: state.format,
				unitScale: state.unitScale,
				precision: state.precision,
				zeroSnap: state.zeroSnap,
			}),
		);
		if (text === state.lastText && state.rendered !== STATE_DIRTY) return;
		state.lastText = text;
		state.rendered = 0;
		await state.action.setTitle(text);
	}
}
