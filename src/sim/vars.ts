/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import {
	type ConnectionHandle,
	DataRequestFlag,
	RawBuffer,
	SimConnectConstants,
	SimConnectDataType,
	SimConnectPeriod,
} from "node-simconnect";

import { describeVar, type VarPath } from "./path";

/** `null` = the var can't be resolved (unknown SimVar / input event). */
export type VarListener = (value: number | null) => void;

export type Logger = {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
};

/** What the registry needs from the live connection. */
export interface VarConnection {
	readonly handle: ConnectionHandle;
	/** Route a SimConnect exception for `sendId` to `onError`. */
	onSendError(sendId: number, onError: (err: Error) => void): void;
	/** Resolves once every earlier request was processed. */
	barrier(): Promise<void>;
}

interface Entry {
	path: VarPath;
	listeners: Set<VarListener>;
	value: number | null | undefined;
	// Connection-scoped; reset on detach.
	defineId?: number;
	requestId?: number;
	hash?: bigint;
	lastEmit: number;
	emitTimer: NodeJS.Timeout | null;
}

// Separate ranges keep the connection-scoped IDs from colliding with the
// client's own (barrier request IDs, K:-event IDs).
const FIRST_DEFINE_ID = 1000;
const FIRST_REQUEST_ID = 1000;
const ENUMERATE_TIMEOUT_MS = 5000;
const WRITE_BUFFER_SIZE = 8;
// SIM_FRAME + CHANGED delivers continuously changing values (RPM, airspeed) at
// frame rate; Stream Deck can't render that fast. Leading + trailing edge:
// isolated changes (a switch) go out immediately, the last value always lands.
const MIN_EMIT_INTERVAL_MS = 100;

/**
 * Ref-counted A:/L:/B: subscriptions. One SimConnect data definition + request
 * per (var, unit); B: input events are resolved to their hash by enumerating
 * the aircraft's input events (again after every aircraft change).
 */
export class VarRegistry {
	private readonly entries = new Map<string, Entry>();
	private conn: VarConnection | null = null;

	private nextDefineId = FIRST_DEFINE_ID;
	private nextRequestId = FIRST_REQUEST_ID;
	private readonly byRequestId = new Map<number, Entry>();
	private readonly byHash = new Map<bigint, Entry>();
	private readonly pendingGets = new Map<number, Entry>();
	private writeDefines = new Map<string, number>();

	private inputEvents: Map<string, bigint> | null = null;
	private enumerating: Promise<Map<string, bigint>> | null = null;
	private enumerateRequestId = -1;
	private enumerateCollect: { hashes: Map<string, bigint>; done: () => void } | null = null;

	constructor(private readonly logger: Logger) {}

	subscribe(path: VarPath, listener: VarListener): () => void {
		let entry = this.entries.get(path.key);
		if (!entry) {
			entry = { path, listeners: new Set(), value: undefined, lastEmit: 0, emitTimer: null };
			this.entries.set(path.key, entry);
			if (this.conn) this.register(this.conn, entry);
		}
		entry.listeners.add(listener);
		if (entry.value !== undefined) listener(entry.value);

		const e = entry;
		return () => {
			if (!e.listeners.delete(listener) || e.listeners.size > 0) return;
			if (this.entries.get(e.path.key) !== e) return;
			this.entries.delete(e.path.key);
			if (e.emitTimer) clearTimeout(e.emitTimer);
			if (this.conn) this.unregister(this.conn, e);
		};
	}

	/** Last known value; `undefined` = no data yet. */
	peek(path: VarPath): number | null | undefined {
		return this.entries.get(path.key)?.value;
	}

	async write(path: VarPath, value: number): Promise<void> {
		const conn = this.conn;
		if (!conn) throw new Error("SimConnect not connected");
		if (path.kind === "B") {
			const hash = (await this.resolveInputEvents(conn)).get(path.name);
			if (hash === undefined) throw new Error(`unknown input event ${describeVar(path)}`);
			const sendId = conn.handle.setInputEvent(hash, value);
			await this.checked(conn, [sendId]);
			return;
		}
		let defineId = this.writeDefines.get(path.key);
		const sendIds: number[] = [];
		if (defineId === undefined) {
			defineId = this.nextDefineId++;
			sendIds.push(
				conn.handle.addToDataDefinition(
					defineId,
					datumName(path),
					path.unit,
					SimConnectDataType.FLOAT64,
				),
			);
			this.writeDefines.set(path.key, defineId);
		}
		const buffer = new RawBuffer(WRITE_BUFFER_SIZE);
		buffer.writeFloat64(value);
		sendIds.push(
			conn.handle.setDataOnSimObject(defineId, SimConnectConstants.OBJECT_ID_USER, {
				buffer,
				arrayCount: 0,
				tagged: false,
			}),
		);
		try {
			await this.checked(conn, sendIds);
		} catch (err) {
			this.writeDefines.delete(path.key);
			throw err;
		}
	}

	attach(conn: VarConnection): void {
		this.conn = conn;
		const h = conn.handle;
		h.on("simObjectData", (recv) => {
			const entry = this.byRequestId.get(recv.requestID);
			if (entry) this.deliver(entry, recv.data.readFloat64());
		});
		h.on("subscribeInputEvent", (recv) => {
			const entry = this.byHash.get(recv.inputEventIdHash);
			if (entry) this.deliver(entry, toNumber(recv.value));
		});
		h.on("getInputEvent", (recv) => {
			const entry = this.pendingGets.get(recv.requestID);
			if (!entry) return;
			this.pendingGets.delete(recv.requestID);
			this.deliver(entry, toNumber(recv.value));
		});
		h.on("inputEventsList", (recv) => {
			const c = this.enumerateCollect;
			if (!c || recv.requestID !== this.enumerateRequestId) return;
			for (const d of recv.inputEventDescriptors)
				c.hashes.set(d.name.toUpperCase(), d.inputEventIdHash);
			if (recv.entryNumber + 1 >= recv.outOf) c.done();
		});
		for (const entry of this.entries.values()) this.register(conn, entry);
	}

	detach(): void {
		this.conn = null;
		this.byRequestId.clear();
		this.byHash.clear();
		this.pendingGets.clear();
		this.writeDefines = new Map();
		this.inputEvents = null;
		this.enumerating = null;
		this.enumerateCollect = null;
		this.nextDefineId = FIRST_DEFINE_ID;
		this.nextRequestId = FIRST_REQUEST_ID;
		for (const entry of this.entries.values()) {
			entry.defineId = undefined;
			entry.requestId = undefined;
			entry.hash = undefined;
		}
	}

	/**
	 * Aircraft changed: L:-vars and input events belong to the old aircraft.
	 * Re-request every A:/L: value (a fresh request delivers the current value
	 * immediately) and re-resolve every B: name.
	 */
	refreshForAircraft(): void {
		const conn = this.conn;
		if (!conn) return;
		this.inputEvents = null;
		this.enumerating = null;
		for (const entry of this.entries.values()) {
			if (entry.path.kind === "B") {
				if (entry.hash !== undefined) {
					this.byHash.delete(entry.hash);
					conn.handle.unsubscribeInputEvent(entry.hash);
					entry.hash = undefined;
				}
				this.register(conn, entry);
			} else if (entry.defineId !== undefined && entry.requestId !== undefined) {
				this.request(conn, entry.requestId, entry.defineId, SimConnectPeriod.SIM_FRAME);
			}
		}
	}

	private register(conn: VarConnection, entry: Entry): void {
		if (entry.path.kind === "B") {
			this.registerInputEvent(conn, entry).catch((err) =>
				this.logger.warn(`B: subscribe failed for ${describeVar(entry.path)}`, err),
			);
			return;
		}
		const defineId = this.nextDefineId++;
		const requestId = this.nextRequestId++;
		entry.defineId = defineId;
		entry.requestId = requestId;
		this.byRequestId.set(requestId, entry);

		const fail = (err: Error) => {
			if (entry.requestId !== requestId) return;
			this.logger.warn(`cannot subscribe ${describeVar(entry.path)}: ${err.message}`);
			this.deliver(entry, null);
		};
		const path = entry.path;
		conn.onSendError(
			conn.handle.addToDataDefinition(
				defineId,
				datumName(path),
				path.unit,
				SimConnectDataType.FLOAT64,
			),
			fail,
		);
		conn.onSendError(this.request(conn, requestId, defineId, SimConnectPeriod.SIM_FRAME), fail);
	}

	private async registerInputEvent(conn: VarConnection, entry: Entry): Promise<void> {
		const hashes = await this.resolveInputEvents(conn);
		if (this.conn !== conn || this.entries.get(entry.path.key) !== entry) return;
		const hash = hashes.get(entry.path.name);
		if (hash === undefined) {
			this.logger.warn(`unknown input event ${describeVar(entry.path)}`);
			this.deliver(entry, null);
			return;
		}
		entry.hash = hash;
		this.byHash.set(hash, entry);
		conn.handle.subscribeInputEvent(hash);
		const requestId = this.nextRequestId++;
		this.pendingGets.set(requestId, entry);
		conn.handle.getInputEvent(requestId, hash);
	}

	private unregister(conn: VarConnection, entry: Entry): void {
		if (entry.path.kind === "B") {
			if (entry.hash !== undefined) {
				this.byHash.delete(entry.hash);
				conn.handle.unsubscribeInputEvent(entry.hash);
			}
			return;
		}
		if (entry.requestId === undefined || entry.defineId === undefined) return;
		this.byRequestId.delete(entry.requestId);
		this.request(conn, entry.requestId, entry.defineId, SimConnectPeriod.NEVER);
		conn.handle.clearDataDefinition(entry.defineId);
	}

	private request(
		conn: VarConnection,
		requestId: number,
		defineId: number,
		period: SimConnectPeriod,
	): number {
		return conn.handle.requestDataOnSimObject(
			requestId,
			defineId,
			SimConnectConstants.OBJECT_ID_USER,
			period,
			DataRequestFlag.DATA_REQUEST_FLAG_CHANGED,
		);
	}

	private resolveInputEvents(conn: VarConnection): Promise<Map<string, bigint>> {
		if (this.inputEvents) return Promise.resolve(this.inputEvents);
		if (this.enumerating) return this.enumerating;
		const requestId = this.nextRequestId++;
		this.enumerateRequestId = requestId;
		const hashes = new Map<string, bigint>();
		const p = new Promise<Map<string, bigint>>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				if (this.enumerateRequestId === requestId) this.enumerateCollect = null;
				resolve(hashes);
			};
			// An aircraft without input events answers with an exception or
			// not at all; treat both as "no input events".
			const timer = setTimeout(finish, ENUMERATE_TIMEOUT_MS);
			this.enumerateCollect = { hashes, done: finish };
			conn.onSendError(conn.handle.enumerateInputEvents(requestId), finish);
		}).then((result) => {
			if (this.conn === conn && this.enumerateRequestId === requestId) {
				this.inputEvents = result;
				this.enumerating = null;
				this.logger.info(`input events resolved: ${result.size}`);
			}
			return result;
		});
		this.enumerating = p;
		return p;
	}

	private checked(conn: VarConnection, sendIds: number[]): Promise<void> {
		const failed = new Promise<never>((_, reject) => {
			for (const id of sendIds) conn.onSendError(id, reject);
		});
		return Promise.race([failed, conn.barrier()]);
	}

	private deliver(entry: Entry, value: number | null): void {
		if (value === null && entry.value === null) return;
		entry.value = value;
		if (entry.emitTimer) return;
		const wait = entry.lastEmit + MIN_EMIT_INTERVAL_MS - Date.now();
		if (wait > 0) {
			entry.emitTimer = setTimeout(() => {
				entry.emitTimer = null;
				this.emit(entry);
			}, wait);
			return;
		}
		this.emit(entry);
	}

	private emit(entry: Entry): void {
		entry.lastEmit = Date.now();
		const value = entry.value;
		if (value === undefined) return;
		for (const listener of entry.listeners) {
			try {
				listener(value);
			} catch (err) {
				this.logger.warn(`listener for ${describeVar(entry.path)} threw`, err);
			}
		}
	}
}

function datumName(path: VarPath): string {
	return path.kind === "L" ? `L:${path.name}` : path.name;
}

function toNumber(v: number | string): number | null {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}
