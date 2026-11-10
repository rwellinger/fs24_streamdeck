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
import type { VarPath } from "../sim/path";
import { clearOffline, setNotFound, setOffline } from "../util/error-tile";
import { PressController, type PressSettings, parsePressSettings } from "../util/press";
import { svgToDataUrl } from "../util/selector-image";
import { trimString } from "../util/settings";
import {
	parseRules,
	parseTemplate,
	renderTemplate,
	type StateRule,
	selectRule,
	type Template,
	templateVars,
} from "../util/state-rules";
import { renderStateTileSvg } from "../util/state-tile-svg";

type VarStateSettings = JsonObject &
	PressSettings & {
		title?: string;
		text?: string;
		states?: string;
	};

interface State {
	action: KeyAction<VarStateSettings>;
	title: string;
	rules: StateRule[];
	defaultText?: Template;
	/** Config error — shown as alert on press, tile shows "?". */
	error?: string;
	values: Map<string, number | null>;
	unsubscribers: (() => void)[];
	lastSvg?: string;
	renderChain?: Promise<void>;
}

/**
 * Multi-state tile: an ordered rule list maps RPN conditions over any number
 * of A:/L: vars to a style and a text with live values. Replaces AAO
 * multigauges (mode annunciators, softkey highlights, mode-dependent labels).
 */
@action({ UUID: "com.robertw.fs24.var-state" })
export class VarState extends SingletonAction<VarStateSettings> {
	private readonly states = new Map<string, State>();
	private readonly press: PressController<VarStateSettings>;

	constructor(private readonly sim: SimClient) {
		super();
		this.press = new PressController(sim, "var-state");
		sim.on("offline", () => this.onSimOffline());
		sim.on("online", () => this.onSimOnline());
		sim.on("aircraftChanged", () => {
			for (const s of this.states.values()) {
				s.lastSvg = undefined;
				this.redraw(s);
			}
		});
	}

	override async onWillAppear(ev: WillAppearEvent<VarStateSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const state: State = {
			action: ev.action,
			title: "",
			rules: [],
			values: new Map(),
			unsubscribers: [],
		};
		this.states.set(ev.action.id, state);
		await (this.sim.isOffline() ? setOffline(ev.action) : clearOffline(ev.action));
		this.configure(state, ev.payload.settings ?? {});
	}

	override onWillDisappear(ev: WillDisappearEvent<VarStateSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) this.unsubscribe(state);
		this.press.cancel(ev.action.id);
		this.states.delete(ev.action.id);
		return Promise.resolve();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<VarStateSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state) this.configure(state, ev.payload.settings ?? {});
		return Promise.resolve();
	}

	override async onKeyDown(ev: KeyDownEvent<VarStateSettings>): Promise<void> {
		const state = this.states.get(ev.action.id);
		if (state?.error) {
			streamDeck.logger.warn(`var-state: ${state.error}`);
			await ev.action.showAlert();
			return;
		}
		const config = parsePressSettings(ev.payload.settings ?? {});
		if (!config) return;
		if (!config.ok) {
			streamDeck.logger.warn(`var-state: ${config.error}`);
			await ev.action.showAlert();
			return;
		}
		await this.press.down(ev.action, config.path);
	}

	override async onKeyUp(ev: KeyUpEvent<VarStateSettings>): Promise<void> {
		await this.press.up(ev.action);
	}

	private configure(state: State, s: VarStateSettings): void {
		this.unsubscribe(state);
		state.title = trimString(s.title);
		state.rules = [];
		state.defaultText = undefined;
		state.error = undefined;
		state.values = new Map();
		state.lastSvg = undefined;

		const rules = parseRules(typeof s.states === "string" ? s.states : "");
		const textRaw = trimString(s.text);
		const text = textRaw ? parseTemplate(textRaw) : undefined;
		if (!rules.ok || (text && !text.ok)) {
			state.error = !rules.ok
				? `states: ${rules.error}`
				: `text: ${text && !text.ok ? text.error : ""}`;
			streamDeck.logger.warn(`var-state: ${state.error}`);
			this.redraw(state);
			return;
		}
		state.rules = rules.path;
		state.defaultText = text?.ok ? text.path : undefined;

		const vars = new Map<string, VarPath>();
		const add = (list: VarPath[]) => {
			for (const v of list) vars.set(v.key, v);
		};
		for (const r of state.rules) {
			add(r.condition?.vars ?? []);
			add(templateVars(r.text));
		}
		add(templateVars(state.defaultText));

		for (const path of vars.values()) {
			state.unsubscribers.push(
				this.sim.subscribe(path, (value) => {
					state.values.set(path.key, value);
					this.redraw(state);
				}),
			);
		}
		this.redraw(state);
	}

	private unsubscribe(state: State): void {
		for (const u of state.unsubscribers) u();
		state.unsubscribers = [];
	}

	private redraw(state: State): void {
		if (this.sim.isOffline()) return;
		const previous = state.renderChain ?? Promise.resolve();
		state.renderChain = previous
			.catch(() => {})
			.then(() => this.render(state))
			.catch((err) => {
				streamDeck.logger.warn("var-state: render failed", err);
			});
	}

	private async render(state: State): Promise<void> {
		if (state.error || [...state.values.values()].includes(null)) {
			state.lastSvg = undefined;
			await state.action.setImage(undefined);
			await setNotFound(state.action, state.title);
			return;
		}
		const lookup = (key: string) => state.values.get(key);
		const rule = selectRule(state.rules, lookup);
		if (rule === undefined) return;
		const template = rule?.text ?? state.defaultText;
		const text = template ? renderTemplate(template, lookup) : "";
		if (text === undefined) return;
		const svg = renderStateTileSvg({ style: rule?.style ?? "off", title: state.title, text });
		if (svg === state.lastSvg) return;
		if (state.lastSvg === undefined) await state.action.setTitle("");
		state.lastSvg = svg;
		await state.action.setImage(svgToDataUrl(svg));
	}

	private onSimOffline(): void {
		this.press.cancelAll();
		for (const s of this.states.values()) {
			s.lastSvg = undefined;
			setOffline(s.action).catch((err) =>
				streamDeck.logger.warn("var-state: setOffline failed", err),
			);
		}
	}

	private onSimOnline(): void {
		for (const s of this.states.values()) {
			s.lastSvg = undefined;
			clearOffline(s.action)
				.then(() => this.redraw(s))
				.catch((err) => streamDeck.logger.warn("var-state: clearOffline failed", err));
		}
	}
}
