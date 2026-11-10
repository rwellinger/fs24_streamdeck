/*
 * fs24_streamdeck - Stream Deck plugin for MSFS 2024
 * Copyright (c) 2026 thWelly
 *
 * Licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

// In-sim bridge: fires H:-events and executes RPN for the Stream Deck plugin.
// Protocol: docs/research/wasm-bridge.md. Event-driven only (ClientData
// ON_SET) — nothing runs while no command arrives.

#include <MSFS/Legacy/gauges.h>
#include <MSFS/MSFS.h>
#include <MSFS/MSFS_Events.h>
#include <SimConnect.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_map>

#ifndef BRIDGE_VERSION
#error "BRIDGE_VERSION must be defined by the build"
#endif

namespace {

constexpr uint32_t PROTOCOL_VERSION = 1;
constexpr const char* AREA_CMD = "fs24.bridge.cmd";
constexpr const char* AREA_RSP = "fs24.bridge.rsp";

enum : SIMCONNECT_CLIENT_DATA_ID { CD_CMD = 0, CD_RSP = 1 };
enum : SIMCONNECT_CLIENT_DATA_DEFINITION_ID { DEF_CMD = 0, DEF_RSP = 1 };
enum : SIMCONNECT_DATA_REQUEST_ID { REQ_CMD = 0 };

enum Op : uint32_t { OP_PING = 1, OP_HEVENT = 2, OP_RPN = 3 };

enum Status : int32_t {
	ST_OK = 0,
	ST_UNKNOWN_OP = 1,
	ST_EMPTY_ARG = 2,
	ST_HEVENT_REGISTER = 3,
	ST_HEVENT_CALL = 4,
	ST_RPN_FAILED = 5,
};

struct Command {
	uint32_t seq;
	uint32_t op;
	char arg[1024];
};

struct Response {
	uint32_t seq;
	int32_t status;
	double value;
	char text[256];
};

static_assert(sizeof(Command) == 1032, "protocol: command layout");
static_assert(sizeof(Response) == 272, "protocol: response layout");

HANDLE sim = 0;
std::unordered_map<std::string, FsHEventId> hEvents;

void setText(Response& r, const char* s) {
	if (!s) return;
	std::strncpy(r.text, s, sizeof(r.text) - 1);
	r.text[sizeof(r.text) - 1] = '\0';
}

void fireHEvent(const char* name, Response& r) {
	auto it = hEvents.find(name);
	FsHEventId id;
	if (it != hEvents.end()) {
		id = it->second;
	} else {
		id = fsEventsRegisterHEvent(name);
		if (id == FS_EVENT_INVALID_ID) {
			r.status = ST_HEVENT_REGISTER;
			return;
		}
		hEvents.emplace(name, id);
	}
	FsEventsError err = fsEventsHEventCall(id, FsVarParamArray{});
	if (err != FS_EVENTS_ERROR_NONE) {
		r.status = ST_HEVENT_CALL;
		r.value = static_cast<double>(err);
	}
}

void runRpn(const char* code, Response& r) {
	FLOAT64 f = 0;
	SINT32 i = 0;
	PCSTRINGZ s = nullptr;
	if (!execute_calculator_code(code, &f, &i, &s)) {
		r.status = ST_RPN_FAILED;
		return;
	}
	r.value = f;
	setText(r, s);
}

void handle(const Command& in) {
	if (in.seq == 0) return;
	Command cmd = in;
	cmd.arg[sizeof(cmd.arg) - 1] = '\0';

	Response r{};
	r.seq = cmd.seq;
	r.status = ST_OK;

	switch (cmd.op) {
	case OP_PING:
		r.value = PROTOCOL_VERSION;
		setText(r, BRIDGE_VERSION);
		break;
	case OP_HEVENT:
	case OP_RPN:
		if (cmd.arg[0] == '\0') {
			r.status = ST_EMPTY_ARG;
		} else if (cmd.op == OP_HEVENT) {
			fireHEvent(cmd.arg, r);
		} else {
			runRpn(cmd.arg, r);
		}
		break;
	default:
		r.status = ST_UNKNOWN_OP;
		break;
	}

	if (r.status != ST_OK) {
		fprintf(stderr, "[fs24-bridge] op %u '%s' failed: status %d\n", cmd.op, cmd.arg, r.status);
	}
	SimConnect_SetClientData(sim, CD_RSP, DEF_RSP, SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT, 0,
	                         sizeof(r), &r);
}

void CALLBACK dispatch(SIMCONNECT_RECV* recv, DWORD, void*) {
	switch (recv->dwID) {
	case SIMCONNECT_RECV_ID_CLIENT_DATA: {
		auto* data = static_cast<SIMCONNECT_RECV_CLIENT_DATA*>(recv);
		if (data->dwRequestID == REQ_CMD) {
			handle(*reinterpret_cast<const Command*>(&data->dwData));
		}
		break;
	}
	case SIMCONNECT_RECV_ID_EXCEPTION: {
		auto* ex = static_cast<SIMCONNECT_RECV_EXCEPTION*>(recv);
		fprintf(stderr, "[fs24-bridge] SimConnect exception %lu (send id %lu, index %lu)\n",
		        ex->dwException, ex->dwSendID, ex->dwIndex);
		break;
	}
	default:
		break;
	}
}

bool setUp() {
	return SUCCEEDED(SimConnect_MapClientDataNameToID(sim, AREA_CMD, CD_CMD)) &&
	       SUCCEEDED(SimConnect_CreateClientData(sim, CD_CMD, sizeof(Command),
	                                             SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT)) &&
	       SUCCEEDED(SimConnect_MapClientDataNameToID(sim, AREA_RSP, CD_RSP)) &&
	       SUCCEEDED(SimConnect_CreateClientData(sim, CD_RSP, sizeof(Response),
	                                             SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY)) &&
	       SUCCEEDED(SimConnect_AddToClientDataDefinition(sim, DEF_CMD, 0, sizeof(Command))) &&
	       SUCCEEDED(SimConnect_AddToClientDataDefinition(sim, DEF_RSP, 0, sizeof(Response))) &&
	       SUCCEEDED(SimConnect_RequestClientData(sim, CD_CMD, REQ_CMD, DEF_CMD,
	                                              SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET,
	                                              SIMCONNECT_CLIENT_DATA_REQUEST_FLAG_DEFAULT)) &&
	       SUCCEEDED(SimConnect_CallDispatch(sim, dispatch, nullptr));
}

}  // namespace

extern "C" MSFS_CALLBACK void module_init(void) {
	if (FAILED(SimConnect_Open(&sim, "fs24-streamdeck-bridge", nullptr, 0, 0, 0))) {
		fprintf(stderr, "[fs24-bridge] SimConnect_Open failed\n");
		return;
	}
	if (!setUp()) {
		fprintf(stderr, "[fs24-bridge] ClientData setup failed\n");
		return;
	}
	fprintf(stdout, "[fs24-bridge] %s ready (protocol %u)\n", BRIDGE_VERSION, PROTOCOL_VERSION);
}

extern "C" MSFS_CALLBACK void module_deinit(void) {
	if (sim) SimConnect_Close(sim);
	sim = 0;
	hEvents.clear();
}
