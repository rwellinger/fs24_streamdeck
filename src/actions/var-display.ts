/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { action, type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SimClient } from "../sim";
import { toFiniteNumber } from "../util/coerce";
import { combineTitle } from "../util/error-tile";
import { formatSimValue } from "../util/format";
import { normalizeFormat, resolveZeroSnap, trimString } from "../util/settings";
import { STATE_DIRTY, VarAction, type VarState } from "./base/var-action";

type VarDisplaySettings = JsonObject & {
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
	constructor(sim: SimClient) {
		super(sim, "var-display");
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
