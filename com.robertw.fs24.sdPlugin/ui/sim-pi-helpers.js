/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Shared property-inspector helpers:
//   - live preview of a var / event field: the PI can't reach SimConnect, so
//     it asks the plugin ("probe", see src/sim/probe.ts) and shows the answer
//   - show/hide items depending on a select's value
//   - "WASM bridge" section: status + self-install (src/sim/bridge-install.ts)
(() => {
	const DEBOUNCE_MS = 400;
	const REFRESH_MS = 1000;

	const client = () => window.SDPIComponents?.streamDeckClient;

	const findInner = (el, tag) => el.shadowRoot?.querySelector(tag) || el.querySelector(tag);

	const waitForInner = async (el, tag = "input", retries = 40) => {
		for (let i = 0; i < retries; i++) {
			const inner = findInner(el, tag);
			if (inner) return inner;
			await new Promise((r) => setTimeout(r, 50));
		}
		return null;
	};

	const previews = new Map();
	let subscribed = false;

	const ensureSubscribed = () => {
		if (subscribed || !client()) return;
		subscribed = true;
		client().sendToPropertyInspector.subscribe((ev) => {
			const p = ev?.payload;
			if (!p || p.type !== "probe") return;
			const el = previews.get(p.field);
			if (!el) return;
			el.textContent = p.text;
			el.dataset.state = p.state;
		});
	};

	/**
	 * @param fieldId  id of the sdpi-textfield
	 * @param previewId id of the element that shows the result
	 * @param kind "var" (A:/L:/B: — polls the live value), "event" (K:/H:/RPN:
	 *             press action; H:/RPN: also report the WASM bridge) or "kevent"
	 *             (K:-event name only)
	 */
	const attachProbe = async (fieldId, previewId, kind = "var") => {
		const field = document.getElementById(fieldId);
		const preview = document.getElementById(previewId);
		if (!field || !preview) return;
		ensureSubscribed();
		previews.set(fieldId, preview);
		const inner = await waitForInner(field);
		if (!inner) return;

		let timer = null;
		const send = () => {
			const text = inner.value.trim();
			if (!text) {
				preview.textContent = "";
				return;
			}
			client()
				?.send("sendToPlugin", { type: "probe", field: fieldId, kind, text })
				.catch(() => {});
		};
		let debounce = null;
		const restart = () => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				if (timer) clearInterval(timer);
				send();
				if (kind === "var") timer = setInterval(send, REFRESH_MS);
			}, DEBOUNCE_MS);
		};
		inner.addEventListener("input", restart);
		if (inner.value.trim()) restart();
	};

	/**
	 * Shows each item only for the select values listed for it.
	 * @param selectId id of the sdpi-select
	 * @param rules { itemId: ["valueA", "valueB"], ... }
	 * @param fallback value assumed while the select is still empty
	 */
	const showWhen = async (selectId, rules, fallback) => {
		const select = document.getElementById(selectId);
		if (!select) return;
		const inner = await waitForInner(select, "select");
		const apply = () => {
			const v = inner?.value || select.value || fallback;
			for (const [itemId, values] of Object.entries(rules)) {
				const item = document.getElementById(itemId);
				if (item) item.style.display = values.includes(v) ? "" : "none";
			}
		};
		inner?.addEventListener("change", apply);
		select.addEventListener("change", apply);
		apply();
		// sdpi fills the select asynchronously from the saved settings.
		setTimeout(apply, 300);
	};

	/** Appends the "WASM bridge (all buttons)" section to the PI. */
	const attachBridgeInstaller = () => {
		const section = document.createElement("details");
		section.innerHTML = `
			<summary>WASM bridge (all buttons)</summary>
			<div class="hint" id="bridgeStatus">checking…</div>
			<sdpi-item label="">
				<sdpi-button id="bridgeInstall" disabled>Install / update bridge</sdpi-button>
			</sdpi-item>
			<div class="hint">Needed for H: and RPN: on the sim PC. Copies the bridge into the MSFS Community folder — restart MSFS afterwards.</div>`;
		document.body.appendChild(section);
		const statusEl = section.querySelector("#bridgeStatus");
		const button = section.querySelector("#bridgeInstall");
		const ask = (type) => client()?.send("sendToPlugin", { type }).catch(() => {});

		client()?.sendToPropertyInspector.subscribe((ev) => {
			const p = ev?.payload;
			if (!p || p.type !== "bridge") return;
			statusEl.textContent = p.message ? `${p.message} · ${p.text}` : p.text;
			if (p.canInstall) button.removeAttribute("disabled");
			else button.setAttribute("disabled", "");
		});
		button.addEventListener("click", () => {
			button.setAttribute("disabled", "");
			statusEl.textContent = "installing…";
			ask("bridge-install");
		});
		section.addEventListener("toggle", () => {
			if (section.open) ask("bridge-status");
		});
	};

	window.SimPI = { attachProbe, showWhen, attachBridgeInstaller };
})();
