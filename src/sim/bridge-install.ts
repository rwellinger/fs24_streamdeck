/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { cp, lstat, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { SimClient } from "./client";

/**
 * Self-install of the WASM bridge: copies the package bundled with the plugin
 * (`<plugin>/bridge/`, added by CI) into the MSFS Community folder. Triggered
 * from the PI ("WASM bridge" section); never runs on its own. A linked package
 * (symlink/junction — a dev setup) is reported but never touched.
 */

const PACKAGE = "fs24-streamdeck-bridge";
const BUNDLED = fileURLToPath(new URL(`../bridge/${PACKAGE}/`, import.meta.url));

type State =
	| "unsupported"
	| "no-bundle"
	| "no-community"
	| "missing"
	| "outdated"
	| "current"
	| "linked";

type Status = {
	state: State;
	bundled?: string;
	installed?: string;
	running?: string;
	community?: string;
	text: string;
	canInstall: boolean;
};

/** UserCfg.opt locations: MS Store first (the supported edition), then Steam. */
function userCfgCandidates(): string[] {
	const local = process.env.LOCALAPPDATA ?? "";
	const roaming = process.env.APPDATA ?? "";
	return [
		join(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),
		join(roaming, "Microsoft Flight Simulator 2024", "UserCfg.opt"),
	];
}

const FALLBACK_COMMUNITY = () =>
	join(
		process.env.LOCALAPPDATA ?? "",
		"Packages",
		"Microsoft.Limitless_8wekyb3d8bbwe",
		"LocalCache",
		"Packages",
		"Community",
	);

async function exists(path: string): Promise<boolean> {
	return lstat(path).then(
		() => true,
		() => false,
	);
}

async function findCommunity(): Promise<string | undefined> {
	for (const cfg of userCfgCandidates()) {
		const text = await readFile(cfg, "utf8").catch(() => "");
		const m = /^\s*InstalledPackagesPath\s+"([^"]+)"/m.exec(text);
		if (m) {
			const community = join(m[1], "Community");
			if (await exists(community)) return community;
		}
	}
	const fallback = FALLBACK_COMMUNITY();
	return (await exists(fallback)) ? fallback : undefined;
}

async function packageVersion(dir: string): Promise<string | undefined> {
	try {
		const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
			package_version?: unknown;
		};
		return typeof manifest.package_version === "string" ? manifest.package_version : undefined;
	} catch {
		return undefined;
	}
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return Math.sign(d);
	}
	return 0;
}

async function status(sim: SimClient): Promise<Status> {
	const running = sim.isConnected()
		? await sim.bridgeVersion().catch(() => undefined)
		: undefined;
	const runningText = running ? `running ${running}` : "not running";
	if (process.platform !== "win32") {
		return {
			state: "unsupported",
			running,
			text: `Self-install only on the sim PC (Windows) · ${runningText}`,
			canInstall: false,
		};
	}
	const bundled = await packageVersion(BUNDLED);
	if (!bundled) {
		return {
			state: "no-bundle",
			running,
			text: `This plugin build contains no bridge package · ${runningText}`,
			canInstall: false,
		};
	}
	const community = await findCommunity();
	if (!community) {
		return {
			state: "no-community",
			bundled,
			running,
			text: "MSFS Community folder not found (UserCfg.opt → InstalledPackagesPath)",
			canInstall: false,
		};
	}
	const target = join(community, PACKAGE);
	const info = await lstat(target).catch(() => undefined);
	const base = { bundled, running, community };
	if (!info) {
		return {
			...base,
			state: "missing",
			text: `Not installed · plugin has ${bundled}`,
			canInstall: true,
		};
	}
	const installed = await packageVersion(target);
	const parts = `installed ${installed ?? "?"} · ${runningText} · plugin has ${bundled}`;
	if (info.isSymbolicLink()) {
		return {
			...base,
			state: "linked",
			installed,
			text: `Linked package (left alone) · ${parts}`,
			canInstall: false,
		};
	}
	if (!installed || compareVersions(installed, bundled) < 0) {
		return {
			...base,
			state: "outdated",
			installed,
			text: `Update available · ${parts}`,
			canInstall: true,
		};
	}
	// MSFS loads standalone modules only at startup.
	const needsRestart = sim.isConnected() && running !== installed;
	return {
		...base,
		state: "current",
		installed,
		text: needsRestart
			? `Restart MSFS to activate bridge ${installed} · ${parts}`
			: `Up to date · ${parts}`,
		canInstall: false,
	};
}

async function install(sim: SimClient): Promise<string> {
	const s = await status(sim);
	if (!s.canInstall || !s.community) throw new Error(s.text);
	const target = join(s.community, PACKAGE);
	const staging = join(s.community, `.${PACKAGE}.installing`);
	await rm(staging, { recursive: true, force: true });
	await cp(BUNDLED, staging, { recursive: true });
	try {
		await rm(target, { recursive: true, force: true });
	} catch (err) {
		await rm(staging, { recursive: true, force: true });
		throw new Error(
			`cannot replace the installed bridge — close MSFS and retry (${(err as Error).message})`,
		);
	}
	await rename(staging, target);
	streamDeck.logger.info(`bridge ${s.bundled} installed to ${target}`);
	return `Installed ${s.bundled} — restart MSFS to load it`;
}

type Request = { type: "bridge-status" | "bridge-install" };

export function installBridgeInstallHandler(sim: SimClient): void {
	streamDeck.ui.onSendToPlugin<JsonValue>((ev) => {
		const req = ev.payload as Partial<Request> | null;
		if (req?.type !== "bridge-status" && req?.type !== "bridge-install") return;
		const reply = (payload: Record<string, JsonValue>) =>
			streamDeck.ui.sendToPropertyInspector({ type: "bridge", ...payload });
		const run =
			req.type === "bridge-install"
				? install(sim).then(
						async (message) => ({ ...(await status(sim)), message }),
						async (err: Error) => {
							streamDeck.logger.error("bridge install failed", err);
							return {
								...(await status(sim)),
								message: `Install failed: ${err.message}`,
							};
						},
					)
				: status(sim);
		run.then((s) => reply(s as unknown as Record<string, JsonValue>)).catch((err) =>
			streamDeck.logger.warn("bridge status failed", err),
		);
	});
}
