/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

import { action, SingletonAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

// Decorative no-op tile. Holds a slot on the deck so the user can assign a
// generated background image; press does nothing, no feedback, no offline
// indicator — it stays inert in every state by design.
@action({ UUID: "com.robertw.fs24.background" })
export class Background extends SingletonAction<JsonObject> {}
