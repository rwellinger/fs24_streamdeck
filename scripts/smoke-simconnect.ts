/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// M01 spike: exercise the SimConnect paths the plugin will rely on, against a
// remote MSFS 2024. Every step is isolated — a failure is recorded and the run
// continues. Usage:
//
//   FS24_HOST=192.168.1.50 FS24_PORT=500 npx tsx scripts/smoke-simconnect.ts
//
// Optional env:
//   FS24_PROTOCOL=sunrise      use Protocol.SunRise (2024) instead of KittyHawk
//   FS24_WATCH_S=20            duration of the change watch (step 3)
//   FS24_WATCH_VAR="LIGHT STROBE"  Bool A:-var to watch in step 3 (default LIGHT BEACON)
//   FS24_LVAR="L:FOO, Number"  L:-var to read (default H145 pitot heat)
//   FS24_BEVENT=NAME           input event to get/set (default: first enumerated)
//   FS24_BEVENT_VALUE=1        value to set (default: write back the value read)
//   FS24_SKIP_PAUSE=1          skip the PAUSE_TOGGLE step
//   FS24_QUIT_WATCH_S=120      after all steps, stay connected and report how a
//                              sim shutdown surfaces (quit / close / error / nothing)

import {
	type ConnectionHandle,
	DataRequestFlag,
	EventFlag,
	type InputEventDescriptor,
	open,
	Protocol,
	type RecvException,
	SimConnectConstants,
	SimConnectDataType,
	SimConnectPeriod,
} from "node-simconnect";

const HOST = process.env.FS24_HOST ?? "";
const PORT = Number(process.env.FS24_PORT ?? 500);
const PROTOCOL =
	process.env.FS24_PROTOCOL?.toLowerCase() === "sunrise" ? Protocol.SunRise : Protocol.KittyHawk;
const WATCH_S = Number(process.env.FS24_WATCH_S ?? 20);
const WATCH_VAR = process.env.FS24_WATCH_VAR ?? "LIGHT BEACON";
const LVAR = process.env.FS24_LVAR ?? "L:H145_SDK_OH_PITOT_1, Number";
const BEVENT = process.env.FS24_BEVENT ?? "";
const BEVENT_VALUE = process.env.FS24_BEVENT_VALUE;
const SKIP_PAUSE = process.env.FS24_SKIP_PAUSE === "1";
const QUIT_WATCH_S = Number(process.env.FS24_QUIT_WATCH_S ?? 0);

const STEP_TIMEOUT_MS = 5000;

type Result = { step: string; ok: boolean; detail: string };
const results: Result[] = [];

const exceptions: RecvException[] = [];

function log(msg: string): void {
	console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${what}`)), ms),
		),
	]);
}

/** Rejects if SimConnect raises an exception for one of the given send IDs. */
function exceptionFor(handle: ConnectionHandle, sendIds: number[]): Promise<never> {
	return new Promise((_, reject) => {
		const check = (ex: RecvException) => {
			if (sendIds.includes(ex.sendId)) {
				handle.off("exception", check);
				reject(
					new Error(`exception ${ex.exceptionName} (${ex.exception}) index=${ex.index}`),
				);
			}
		};
		handle.on("exception", check);
	});
}

async function step(name: string, fn: () => Promise<string>): Promise<void> {
	log(`── ${name}`);
	try {
		const detail = await fn();
		results.push({ step: name, ok: true, detail });
		log(`   OK: ${detail}`);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		results.push({ step: name, ok: false, detail });
		log(`   FAIL: ${detail}`);
	}
}

function parseVar(spec: string): { name: string; unit: string } {
	const idx = spec.lastIndexOf(",");
	if (idx < 0) return { name: spec.trim(), unit: "Number" };
	return { name: spec.slice(0, idx).trim(), unit: spec.slice(idx + 1).trim() };
}

async function readOnce(
	handle: ConnectionHandle,
	defId: number,
	reqId: number,
	vars: Array<{ name: string; unit: string }>,
): Promise<number[]> {
	const sendIds = vars.map((v) =>
		handle.addToDataDefinition(defId, v.name, v.unit, SimConnectDataType.FLOAT64),
	);
	const data = new Promise<number[]>((resolve) => {
		const onData = (recv: { requestID: number; data: { readFloat64(): number } }) => {
			if (recv.requestID !== reqId) return;
			handle.off("simObjectData", onData);
			resolve(vars.map(() => recv.data.readFloat64()));
		};
		handle.on("simObjectData", onData);
	});
	sendIds.push(
		handle.requestDataOnSimObject(
			reqId,
			defId,
			SimConnectConstants.OBJECT_ID_USER,
			SimConnectPeriod.ONCE,
		),
	);
	return withTimeout(
		Promise.race([data, exceptionFor(handle, sendIds)]),
		STEP_TIMEOUT_MS,
		"data",
	);
}

async function main(): Promise<void> {
	if (!HOST) {
		console.error("FS24_HOST is required (IP of the sim PC).");
		process.exit(2);
	}

	log(`connecting to ${HOST}:${PORT} (protocol ${Protocol[PROTOCOL]})`);
	const t0 = Date.now();
	const { recvOpen, handle } = await withTimeout(
		open("fs24_smoke", PROTOCOL, { remote: { host: HOST, port: PORT } }),
		10000,
		"open",
	);

	handle.on("exception", (ex) => {
		exceptions.push(ex);
		log(`   ! exception ${ex.exceptionName} (${ex.exception}) sendId=${ex.sendId}`);
	});
	handle.on("error", (err) => log(`   ! error: ${err.message}`));

	results.push({
		step: "1 connect",
		ok: true,
		detail:
			`${recvOpen.applicationName} ` +
			`app ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}.` +
			`${recvOpen.applicationBuildMajor}.${recvOpen.applicationBuildMinor}, ` +
			`SimConnect ${recvOpen.simConnectVersionMajor}.${recvOpen.simConnectVersionMinor}.` +
			`${recvOpen.simConnectBuildMajor}.${recvOpen.simConnectBuildMinor}, ${Date.now() - t0} ms`,
	});
	log(`── 1 connect\n   OK: ${results[0].detail}`);

	await step("2 read A:PLANE ALTITUDE + A:LIGHT BEACON", async () => {
		const [alt, beacon] = await readOnce(handle, 1, 1, [
			{ name: "PLANE ALTITUDE", unit: "feet" },
			{ name: "LIGHT BEACON", unit: "Bool" },
		]);
		return `altitude=${alt.toFixed(1)} ft, beacon=${beacon}`;
	});

	await step(`3 subscribe A:${WATCH_VAR} for ${WATCH_S} s (flip the switch now)`, async () => {
		const defId = 2;
		const reqId = 2;
		const sendIds = [
			handle.addToDataDefinition(defId, WATCH_VAR, "Bool", SimConnectDataType.INT32),
		];
		const changes: string[] = [];
		const onData = (recv: { requestID: number; data: { readInt32(): number } }) => {
			if (recv.requestID !== reqId) return;
			const v = recv.data.readInt32();
			changes.push(String(v));
			log(`   ${WATCH_VAR} = ${v}`);
		};
		handle.on("simObjectData", onData);
		sendIds.push(
			handle.requestDataOnSimObject(
				reqId,
				defId,
				SimConnectConstants.OBJECT_ID_USER,
				SimConnectPeriod.SIM_FRAME,
				DataRequestFlag.DATA_REQUEST_FLAG_CHANGED,
			),
		);
		await Promise.race([sleep(WATCH_S * 1000), exceptionFor(handle, sendIds)]);
		handle.requestDataOnSimObject(
			reqId,
			defId,
			SimConnectConstants.OBJECT_ID_USER,
			SimConnectPeriod.NEVER,
		);
		handle.off("simObjectData", onData);
		if (changes.length === 0) throw new Error("no data received at all");
		return `${changes.length} update(s): ${changes.join(" → ")} (first one is the initial value)`;
	});

	await step(`4 read ${LVAR}`, async () => {
		const v = parseVar(LVAR);
		const [value] = await readOnce(handle, 3, 3, [v]);
		return `${v.name} = ${value}`;
	});

	if (SKIP_PAUSE) {
		results.push({ step: "5 K:PAUSE_TOGGLE", ok: true, detail: "skipped (FS24_SKIP_PAUSE=1)" });
	} else {
		await step("5 K:PAUSE_TOGGLE ×2", async () => {
			const eventId = 1;
			const sendIds = [handle.mapClientEventToSimEvent(eventId, "PAUSE_TOGGLE")];
			const fire = () =>
				handle.transmitClientEvent(
					SimConnectConstants.OBJECT_ID_USER,
					eventId,
					0,
					1,
					EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
				);
			sendIds.push(fire());
			log("   paused? (waiting 3 s)");
			await Promise.race([sleep(3000), exceptionFor(handle, sendIds)]);
			sendIds.push(fire());
			await Promise.race([sleep(1000), exceptionFor(handle, sendIds)]);
			return "two toggles sent without exception — confirm visually that the sim paused and resumed";
		});

		await step("5b unknown K:-event is rejected", async () => {
			const sendId = handle.mapClientEventToSimEvent(2, "FS24_DOES_NOT_EXIST");
			const outcome = await Promise.race([
				exceptionFor(handle, [sendId]).catch((err: Error) => `rejected: ${err.message}`),
				sleep(2000).then(() => "NO exception within 2 s"),
			]);
			return outcome;
		});
	}

	await step("6 B: input events", async () => {
		const reqId = 10;
		const descriptors: InputEventDescriptor[] = [];
		const listed = new Promise<void>((resolve) => {
			handle.on("inputEventsList", (recv) => {
				if (recv.requestID !== reqId) return;
				descriptors.push(...recv.inputEventDescriptors);
				if (recv.entryNumber + 1 >= recv.outOf) resolve();
			});
		});
		const sendId = handle.enumerateInputEvents(reqId);
		await withTimeout(
			Promise.race([listed, exceptionFor(handle, [sendId])]),
			STEP_TIMEOUT_MS,
			"enumerateInputEvents",
		);
		log(`   ${descriptors.length} input events; first 20:`);
		for (const d of descriptors.slice(0, 20)) {
			log(
				`     ${d.name}  (type ${d.type === 0 ? "double" : "string"}, hash ${d.inputEventIdHash})`,
			);
		}
		if (descriptors.length === 0) return "0 input events enumerated";

		const target = BEVENT ? descriptors.find((d) => d.name === BEVENT) : descriptors[0];
		if (!target) throw new Error(`input event ${BEVENT} not found`);

		const getReq = 11;
		const got = new Promise<number | string>((resolve) => {
			handle.on("getInputEvent", (recv) => {
				if (recv.requestID === getReq) resolve(recv.value);
			});
		});
		const getSend = handle.getInputEvent(getReq, target.inputEventIdHash);
		const value = await withTimeout(
			Promise.race([got, exceptionFor(handle, [getSend])]),
			STEP_TIMEOUT_MS,
			"getInputEvent",
		);
		log(`   get ${target.name} = ${value}`);

		const newValue = BEVENT_VALUE !== undefined ? Number(BEVENT_VALUE) : value;
		const setSend = handle.setInputEvent(target.inputEventIdHash, newValue);
		await Promise.race([sleep(1000), exceptionFor(handle, [setSend])]);

		const got2 = new Promise<number | string>((resolve) => {
			handle.on("getInputEvent", (recv) => {
				if (recv.requestID === getReq + 1) resolve(recv.value);
			});
		});
		const getSend2 = handle.getInputEvent(getReq + 1, target.inputEventIdHash);
		const after = await withTimeout(
			Promise.race([got2, exceptionFor(handle, [getSend2])]),
			STEP_TIMEOUT_MS,
			"getInputEvent (after set)",
		);
		return (
			`${descriptors.length} events; ${target.name}: read ${value}, ` +
			`set ${newValue}, read back ${after}`
		);
	});

	if (QUIT_WATCH_S > 0) {
		await step(`7b quit MSFS now — watching ${QUIT_WATCH_S} s`, async () => {
			const start = Date.now();
			const seen = await Promise.race([
				new Promise<string>((r) => handle.once("quit", () => r("quit"))),
				new Promise<string>((r) => handle.once("close", () => r("close"))),
				new Promise<string>((r) => handle.once("error", (e) => r(`error: ${e.message}`))),
				sleep(QUIT_WATCH_S * 1000).then(() => "nothing (silent hang)"),
			]);
			return `${seen} after ${((Date.now() - start) / 1000).toFixed(1)} s`;
		});
	}

	await step("7 disconnect", async () => {
		const closed = new Promise<void>((r) => handle.once("close", () => r()));
		handle.close();
		await Promise.race([closed, sleep(1000)]);
		return "closed";
	});

	console.log("\n=== Summary ===");
	for (const r of results) {
		console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}\n      ${r.detail}`);
	}
	if (exceptions.length > 0) {
		console.log(`\n${exceptions.length} SimConnect exception(s) total.`);
	}
	process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
	console.error("fatal:", err instanceof Error ? err.message : err);
	process.exit(1);
});
