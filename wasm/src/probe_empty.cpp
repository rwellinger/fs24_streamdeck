/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// Loader probe: does nothing. Tells toolchain/link problems apart from
// problems in the bridge code (see docs/research/wasm-bridge.md).

#include <MSFS/MSFS.h>

extern "C" MSFS_CALLBACK void module_init(void) {}
extern "C" MSFS_CALLBACK void module_deinit(void) {}
