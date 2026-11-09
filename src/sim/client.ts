/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { EventEmitter } from "node:events";
import {
	type ConnectionHandle,
	EventFlag,
	open,
	Protocol,
	type RecvException,
	SimConnectConstants,
} from "node-simconnect";

import { describeVar, type VarPath } from "./path";
import { type VarConnection, type VarListener, VarRegistry } from "./vars";

export type SimTarget = { host: string; port: number } | null;

type Logger = {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

type ClientEvents = {
	online: [];
	offline: [];
	connected: [appName: string];
	disconnected: [];
	aircraftChanged: [];
};

const APP_NAME = "fs24_streamdeck";
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 10000;
// node-simconnect only times out after the TCP handshake; an unreachable host
// would otherwise hang for the OS SYN timeout (~75 s on macOS).
const OPEN_TIMEOUT_MS = 6000;
// Grace period before "offline" so a quick reconnect doesn't flash the tile.
const OFFLINE_DELAY_MS = 3000;
const BARRIER_TIMEOUT_MS = 2000;
const READ_TIMEOUT_MS = 1500;
// NotificationPriority.HIGHEST — const enum in node-simconnect's typings.
const PRIORITY_HIGHEST = 1;
// Fixed client event IDs for system events; K:-event IDs start above them.
const SYSTEM_EVENT_AIRCRAFT_LOADED = 1;
const SYSTEM_EVENT_SIM_START = 2;
const FIRST_K_EVENT_ID = 100;
// AircraftLoaded and SimStart arrive together on a flight load.
const AIRCRAFT_REFRESH_DEBOUNCE_MS = 500;

/**
 * SimConnect wrapper: owns one connection, reconnects with backoff, maps
 * K:-event names lazily and multiplexes A:/L:/B: subscriptions (VarRegistry).
 * All SimConnect IDs are connection-scoped, so every cache is dropped on
 * disconnect and subscriptions are re-registered on the next connect.
 */
export class SimClient extends EventEmitter<ClientEvents> {
	private handle: ConnectionHandle | null = null;
	private target: SimTarget = null;
	private started = false;
	private connecting = false;
	private generation = 0;
	private reconnectDelay = RECONNECT_INITIAL_MS;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private offlineTimer: NodeJS.Timeout | null = null;
	private offlineEmitted = false;

	private eventIds = new Map<string, number>();
	private nextEventId = FIRST_K_EVENT_ID;
	private nextRequestId = 1;
	private readonly pendingBarriers = new Map<number, () => void>();
	private readonly sendErrors = new Map<number, (err: Error) => void>();
	private aircraftTimer: NodeJS.Timeout | null = null;
	private readonly vars: VarRegistry;

	constructor(private readonly logger: Logger) {
		super();
		this.vars = new VarRegistry(logger);
	}

	/** Subscribe to a var; returns the unsubscribe function. */
	subscribe(path: VarPath, listener: VarListener): () => void {
		return this.vars.subscribe(path, listener);
	}

	/** Last known value; `undefined` = no data yet, `null` = unresolvable. */
	peek(path: VarPath): number | null | undefined {
		return this.vars.peek(path);
	}

	/**
	 * One-shot read (press conditions, PI live preview). Uses the cached value
	 * of an existing subscription, else subscribes briefly. Rejects when the
	 * var is unknown or no value arrives in time.
	 */
	read(path: VarPath, timeoutMs = READ_TIMEOUT_MS): Promise<number> {
		if (!this.handle) return Promise.reject(new Error("SimConnect not connected"));
		const cached = this.vars.peek(path);
		if (typeof cached === "number") return Promise.resolve(cached);
		return new Promise<number>((resolve, reject) => {
			let unsubscribe: (() => void) | undefined;
			let done = false;
			const finish = (fn: () => void) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				queueMicrotask(() => unsubscribe?.());
				fn();
			};
			const timer = setTimeout(
				() => finish(() => reject(new Error(`no value for ${describeVar(path)}`))),
				timeoutMs,
			);
			unsubscribe = this.vars.subscribe(path, (v) =>
				finish(() =>
					v === null ? reject(new Error(`unknown ${describeVar(path)}`)) : resolve(v),
				),
			);
			if (done) unsubscribe();
		});
	}

	async write(path: VarPath, value: number): Promise<void> {
		await this.vars.write(path, value);
		this.logger.info(`write ${describeVar(path)} = ${value}`);
	}

	connect(): void {
		if (this.started) return;
		this.started = true;
		this.scheduleOffline();
		this.tryConnect();
	}

	setTarget(target: SimTarget): void {
		if (sameTarget(this.target, target)) return;
		this.target = target;
		this.logger.info(`SimConnect target: ${describeTarget(target)}`);
		if (!this.started) return;
		this.dropConnection();
		this.reconnectDelay = RECONNECT_INITIAL_MS;
		this.tryConnect();
	}

	isOffline(): boolean {
		return this.offlineEmitted;
	}

	isConnected(): boolean {
		return this.handle !== null;
	}

	/**
	 * Fires a K:-event on the user aircraft. Unknown names are detected on the
	 * first use via a SimConnect round-trip and rejected.
	 */
	async transmitEvent(name: string, value = 0): Promise<void> {
		const handle = this.handle;
		if (!handle) throw new Error("SimConnect not connected");
		const eventName = normalizeEventName(name);
		if (!eventName) throw new Error("empty event name");

		let id = this.eventIds.get(eventName);
		if (id === undefined) {
			id = await this.mapEvent(handle, eventName);
		}
		handle.transmitClientEvent(
			SimConnectConstants.OBJECT_ID_USER,
			id,
			value,
			PRIORITY_HIGHEST,
			EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
		);
	}

	private async mapEvent(handle: ConnectionHandle, eventName: string): Promise<number> {
		const id = this.nextEventId++;
		const failed = new Promise<never>((_, reject) => {
			this.sendErrors.set(handle.mapClientEventToSimEvent(id, eventName), reject);
		});
		await Promise.race([failed, this.barrier(handle)]);
		if (this.handle !== handle) throw new Error("disconnected");
		this.eventIds.set(eventName, id);
		return id;
	}

	/**
	 * SimConnect processes requests in order, so the answer to a trivial
	 * system-state request proves every earlier request was accepted (an
	 * exception would have arrived first).
	 */
	private barrier(handle: ConnectionHandle): Promise<void> {
		const requestId = this.nextRequestId++;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingBarriers.delete(requestId);
				reject(new Error("SimConnect barrier timeout"));
			}, BARRIER_TIMEOUT_MS);
			this.pendingBarriers.set(requestId, () => {
				clearTimeout(timer);
				resolve();
			});
			handle.requestSystemState(requestId, "Sim");
		});
	}

	private tryConnect(): void {
		if (this.connecting || this.handle) return;
		this.connecting = true;
		const generation = ++this.generation;
		const target = this.target;
		const options = target ? { remote: target } : undefined;

		let timer: NodeJS.Timeout | null = null;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("connect timeout")), OPEN_TIMEOUT_MS);
		});
		const opening = open(APP_NAME, Protocol.KittyHawk, options);

		Promise.race([opening, timeout])
			.then(({ recvOpen, handle }) => {
				if (generation !== this.generation) {
					handle.close();
					return;
				}
				this.attach(handle);
				const app = `${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`;
				this.logger.info(`SimConnect connected: ${app} via ${describeTarget(target)}`);
				this.emit("connected", app);
			})
			.catch((err: unknown) => {
				opening.then(({ handle }) => handle.close()).catch(() => {});
				if (generation !== this.generation) return;
				this.logger.warn(
					`SimConnect connect failed (${describeTarget(target)}): ${errText(err)}`,
				);
				this.scheduleReconnect();
			})
			.finally(() => {
				if (timer) clearTimeout(timer);
				if (generation === this.generation) this.connecting = false;
			});
	}

	private attach(handle: ConnectionHandle): void {
		this.handle = handle;
		this.reconnectDelay = RECONNECT_INITIAL_MS;
		this.cancelOffline();

		handle.on("exception", (ex: RecvException) => this.onException(ex));
		handle.on("systemState", (state) => {
			this.pendingBarriers.get(state.requestID)?.();
			this.pendingBarriers.delete(state.requestID);
		});
		handle.on("eventFilename", (ev) => {
			if (ev.clientEventId === SYSTEM_EVENT_AIRCRAFT_LOADED) {
				this.logger.info(`aircraft loaded: ${ev.fileName}`);
				this.scheduleAircraftRefresh();
			}
		});
		handle.on("event", (ev) => {
			if (ev.clientEventId === SYSTEM_EVENT_SIM_START) this.scheduleAircraftRefresh();
		});
		handle.subscribeToSystemEvent(SYSTEM_EVENT_AIRCRAFT_LOADED, "AircraftLoaded");
		handle.subscribeToSystemEvent(SYSTEM_EVENT_SIM_START, "SimStart");

		const conn: VarConnection = {
			handle,
			onSendError: (sendId, onError) => this.sendErrors.set(sendId, onError),
			barrier: () => this.barrier(handle),
		};
		this.vars.attach(conn);
		handle.on("quit", () => this.onLost(handle, "sim quit"));
		handle.on("close", () => this.onLost(handle, "socket closed"));
		handle.on("error", (err) => this.onLost(handle, errText(err)));
	}

	private onException(ex: RecvException): void {
		const reject = this.sendErrors.get(ex.sendId);
		if (reject) {
			this.sendErrors.delete(ex.sendId);
			reject(new Error(`SimConnect exception ${ex.exceptionName} (${ex.exception})`));
			return;
		}
		this.logger.warn(
			`SimConnect exception ${ex.exceptionName} (${ex.exception}) sendId=${ex.sendId} index=${ex.index}`,
		);
	}

	private onLost(handle: ConnectionHandle, reason: string): void {
		if (this.handle !== handle) return;
		this.logger.info(`SimConnect disconnected: ${reason}`);
		this.dropConnection();
		this.emit("disconnected");
		this.scheduleReconnect();
	}

	private dropConnection(): void {
		this.generation++;
		this.connecting = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const handle = this.handle;
		this.handle = null;
		this.eventIds = new Map();
		this.nextEventId = FIRST_K_EVENT_ID;
		this.pendingBarriers.clear();
		const errors = [...this.sendErrors.values()];
		this.sendErrors.clear();
		for (const reject of errors) reject(new Error("disconnected"));
		if (this.aircraftTimer) {
			clearTimeout(this.aircraftTimer);
			this.aircraftTimer = null;
		}
		this.vars.detach();
		if (handle) {
			handle.removeAllListeners("close");
			handle.removeAllListeners("quit");
			handle.on("error", () => {});
			handle.close();
		}
		this.scheduleOffline();
	}

	private scheduleAircraftRefresh(): void {
		if (this.aircraftTimer) clearTimeout(this.aircraftTimer);
		this.aircraftTimer = setTimeout(() => {
			this.aircraftTimer = null;
			this.vars.refreshForAircraft();
			this.emit("aircraftChanged");
		}, AIRCRAFT_REFRESH_DEBOUNCE_MS);
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		const delay = this.reconnectDelay;
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.tryConnect();
		}, delay);
	}

	private scheduleOffline(): void {
		if (this.offlineEmitted || this.offlineTimer) return;
		this.offlineTimer = setTimeout(() => {
			this.offlineTimer = null;
			if (this.handle) return;
			this.offlineEmitted = true;
			this.logger.info("SimConnect offline");
			this.emit("offline");
		}, OFFLINE_DELAY_MS);
	}

	private cancelOffline(): void {
		if (this.offlineTimer) {
			clearTimeout(this.offlineTimer);
			this.offlineTimer = null;
		}
		if (this.offlineEmitted) {
			this.offlineEmitted = false;
			this.emit("online");
		}
	}
}

export function normalizeEventName(name: string): string {
	return name.trim().replace(/^K:/i, "").toUpperCase();
}

function sameTarget(a: SimTarget, b: SimTarget): boolean {
	if (a === null || b === null) return a === b;
	return a.host === b.host && a.port === b.port;
}

function describeTarget(t: SimTarget): string {
	return t ? `${t.host}:${t.port}` : "local (autodetect)";
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
