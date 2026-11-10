/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// M03 smoke test for the WASM bridge over (remote) SimConnect. Usage:
//
//   FS24_HOST=192.168.1.50 FS24_PORT=502 npx tsx scripts/bridge-ping.ts
//
// Optional env (each runs after the PING):
//   FS24_HEVENT=H145_SDK_OH_PITOT_1_ON   fire an H:-event via fsEventsHEventCall
//   FS24_RPN="1 (>K:PAUSE_SET)"          execute RPN code

import {
	ClientDataPeriod,
	ClientDataRequestFlag,
	open,
	Protocol,
	type RecvException,
} from "node-simconnect";

const HOST = process.env.FS24_HOST ?? "";
const PORT = Number(process.env.FS24_PORT ?? 500);
const TIMEOUT_MS = 3000;

const CD_CMD = 0;
const CD_RSP = 1;
const DEF_CMD = 0;
const DEF_RSP = 1;
const REQ_RSP = 0;
const CMD_SIZE = 1032;
const RSP_SIZE = 272;
const ARG_SIZE = 1024;
const OP = { PING: 1, HEVENT: 2, RPN: 3 } as const;

type Response = { seq: number; status: number; value: number; text: string };

function log(msg: string): void {
	console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

function encode(seq: number, op: number, arg: string): Buffer {
	const buf = Buffer.alloc(CMD_SIZE);
	buf.writeUInt32LE(seq, 0);
	buf.writeUInt32LE(op, 4);
	const bytes = Buffer.from(arg, "utf8");
	if (bytes.length >= ARG_SIZE) throw new Error(`arg too long (${bytes.length} B)`);
	bytes.copy(buf, 8);
	return buf;
}

function decode(raw: Buffer): Response {
	const end = raw.indexOf(0, 16);
	return {
		seq: raw.readUInt32LE(0),
		status: raw.readInt32LE(4),
		value: raw.readDoubleLE(8),
		text: raw.toString("utf8", 16, end < 0 ? RSP_SIZE : end),
	};
}

async function main(): Promise<void> {
	const options = HOST ? { remote: { host: HOST, port: PORT } } : undefined;
	const { recvOpen, handle } = await open("fs24-bridge-ping", Protocol.KittyHawk, options);
	log(`connected: ${recvOpen.applicationName}`);
	handle.on("exception", (ex: RecvException) =>
		log(`SimConnect exception ${ex.exception} (send id ${ex.sendId}, index ${ex.index})`),
	);

	handle.mapClientDataNameToID("fs24.bridge.cmd", CD_CMD);
	handle.mapClientDataNameToID("fs24.bridge.rsp", CD_RSP);
	handle.addToClientDataDefinition(DEF_CMD, 0, CMD_SIZE);
	handle.addToClientDataDefinition(DEF_RSP, 0, RSP_SIZE);

	const waiters = new Map<number, (r: Response) => void>();
	handle.on("clientData", (d) => {
		if (d.requestID !== REQ_RSP) return;
		const r = decode(d.data.readBytes(RSP_SIZE));
		waiters.get(r.seq)?.(r);
	});
	handle.requestClientData(
		CD_RSP,
		REQ_RSP,
		DEF_RSP,
		ClientDataPeriod.ON_SET,
		ClientDataRequestFlag.CLIENT_DATA_REQUEST_FLAG_DEFAULT,
	);

	let seq = (Date.now() & 0xffff) + 1;
	const send = (op: number, arg = ""): Promise<Response> => {
		const id = seq++;
		const t0 = performance.now();
		return new Promise<Response>((resolve, reject) => {
			const timer = setTimeout(() => {
				waiters.delete(id);
				reject(
					new Error(
						`no response for seq ${id} within ${TIMEOUT_MS} ms (bridge not loaded?)`,
					),
				);
			}, TIMEOUT_MS);
			waiters.set(id, (r) => {
				clearTimeout(timer);
				waiters.delete(id);
				log(`  ${(performance.now() - t0).toFixed(0)} ms`);
				resolve(r);
			});
			handle.setClientData(CD_CMD, DEF_CMD, 0, 0, CMD_SIZE, encode(id, op, arg));
		});
	};

	await run("PING", () => send(OP.PING));
	if (process.env.FS24_HEVENT) {
		const name = process.env.FS24_HEVENT.replace(/^H:/i, "");
		await run(`HEVENT ${name}`, () => send(OP.HEVENT, name));
	}
	if (process.env.FS24_RPN) {
		const code = process.env.FS24_RPN;
		await run(`RPN ${code}`, () => send(OP.RPN, code));
	}
	handle.close();
}

async function run(label: string, fn: () => Promise<Response>): Promise<void> {
	log(`→ ${label}`);
	try {
		const r = await fn();
		log(`← status ${r.status}, value ${r.value}, text "${r.text}"`);
	} catch (err) {
		log(`✗ ${(err as Error).message}`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
