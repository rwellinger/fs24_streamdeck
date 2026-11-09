/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import streamDeck from "@elgato/streamdeck";

import { TOLERANCE_FLOAT } from "../const";
import type { SimClient } from "../sim";
import { parseVarPath } from "../sim/path";
import { toFiniteNumber } from "./coerce";
import { trimString } from "./settings";

export type ConditionOperator = "eq" | "ne" | "gt" | "ge" | "lt" | "le";
export type ConditionScope = "both" | "on" | "off";
export type ConditionDirection = "on" | "off";

export type ConditionSettings = {
	conditionVar?: string;
	conditionOperator?: ConditionOperator;
	conditionValue?: string | number;
	conditionScope?: ConditionScope;
	hideConditionAlert?: boolean;
};

export interface Condition {
	path: string;
	operator: ConditionOperator;
	// Undefined when the PI value is empty or invalid — the press is then
	// blocked instead of silently ignoring a half-configured condition.
	expected: number | undefined;
	scope: ConditionScope;
	hideAlert: boolean;
}

const OPERATOR_SYMBOLS: Record<ConditionOperator, string> = {
	eq: "==",
	ne: "!=",
	gt: ">",
	ge: ">=",
	lt: "<",
	le: "<=",
};

export function parseCondition(s: ConditionSettings): Condition | undefined {
	const path = trimString(s.conditionVar);
	if (!path) return undefined;
	const operator = s.conditionOperator;
	const scope = s.conditionScope;
	return {
		path,
		operator: operator && Object.hasOwn(OPERATOR_SYMBOLS, operator) ? operator : "eq",
		expected: toFiniteNumber(s.conditionValue),
		scope: scope === "on" || scope === "off" ? scope : "both",
		hideAlert: s.hideConditionAlert === true,
	};
}

export function appliesTo(condition: Condition, direction: ConditionDirection): boolean {
	return condition.scope === "both" || condition.scope === direction;
}

export function compareValue(num: number, operator: ConditionOperator, expected: number): boolean {
	const equal = Math.abs(num - expected) < TOLERANCE_FLOAT;
	switch (operator) {
		case "eq":
			return equal;
		case "ne":
			return !equal;
		case "gt":
			return num > expected && !equal;
		case "ge":
			return num > expected || equal;
		case "lt":
			return num < expected && !equal;
		case "le":
			return num < expected || equal;
	}
}

/**
 * Returns true when the press must not be executed, after logging and showing
 * the alert. Reads the value at press time; any read failure blocks the press.
 * `hideAlert` only silences a regular "not met" — failures stay visible,
 * otherwise a broken condition would look like a normal lock.
 */
export async function pressBlocked(
	sim: SimClient,
	action: { showAlert(): Promise<void> },
	condition: Condition | undefined,
	direction: ConditionDirection,
	logTag: string,
): Promise<boolean> {
	if (!condition || !appliesTo(condition, direction)) return false;

	const { operator, expected } = condition;
	const rule = `${condition.path} ${OPERATOR_SYMBOLS[operator]} ${expected}`;
	try {
		if (expected === undefined) throw new Error("condition value is empty or invalid");
		const parsed = parseVarPath(condition.path);
		if (!parsed.ok) throw new Error(parsed.error);
		const value = await sim.read(parsed.path);
		if (compareValue(value, operator, expected)) return false;
		streamDeck.logger.info(
			`${logTag}: press blocked, condition ${rule} not met (value=${value})`,
		);
		if (condition.hideAlert) return true;
	} catch (err) {
		streamDeck.logger.warn(`${logTag}: press blocked, condition ${rule} failed`, err);
	}
	await action.showAlert();
	return true;
}
