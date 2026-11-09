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

import { TIMINGS, TOLERANCE_FLOAT } from "../const";
import type { SimClient } from "../sim";
import { parseEventName, parseEventSpec } from "../sim/path";
import { toFiniteNumber } from "../util/coerce";
import { type ConditionSettings, parseCondition, pressBlocked } from "../util/condition";
import { type EnumMap, parseEnumMap } from "../util/enum";
import { clearTile } from "../util/error-tile";
import { trimString } from "../util/settings";
import {
	renderSwitchStateSvg,
	type SwitchBodyColor,
	type SwitchLabelPosition,
	type SwitchOrientation,
	type SwitchTilePosition,
	svgToDataUrl,
} from "../util/switch-image";
import { STATE_DIRTY, VarAction, type VarState } from "./base/var-action";

/**
 * - write:        write the target value to the var
 * - event-set:    fire `EVENT target` (e.g. MAGNETO1_SET 3)
 * - event-incdec: fire the up / down event (e.g. MAGNETO_INCR / MAGNETO_DECR)
 */
type TriggerMode = "write" | "event-set" | "event-incdec";

type VarSwitchSettings = JsonObject &
	ConditionSettings & {
		varPath?: string;
		minValue?: string | number;
		maxValue?: string | number;
		step?: string | number;
		triggerMode?: TriggerMode;
		eventSet?: string;
		eventUp?: string;
		eventDown?: string;
		labels?: string;
		hideShortConfirmation?: boolean;
		hideEndstopAlert?: boolean;
		staticLabel?: string;
		staticLabelPosition?: SwitchLabelPosition;
		orientation?: SwitchOrientation;
		invertDirection?: boolean;
		bodyColor?: SwitchBodyColor;
	};

const STATE_MIN = 0;
const STATE_MID = 1;
const STATE_MAX = 2;

interface State extends VarState<VarSwitchSettings> {
	minValue: number;
	maxValue: number;
	step: number;
	labels: EnumMap;
	staticLabel: string;
	staticLabelPosition: SwitchLabelPosition;
	orientation: SwitchOrientation;
	invertDirection: boolean;
	bodyColor: SwitchBodyColor;
	lastTitle?: string;
	longPressTimer?: NodeJS.Timeout;
	longPressFired: boolean;
}

/**
 * N-position switch on one var. Short press steps toward Max, long press
 * (≥ LONG_PRESS_THRESHOLD_MS) toward Min; stops at the ends.
 */
@action({ UUID: "com.robertw.fs24.var-switch" })
export class VarSwitch extends VarAction<VarSwitchSettings, State> {
	constructor(sim: SimClient) {
		super(sim, "var-switch");
	}

	protected override createState(a: KeyAction<VarSwitchSettings>, s: VarSwitchSettings): State {
		const state: State = {
			action: a,
			pathText: "",
			label: "",
			value: undefined,
			rendered: STATE_DIRTY,
			minValue: -1,
			maxValue: 1,
			step: 1,
			labels: parseEnumMap(""),
			staticLabel: "",
			staticLabelPosition: "top",
			orientation: "vertical",
			invertDirection: false,
			bodyColor: "gray",
			longPressFired: false,
		};
		this.applySettings(state, s);
		return state;
	}

	protected override applySettings(state: State, s: VarSwitchSettings): void {
		state.pathText = trimString(s.varPath);
		state.minValue = toFiniteNumber(s.minValue) ?? -1;
		state.maxValue = toFiniteNumber(s.maxValue) ?? 1;
		const step = toFiniteNumber(s.step) ?? 1;
		state.step = step > 0 ? step : 1;
		state.labels = parseEnumMap(typeof s.labels === "string" ? s.labels : "");
		state.staticLabel = trimString(s.staticLabel);
		state.staticLabelPosition = s.staticLabelPosition === "bottom" ? "bottom" : "top";
		state.orientation = s.orientation === "horizontal" ? "horizontal" : "vertical";
		state.invertDirection = s.invertDirection === true;
		state.bodyColor = s.bodyColor === "red" || s.bodyColor === "green" ? s.bodyColor : "gray";
		state.lastTitle = undefined;
	}

	override onWillDisappear(ev: WillDisappearEvent<VarSwitchSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) this.cancelLongPress(state);
		return super.onWillDisappear(ev);
	}

	override async onKeyDown(ev: KeyDownEvent<VarSwitchSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (!state?.path) {
			streamDeck.logger.warn("var-switch: var is empty or invalid");
			await ev.action.showAlert();
			return;
		}
		const settings = ev.payload.settings ?? {};
		this.cancelLongPress(state);
		state.longPressFired = false;
		state.longPressTimer = setTimeout(() => {
			state.longPressFired = true;
			this.step(state, settings, "long").catch((err) =>
				streamDeck.logger.error("var-switch: long press failed", err),
			);
		}, TIMINGS.LONG_PRESS_THRESHOLD_MS);
	}

	override async onKeyUp(ev: KeyUpEvent<VarSwitchSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (!state?.path) return;
		this.cancelLongPress(state);
		if (state.longPressFired) return;
		await this.step(state, ev.payload.settings ?? {}, "short");
	}

	private async step(state: State, s: VarSwitchSettings, kind: "short" | "long"): Promise<void> {
		try {
			const path = state.path;
			if (!path) throw new Error("no var");
			const current =
				typeof state.value === "number" ? state.value : await this.sim.read(path);
			const up = (kind === "short") !== state.invertDirection;
			const target = Math.max(
				state.minValue,
				Math.min(state.maxValue, current + (up ? state.step : -state.step)),
			);
			if (Math.abs(target - current) < TOLERANCE_FLOAT) {
				streamDeck.logger.info(`var-switch: endstop (value=${current})`);
				if (s.hideEndstopAlert !== true) await state.action.showAlert();
				return;
			}
			if (
				await pressBlocked(
					this.sim,
					state.action,
					parseCondition(s),
					up ? "on" : "off",
					this.logName,
				)
			) {
				return;
			}

			const mode = s.triggerMode;
			if (mode === "event-set") {
				const name = parseEventName(trimString(s.eventSet));
				if (!name.ok) throw new Error(`event: ${name.error}`);
				await this.sim.transmitEvent(name.path, Math.round(target));
			} else if (mode === "event-incdec") {
				const spec = parseEventSpec(trimString(up ? s.eventUp : s.eventDown));
				if (!spec.ok) throw new Error(`event: ${spec.error}`);
				await this.sim.transmitEvent(spec.path.name, spec.path.value);
			} else {
				await this.sim.write(path, target);
				state.value = target;
				this.update(state);
			}
			streamDeck.logger.info(
				`var-switch: ${kind} ${current} → ${target} (${mode ?? "write"})`,
			);
			if (kind === "short" && s.hideShortConfirmation !== true) await state.action.showOk();
		} catch (err) {
			streamDeck.logger.error(`var-switch: ${kind} step failed`, err);
			await state.action.showAlert();
		}
	}

	protected override async render(state: State, value: number): Promise<void> {
		const target = this.toIndex(state, value);
		const title = this.title(state, value);
		if (target === state.rendered) {
			if (title !== undefined && title !== state.lastTitle) {
				state.lastTitle = title;
				await state.action.setTitle(title);
			}
			return;
		}
		const invert = state.invertDirection;
		const visual = invert && target !== STATE_MID ? STATE_MAX - target : target;
		const position: SwitchTilePosition =
			visual === STATE_MIN ? "min" : visual === STATE_MAX ? "max" : "mid";
		const custom =
			state.staticLabel.length > 0 ||
			state.orientation === "horizontal" ||
			invert ||
			state.bodyColor !== "gray";
		if (state.rendered === STATE_DIRTY) await clearTile(state.action);
		await state.action.setState(target);
		await state.action.setImage(
			custom
				? svgToDataUrl(
						renderSwitchStateSvg(
							position,
							state.orientation,
							state.staticLabel,
							state.staticLabelPosition,
							state.bodyColor,
						),
					)
				: undefined,
		);
		state.lastTitle = title;
		await state.action.setTitle(title);
		state.rendered = target;
	}

	private toIndex(state: State, num: number): number {
		const half = state.step / 2;
		if (num <= state.minValue + half) return STATE_MIN;
		if (num >= state.maxValue - half) return STATE_MAX;
		return STATE_MID;
	}

	/** Only overrides the title when the user configured a labels map. */
	private title(state: State, num: number): string | undefined {
		const { labels } = state;
		if (!labels.enumValid || labels.enumLut.size === 0) return undefined;
		const key = Math.round(num);
		if (Math.abs(num - key) < TOLERANCE_FLOAT) {
			const label = labels.enumLut.get(key);
			if (label !== undefined) return label;
		}
		return Number.isInteger(num) ? String(num) : num.toFixed(2);
	}

	private cancelLongPress(state: State): void {
		if (state.longPressTimer) {
			clearTimeout(state.longPressTimer);
			state.longPressTimer = undefined;
		}
	}
}
