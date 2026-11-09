/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { action, type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { TOLERANCE_FLOAT } from "../const";
import type { SimClient } from "../sim";
import { toFiniteNumber } from "../util/coerce";
import { type LampColor, type LampLabelPosition, renderLampDataUrl } from "../util/lamp-svg";
import { trimString } from "../util/settings";
import { STATE_DIRTY, VarAction, type VarState } from "./base/var-action";

type VarLampSettings = JsonObject & {
	varPath?: string;
	valueOn?: string | number;
	color?: LampColor;
	label?: string;
	labelPosition?: LampLabelPosition;
};

interface State extends VarState<VarLampSettings> {
	valueOn: number;
	color: LampColor;
	labelPosition: LampLabelPosition;
}

const LAMP_COLORS: readonly LampColor[] = ["green", "blue", "yellow", "orange", "red"];

@action({ UUID: "com.robertw.fs24.var-lamp" })
export class VarLamp extends VarAction<VarLampSettings, State> {
	constructor(sim: SimClient) {
		super(sim, "var-lamp");
	}

	protected override createState(a: KeyAction<VarLampSettings>, s: VarLampSettings): State {
		const state: State = {
			action: a,
			pathText: "",
			label: "",
			value: undefined,
			rendered: STATE_DIRTY,
			valueOn: 1,
			color: "green",
			labelPosition: "top",
		};
		this.applySettings(state, s);
		return state;
	}

	protected override applySettings(state: State, s: VarLampSettings): void {
		state.pathText = trimString(s.varPath);
		state.label = trimString(s.label);
		state.valueOn = toFiniteNumber(s.valueOn) ?? 1;
		state.color = s.color && LAMP_COLORS.includes(s.color) ? s.color : "green";
		state.labelPosition = s.labelPosition === "bottom" ? "bottom" : "top";
	}

	protected override async render(state: State, value: number): Promise<void> {
		const lit = Math.abs(value - state.valueOn) < TOLERANCE_FLOAT ? 1 : 0;
		if (lit === state.rendered) return;
		if (state.rendered === STATE_DIRTY) await state.action.setTitle("");
		await state.action.setImage(
			renderLampDataUrl({
				color: state.color,
				isLit: lit === 1,
				label: state.label || undefined,
				labelPosition: state.labelPosition,
			}),
		);
		state.rendered = lit;
	}
}
