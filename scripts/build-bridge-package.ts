/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Assemble the Community package for the WASM bridge without fspackagetool:
// wasm/out/fs24-streamdeck-bridge/{manifest.json, layout.json, modules/*.wasm}.

import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

const NAME = "fs24-streamdeck-bridge";
const ROOT = join(import.meta.dirname, "..");
const WASM_DIR = join(ROOT, "wasm");
const PKG = join(WASM_DIR, "out", NAME);
const VERSION = readFileSync(join(WASM_DIR, "VERSION"), "utf8").trim();

// Windows FILETIME: 100 ns ticks since 1601-01-01 UTC. Exceeds 2^53, but both
// terms are multiples of 16, so the double stays exact (spacing 16 up to 2^57).
const FILETIME_EPOCH_OFFSET = 116444736000000000;
const toFiletime = (ms: number) => Math.trunc(ms) * 10000 + FILETIME_EPOCH_OFFSET;

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
	);
}

// Format follows packages built by Asobo's Package Builder (reference:
// MobiFlight event module 1.0.1): layout.json lists payload files only —
// neither manifest.json nor itself — and the manifest has no total size.
const manifest = {
	dependencies: [],
	content_type: "MISC",
	title: "fs24 Stream Deck Bridge",
	manufacturer: "",
	creator: "thWelly",
	package_version: VERSION,
	minimum_game_version: "1.0.0",
	release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
};

const wasm = join(WASM_DIR, "build", `${NAME}.wasm`);
rmSync(PKG, { recursive: true, force: true });
mkdirSync(join(PKG, "modules"), { recursive: true });
copyFileSync(wasm, join(PKG, "modules", `${NAME}.wasm`));

const content = walk(PKG)
	.map((file) => {
		const st = statSync(file);
		return {
			path: relative(PKG, file).split(sep).join("/"),
			size: st.size,
			date: toFiletime(st.mtimeMs),
		};
	})
	.sort((a, b) => a.path.localeCompare(b.path));

writeFileSync(join(PKG, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(PKG, "layout.json"), `${JSON.stringify({ content }, null, 2)}\n`);
console.log(`${NAME} ${VERSION} → ${relative(ROOT, PKG)}`);
