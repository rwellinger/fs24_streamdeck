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
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { TOLERANCE_FLOAT } from "../const";
import type { SimClient } from "../sim";
import { describePressAction, parsePressAction, parseVarPath } from "../sim/path";
import { toFiniteNumber } from "../util/coerce";
import { type ConditionSettings, parseCondition, pressBlocked } from "../util/condition";
import { clearTile } from "../util/error-tile";
import { trimString } from "../util/settings";
import {
	renderToggleStateSvg,
	svgToDataUrl,
	type ToggleBodyColor,
	type ToggleLabelPosition,
	type ToggleOrientation,
} from "../util/toggle-image";
import { STATE_DIRTY, VarAction, type VarState } from "./base/var-action";

type TriggerMode = "write" | "event" | "event-on-off";

type VarToggleSettings = JsonObject &
	ConditionSettings & {
		varPath?: string;
		writePath?: string;
		valueOff?: string | number;
		valueOn?: string | number;
		triggerMode?: TriggerMode;
		event?: string;
		eventOn?: string;
		eventOff?: string;
		strictOnMatch?: boolean;
		holdMode?: boolean;
		staticLabel?: string;
		staticLabelPosition?: ToggleLabelPosition;
		orientation?: ToggleOrientation;
		bodyColor?: ToggleBodyColor;
		invert?: boolean;
	};

const STATE_OFF = 0;
const STATE_ON = 1;

interface State extends VarState<VarToggleSettings> {
	valueOff: number;
	valueOn: number;
	strictOnMatch: boolean;
	staticLabel: string;
	staticLabelPosition: ToggleLabelPosition;
	orientation: ToggleOrientation;
	bodyColor: ToggleBodyColor;
	invert: boolean;
	inflight: boolean;
	holdBlocked: boolean;
}

@action({ UUID: "com.robertw.fs24.var-toggle" })
export class VarToggle extends VarAction<VarToggleSettings, State> {
	constructor(sim: SimClient) {
		super(sim, "var-toggle");
	}

	protected override createState(a: KeyAction<VarToggleSettings>, s: VarToggleSettings): State {
		const state: State = {
			action: a,
			pathText: "",
			label: "",
			value: undefined,
			rendered: STATE_DIRTY,
			valueOff: 0,
			valueOn: 1,
			strictOnMatch: false,
			staticLabel: "",
			staticLabelPosition: "top",
			orientation: "vertical",
			bodyColor: "gray",
			invert: false,
			inflight: false,
			holdBlocked: false,
		};
		this.applySettings(state, s);
		return state;
	}

	protected override applySettings(state: State, s: VarToggleSettings): void {
		state.pathText = trimString(s.varPath);
		state.valueOff = toFiniteNumber(s.valueOff) ?? 0;
		state.valueOn = toFiniteNumber(s.valueOn) ?? 1;
		state.strictOnMatch = s.strictOnMatch === true;
		state.staticLabel = trimString(s.staticLabel);
		state.staticLabelPosition = s.staticLabelPosition === "bottom" ? "bottom" : "top";
		state.orientation = s.orientation === "horizontal" ? "horizontal" : "vertical";
		state.bodyColor = parseBodyColor(s.bodyColor);
		state.invert = s.invert === true;
	}

	override async onKeyDown(ev: KeyDownEvent<VarToggleSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		const s = ev.payload.settings ?? {};
		if (!state || !state.path) {
			streamDeck.logger.warn("var-toggle: state var is empty or invalid");
			await ev.action.showAlert();
			return;
		}
		const condition = parseCondition(s);

		if (s.holdMode === true) {
			state.holdBlocked = await pressBlocked(
				this.sim,
				ev.action,
				condition,
				"on",
				this.logName,
			);
			if (!state.holdBlocked) await this.writeTarget(state, s, state.valueOn);
			return;
		}

		if (state.inflight) {
			streamDeck.logger.info(
				"var-toggle: ignoring keyDown while previous toggle is in flight",
			);
			await ev.action.showAlert();
			return;
		}
		state.inflight = true;
		try {
			const isOn = (await this.currentIndex(state)) === STATE_ON;
			if (
				await pressBlocked(
					this.sim,
					ev.action,
					condition,
					isOn ? "off" : "on",
					this.logName,
				)
			) {
				return;
			}
			const mode: TriggerMode =
				s.triggerMode === "event" || s.triggerMode === "event-on-off"
					? s.triggerMode
					: "write";
			if (mode === "write") {
				await this.writeTarget(state, s, isOn ? state.valueOff : state.valueOn);
				return;
			}
			const raw = mode === "event" ? s.event : isOn ? s.eventOff : s.eventOn;
			const press = parsePressAction(trimString(raw));
			if (!press.ok) throw new Error(`event: ${press.error}`);
			await this.sim.fire(press.path);
			streamDeck.logger.info(`var-toggle: ${describePressAction(press.path)}`);
		} catch (err) {
			streamDeck.logger.error("var-toggle: press failed", err);
			await ev.action.showAlert();
		} finally {
			state.inflight = false;
		}
	}

	override async onKeyUp(ev: KeyUpEvent<VarToggleSettings>): Promise<void> {
		const s = ev.payload.settings ?? {};
		const state = this.states.get(ev.action.id);
		if (s.holdMode !== true || !state?.path) return;
		if (state.holdBlocked) {
			state.holdBlocked = false;
			return;
		}
		await this.writeTarget(state, s, state.valueOff);
	}

	protected override async render(state: State, value: number): Promise<void> {
		const target = this.toIndex(state, value);
		if (target === state.rendered) return;
		const custom =
			state.staticLabel.length > 0 ||
			state.orientation === "vertical" ||
			state.bodyColor !== "gray" ||
			state.invert;
		const visualOn = (target === STATE_ON) !== state.invert;
		if (state.rendered === STATE_DIRTY) await clearTile(state.action);
		await state.action.setState(target);
		await state.action.setImage(
			custom
				? svgToDataUrl(
						renderToggleStateSvg(
							visualOn ? "on" : "off",
							state.staticLabel,
							state.staticLabelPosition,
							state.orientation,
							state.bodyColor,
						),
					)
				: undefined,
		);
		state.rendered = target;
	}

	/** Writes `value` to the write var (or the state var) and shows it at once. */
	private async writeTarget(state: State, s: VarToggleSettings, value: number): Promise<void> {
		try {
			const writeText = trimString(s.writePath);
			const parsed = writeText ? parseVarPath(writeText) : undefined;
			if (parsed && !parsed.ok) throw new Error(`write var: ${parsed.error}`);
			const path = parsed?.ok ? parsed.path : state.path;
			if (!path) throw new Error("no var to write");
			await this.sim.write(path, value);
			if (path === state.path) {
				state.value = value;
				this.update(state);
			}
		} catch (err) {
			streamDeck.logger.error("var-toggle: write failed", err);
			await state.action.showAlert();
		}
	}

	private async currentIndex(state: State): Promise<number> {
		const value =
			typeof state.value === "number"
				? state.value
				: state.path
					? await this.sim.read(state.path)
					: 0;
		return this.toIndex(state, value);
	}

	private toIndex(state: State, num: number): number {
		if (state.strictOnMatch) {
			return Math.abs(num - state.valueOn) < TOLERANCE_FLOAT ? STATE_ON : STATE_OFF;
		}
		if (state.valueOff === 0 && state.valueOn === 1) return num >= 0.5 ? STATE_ON : STATE_OFF;
		return Math.abs(num - state.valueOn) < Math.abs(num - state.valueOff)
			? STATE_ON
			: STATE_OFF;
	}
}

function parseBodyColor(v: unknown): ToggleBodyColor {
	return v === "red" || v === "green" || v === "white" || v === "blue" ? v : "gray";
}
