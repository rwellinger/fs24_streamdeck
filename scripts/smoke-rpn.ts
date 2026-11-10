/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Offline checks for the plugin-side RPN evaluator. Usage: npx tsx scripts/smoke-rpn.ts

import { compileRpn, evalRpn } from "../src/util/rpn";

const VALUES: Record<string, number> = {
	"L:MODE|number": 2,
	"L:FLAG|bool": 1,
	"A:SIM ON GROUND|bool": 0,
	"A:RADIO HEIGHT|feet": 400,
	"L:WATERLINE|number": 100,
};

const ok: [string, number | undefined][] = [
	["(L:MODE) 2 ==", 1],
	["(S:(L:MODE) 0 !=)", 1],
	["L:MODE", 2],
	["A:RADIO HEIGHT, Feet", 400],
	["(L:FLAG, Bool) 1 == (A:SIM ON GROUND, Bool) 0 == and", 1],
	["(L:MODE) 3 >= ! not", 0],
	["(A:RADIO HEIGHT, Feet) s0 (L:WATERLINE) s1 l0 l1 - s2 l2 150 > if{ 3 } els{ l2 }", 3],
	["1 s0 0 s1 l0 l1 +", 1],
	["(L:MODE) 1 == if{ 10 } els{ (L:MODE) 2 == if{ 20 } els{ 30 } }", 20],
	["(L:FLAG, Bool) 1 -", 0],
	["370 dnor", 10],
	["3 4 r -", 1],
	["5 d *", 25],
	["7 sp0 l0", 7],
	["(L:UNKNOWN) 1 ==", undefined],
	["1 if{ }", undefined],
];

const bad = [
	"",
	"(>L:MODE) 1",
	"(E:ABSOLUTE TIME, Seconds)",
	"1 2 ddiff",
	"1 if{ 2",
	"1 }",
	"els{ 1 }",
	"(A:NO UNIT)",
];

let failures = 0;
const lookup = (k: string) => (Object.hasOwn(VALUES, k) ? VALUES[k] : null);

for (const [src, want] of ok) {
	const p = compileRpn(src);
	if (!p.ok) {
		failures++;
		console.log(`FAIL compile  ${src}: ${p.error}`);
		continue;
	}
	const got = evalRpn(p.path, lookup);
	if (got !== want) {
		failures++;
		console.log(`FAIL eval     ${src}: got ${got}, want ${want}`);
	}
}
for (const src of bad) {
	const p = compileRpn(src);
	if (p.ok) {
		failures++;
		console.log(`FAIL accepted ${src}`);
	}
}

console.log(failures === 0 ? `ok (${ok.length + bad.length} cases)` : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
