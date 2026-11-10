/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import {
	ClientDataPeriod,
	ClientDataRequestFlag,
	type ConnectionHandle,
	type RecvSimObjectData,
} from "node-simconnect";

/**
 * Client of the in-sim WASM bridge (wasm/src/bridge.cpp) over SimConnect
 * ClientData. Protocol: docs/research/wasm-bridge.md. One command slot →
 * commands are serialised and matched to responses by `seq`.
 */

type Logger = {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
};

export type BridgeConnection = {
	handle: ConnectionHandle;
	onSendError(sendId: number, onError: (err: Error) => void): void;
	forgetSendError(sendId: number): void;
};

type Response = { seq: number; status: number; value: number; text: string };
export type RpnResult = { value: number; text: string };

const AREA_CMD = "fs24.bridge.cmd";
const AREA_RSP = "fs24.bridge.rsp";
const CMD_SIZE = 1032;
const RSP_SIZE = 272;
const ARG_SIZE = 1024;
const TEXT_OFFSET = 16;
const PROTOCOL_VERSION = 1;
const RESPONSE_TIMEOUT_MS = 1000;

// High IDs keep clear of VarRegistry's define/request IDs (from 1000 up).
const CD_CMD = 0x7f00;
const CD_RSP = 0x7f01;
const DEF_CMD = 0x7f00;
const DEF_RSP = 0x7f01;
const REQ_RSP = 0x7f00;

const OP_PING = 1;
// Op 2 (H:-event via fsEventsHEventCall) is retired: the 2024 API always
// returned FS_EVENTS_ERROR_FAIL. H:-events go through RPN instead.
const OP_RPN = 3;

const STATUS_TEXT: Record<number, string> = {
	1: "unknown op (bridge too old?)",
	2: "empty argument",
	5: "RPN code failed",
};

export const BRIDGE_MISSING_HINT =
	"WASM bridge not responding — is the package fs24-streamdeck-bridge in the MSFS Community folder (sim restarted after installing)?";

export class Bridge {
	private conn: BridgeConnection | null = null;
	private version: string | null = null;
	private pinging: Promise<string> | null = null;
	private seq = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly waiters = new Map<number, (r: Response) => void>();

	constructor(private readonly logger: Logger) {}

	attach(conn: BridgeConnection): void {
		this.conn = conn;
		this.version = null;
		this.pinging = null;
		this.seq = (Date.now() & 0xffff) << 8;
		const h = conn.handle;
		h.mapClientDataNameToID(AREA_CMD, CD_CMD);
		h.mapClientDataNameToID(AREA_RSP, CD_RSP);
		h.addToClientDataDefinition(DEF_CMD, 0, CMD_SIZE);
		h.addToClientDataDefinition(DEF_RSP, 0, RSP_SIZE);
		h.on("clientData", (d: RecvSimObjectData) => {
			if (this.conn?.handle !== h || d.requestID !== REQ_RSP) return;
			const r = decode(d.data.readBytes(RSP_SIZE));
			this.waiters.get(r.seq)?.(r);
		});
		const sendId = h.requestClientData(
			CD_RSP,
			REQ_RSP,
			DEF_RSP,
			ClientDataPeriod.ON_SET,
			ClientDataRequestFlag.CLIENT_DATA_REQUEST_FLAG_DEFAULT,
		);
		conn.onSendError(sendId, (err) =>
			this.logger.warn(`bridge: ${err.message}. ${BRIDGE_MISSING_HINT}`),
		);
		this.ensureReady().catch(() => {});
	}

	detach(): void {
		this.conn = null;
		this.version = null;
		this.pinging = null;
		this.waiters.clear();
	}

	/** Bridge version; pings when not yet known. Rejects when the bridge is absent. */
	ensureReady(): Promise<string> {
		if (this.version) return Promise.resolve(this.version);
		this.pinging ??= this.ping().finally(() => {
			this.pinging = null;
		});
		return this.pinging;
	}

	private async ping(): Promise<string> {
		try {
			const r = await this.send(OP_PING, "");
			if (r.value !== PROTOCOL_VERSION) {
				throw new Error(`bridge protocol ${r.value}, plugin expects ${PROTOCOL_VERSION}`);
			}
			this.version = r.text;
			this.logger.info(`WASM bridge ${r.text} ready`);
			return r.text;
		} catch (err) {
			this.logger.warn(`bridge: ${(err as Error).message}`);
			throw err;
		}
	}

	async hEvent(name: string): Promise<void> {
		await this.ensureReady();
		check(await this.send(OP_RPN, `(>H:${name})`), `H:${name}`);
	}

	async rpn(code: string): Promise<RpnResult> {
		await this.ensureReady();
		const r = check(await this.send(OP_RPN, code), `RPN "${code}"`);
		return { value: r.value, text: r.text };
	}

	/** Queues one command; resolves with the matching response. */
	private send(op: number, arg: string): Promise<Response> {
		const run = () => this.sendNow(op, arg);
		const p = this.queue.then(run, run);
		this.queue = p.catch(() => {});
		return p;
	}

	private sendNow(op: number, arg: string): Promise<Response> {
		const conn = this.conn;
		if (!conn) return Promise.reject(new Error("SimConnect not connected"));
		const buf = encode(++this.seq, op, arg);
		const seq = this.seq;
		return new Promise<Response>((resolve, reject) => {
			let sendId = -1;
			const done = (fn: () => void) => {
				clearTimeout(timer);
				this.waiters.delete(seq);
				conn.forgetSendError(sendId);
				fn();
			};
			const timer = setTimeout(
				() => done(() => reject(new Error(BRIDGE_MISSING_HINT))),
				RESPONSE_TIMEOUT_MS,
			);
			this.waiters.set(seq, (r) => done(() => resolve(r)));
			sendId = conn.handle.setClientData(CD_CMD, DEF_CMD, 0, 0, CMD_SIZE, buf);
			conn.onSendError(sendId, (err) =>
				done(() => reject(new Error(`${err.message}. ${BRIDGE_MISSING_HINT}`))),
			);
		});
	}
}

function check(r: Response, what: string): Response {
	if (r.status === 0) return r;
	const reason = STATUS_TEXT[r.status] ?? `status ${r.status}`;
	const code = r.value !== 0 ? ` (code ${r.value})` : "";
	throw new Error(`bridge: ${what}: ${reason}${code}`);
}

function encode(seq: number, op: number, arg: string): Buffer {
	const bytes = Buffer.from(arg, "utf8");
	if (bytes.length >= ARG_SIZE)
		throw new Error(`bridge argument too long (${bytes.length} bytes, max ${ARG_SIZE - 1})`);
	const buf = Buffer.alloc(CMD_SIZE);
	buf.writeUInt32LE(seq >>> 0, 0);
	buf.writeUInt32LE(op, 4);
	bytes.copy(buf, 8);
	return buf;
}

function decode(raw: Buffer): Response {
	const end = raw.indexOf(0, TEXT_OFFSET);
	return {
		seq: raw.readUInt32LE(0),
		status: raw.readInt32LE(4),
		value: raw.readDoubleLE(8),
		text: raw.toString("utf8", TEXT_OFFSET, end < 0 ? RSP_SIZE : end),
	};
}

export const BRIDGE_ARG_MAX_BYTES = ARG_SIZE - 1;
