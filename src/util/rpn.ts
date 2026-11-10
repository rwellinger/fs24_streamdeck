/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { type ParseResult, parseVarPath, type VarPath } from "../sim/path";

/*
 * Plugin-side evaluator for read-only MSFS calculator (RPN) expressions, e.g.
 * `(L:MFD1_Mode) 0 !=` or `(A:SIM ON GROUND, Bool) 0 == (L:X) 1 == and`.
 * The referenced vars are subscribed over SimConnect and the expression is
 * re-evaluated locally on every change — the in-sim bridge could evaluate RPN
 * too, but only by polling, one serialised round trip per expression.
 *
 * Deliberately a subset: unknown tokens and writes (`>L:`) are compile errors
 * so a misconfigured key shows an alert instead of a wrong state.
 */

type Op =
	| { t: "num"; v: number }
	| { t: "var"; key: string }
	| { t: "fn"; name: string }
	| { t: "store"; reg: number; pop: boolean }
	| { t: "load"; reg: number }
	| { t: "if"; yes: Op[]; no?: Op[] };

export interface RpnProgram {
	source: string;
	/** Distinct vars the expression reads, in first-use order. */
	vars: VarPath[];
	ops: Op[];
}

export type VarLookup = (key: string) => number | null | undefined;

const BINARY: Record<string, (a: number, b: number) => number> = {
	"+": (a, b) => a + b,
	"-": (a, b) => a - b,
	"*": (a, b) => a * b,
	"/": (a, b) => a / b,
	"%": (a, b) => a % b,
	pow: (a, b) => a ** b,
	min: Math.min,
	max: Math.max,
	"==": (a, b) => bool(a === b),
	"!=": (a, b) => bool(a !== b),
	">": (a, b) => bool(a > b),
	"<": (a, b) => bool(a < b),
	">=": (a, b) => bool(a >= b),
	"<=": (a, b) => bool(a <= b),
	and: (a, b) => bool(a !== 0 && b !== 0),
	"&&": (a, b) => bool(a !== 0 && b !== 0),
	or: (a, b) => bool(a !== 0 || b !== 0),
	"||": (a, b) => bool(a !== 0 || b !== 0),
	"&": (a, b) => a & b,
};

const UNARY: Record<string, (a: number) => number> = {
	"!": (a) => bool(a === 0),
	not: (a) => bool(a === 0),
	neg: (a) => -a,
	abs: Math.abs,
	flr: Math.floor,
	ceil: Math.ceil,
	near: Math.round,
	int: Math.trunc,
	sqrt: Math.sqrt,
	dnor: (a) => ((a % 360) + 360) % 360,
	dgrd: (a) => (a * Math.PI) / 180,
	rddg: (a) => (a * 180) / Math.PI,
};

const STACK_OPS = new Set(["d", "p", "r", "c"]);

function bool(b: boolean): number {
	return b ? 1 : 0;
}

const TOKEN_RE = /\s*(\([^()]*\)|if\{|els\{|\}|[^\s(){}]+)/y;

function tokenize(src: string): ParseResult<string[]> {
	const tokens: string[] = [];
	TOKEN_RE.lastIndex = 0;
	let pos = 0;
	while (pos < src.length) {
		TOKEN_RE.lastIndex = pos;
		const m = TOKEN_RE.exec(src);
		if (!m) {
			if (src.slice(pos).trim() === "") break;
			return { ok: false, error: `unexpected "${src.slice(pos).trim().slice(0, 20)}"` };
		}
		tokens.push(m[1]);
		pos = TOKEN_RE.lastIndex;
	}
	return { ok: true, path: tokens };
}

/**
 * Accepts plain RPN, AAO's `(S:<rpn>)` wrapper, or a bare var path
 * (`L:name`, `A:NAME, unit`) as shorthand for that single var.
 */
export function compileRpn(raw: string): ParseResult<RpnProgram> {
	let src = raw.trim();
	const wrapped = /^\(S:([\s\S]*)\)$/i.exec(src);
	if (wrapped) src = wrapped[1].trim();
	if (!src) return { ok: false, error: "empty expression" };
	if (!src.startsWith("(") && /^[AL]:/i.test(src)) src = `(${src})`;

	const tokens = tokenize(src);
	if (!tokens.ok) return tokens;
	const vars = new Map<string, VarPath>();
	let i = 0;

	const parseBlock = (inBlock: boolean): ParseResult<Op[]> => {
		const ops: Op[] = [];
		while (i < tokens.path.length) {
			const tok = tokens.path[i++];
			if (tok === "}") {
				if (!inBlock) return { ok: false, error: 'unmatched "}"' };
				return { ok: true, path: ops };
			}
			if (tok === "if{") {
				const then = parseBlock(true);
				if (!then.ok) return then;
				let elseOps: Op[] | undefined;
				if (tokens.path[i] === "els{") {
					i++;
					const e = parseBlock(true);
					if (!e.ok) return e;
					elseOps = e.path;
				}
				ops.push({ t: "if", yes: then.path, no: elseOps });
				continue;
			}
			if (tok === "els{") return { ok: false, error: '"els{" without "if{"' };
			const op = parseToken(tok, vars);
			if (!op.ok) return op;
			ops.push(op.path);
		}
		if (inBlock) return { ok: false, error: 'missing "}"' };
		return { ok: true, path: ops };
	};

	const ops = parseBlock(false);
	if (!ops.ok) return ops;
	if (ops.path.length === 0) return { ok: false, error: "empty expression" };
	return { ok: true, path: { source: raw.trim(), vars: [...vars.values()], ops: ops.path } };
}

function parseToken(tok: string, vars: Map<string, VarPath>): ParseResult<Op> {
	if (tok.startsWith("(")) {
		const inner = tok.slice(1, -1).trim();
		if (inner.startsWith(">")) return { ok: false, error: `writes are not allowed: ${tok}` };
		if (!/^[AL]:/i.test(inner)) return { ok: false, error: `unsupported var ${tok}` };
		const parsed = parseVarPath(inner);
		if (!parsed.ok) return parsed;
		if (!vars.has(parsed.path.key)) vars.set(parsed.path.key, parsed.path);
		return { ok: true, path: { t: "var", key: parsed.path.key } };
	}
	if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok)) {
		return { ok: true, path: { t: "num", v: Number(tok) } };
	}
	const reg = /^(sp|s|l)(\d{1,2})$/.exec(tok);
	if (reg) {
		const n = Number(reg[2]);
		return {
			ok: true,
			path:
				reg[1] === "l"
					? { t: "load", reg: n }
					: { t: "store", reg: n, pop: reg[1] === "sp" },
		};
	}
	if (Object.hasOwn(BINARY, tok) || Object.hasOwn(UNARY, tok) || STACK_OPS.has(tok)) {
		return { ok: true, path: { t: "fn", name: tok } };
	}
	return { ok: false, error: `unsupported token "${tok}"` };
}

/** `undefined` when a var has no value yet or is unknown, or the stack runs dry. */
export function evalRpn(p: RpnProgram, lookup: VarLookup): number | undefined {
	const stack: number[] = [];
	const regs: number[] = [];
	const ok = run(p.ops, stack, regs, lookup);
	if (!ok || stack.length === 0) return undefined;
	const top = stack[stack.length - 1];
	return Number.isFinite(top) ? top : undefined;
}

function run(ops: Op[], stack: number[], regs: number[], lookup: VarLookup): boolean {
	for (const op of ops) {
		switch (op.t) {
			case "num":
				stack.push(op.v);
				break;
			case "var": {
				const v = lookup(op.key);
				if (typeof v !== "number") return false;
				stack.push(v);
				break;
			}
			case "store":
				if (stack.length === 0) return false;
				regs[op.reg] = op.pop ? (stack.pop() as number) : stack[stack.length - 1];
				break;
			case "load":
				stack.push(regs[op.reg] ?? 0);
				break;
			case "if": {
				if (stack.length === 0) return false;
				const branch = (stack.pop() as number) !== 0 ? op.yes : op.no;
				if (branch && !run(branch, stack, regs, lookup)) return false;
				break;
			}
			case "fn":
				if (!applyFn(op.name, stack)) return false;
				break;
		}
	}
	return true;
}

function applyFn(name: string, stack: number[]): boolean {
	const bin = BINARY[name];
	if (bin) {
		if (stack.length < 2) return false;
		const b = stack.pop() as number;
		const a = stack.pop() as number;
		stack.push(bin(a, b));
		return true;
	}
	const un = UNARY[name];
	if (un) {
		if (stack.length < 1) return false;
		stack.push(un(stack.pop() as number));
		return true;
	}
	switch (name) {
		case "d":
			if (stack.length < 1) return false;
			stack.push(stack[stack.length - 1]);
			return true;
		case "p":
			if (stack.length < 1) return false;
			stack.pop();
			return true;
		case "r": {
			if (stack.length < 2) return false;
			const b = stack.pop() as number;
			const a = stack.pop() as number;
			stack.push(b, a);
			return true;
		}
		case "c":
			stack.length = 0;
			return true;
	}
	return false;
}
