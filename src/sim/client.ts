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
// NotificationPriority.HIGHEST — const enum in node-simconnect's typings.
const PRIORITY_HIGHEST = 1;

/**
 * Thin SimConnect wrapper: owns one connection, reconnects with backoff, maps
 * K:-event names lazily. All SimConnect IDs are connection-scoped, so every
 * cache is dropped on disconnect.
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
	private nextEventId = 1;
	private nextRequestId = 1;
	private readonly pendingBarriers = new Map<number, () => void>();
	private readonly pendingMappings = new Map<number, (err: Error) => void>();

	constructor(private readonly logger: Logger) {
		super();
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
		let sendId = -1;
		const failed = new Promise<never>((_, reject) => {
			sendId = handle.mapClientEventToSimEvent(id, eventName);
			this.pendingMappings.set(sendId, reject);
		});
		try {
			await Promise.race([failed, this.barrier(handle)]);
		} finally {
			this.pendingMappings.delete(sendId);
		}
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
		handle.on("quit", () => this.onLost(handle, "sim quit"));
		handle.on("close", () => this.onLost(handle, "socket closed"));
		handle.on("error", (err) => this.onLost(handle, errText(err)));
	}

	private onException(ex: RecvException): void {
		const reject = this.pendingMappings.get(ex.sendId);
		if (reject) {
			this.pendingMappings.delete(ex.sendId);
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
		this.nextEventId = 1;
		this.pendingBarriers.clear();
		for (const reject of this.pendingMappings.values()) reject(new Error("disconnected"));
		this.pendingMappings.clear();
		if (handle) {
			handle.removeAllListeners("close");
			handle.removeAllListeners("quit");
			handle.on("error", () => {});
			handle.close();
		}
		this.scheduleOffline();
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
