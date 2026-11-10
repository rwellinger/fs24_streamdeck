# WASM bridge build — stock LLVM against the MSFS SDK's wasi-sysroot.
# Flags mirror the SDK toolset (WASM/vs/2022/Microsoft.Cpp.MSFS.Common.targets);
# deviations are documented in docs/research/wasm-bridge.md.

SDK_DIR  ?= ../sdk/current
LLVM_BIN ?= $(firstword $(wildcard /opt/homebrew/opt/llvm/bin) /usr/bin)
LLD_BIN  ?= $(firstword $(wildcard /opt/homebrew/opt/lld/bin) /usr/bin)
CXX      := $(LLVM_BIN)/clang++
WASM_LD  := $(LLD_BIN)/wasm-ld

VERSION  := $(shell cat VERSION)
NAME     := fs24-streamdeck-bridge
SYSROOT  := $(SDK_DIR)/WASM/wasi-sysroot
LIBDIR   := $(SYSROOT)/lib/wasm32-wasi

BUILD    := build
OUT      := $(BUILD)/$(NAME).wasm
OBJS     := $(BUILD)/bridge.o

CXXFLAGS := --target=wasm32-unknown-wasi --sysroot=$(SYSROOT) \
	-mcpu=mvp -mbulk-memory \
	-std=c++20 -O3 -fstack-size-section -fvisibility=hidden \
	-ffunction-sections -fdata-sections -fno-stack-protector -fno-exceptions \
	-fms-extensions -fwritable-strings -Werror=return-type \
	-Wall -Wno-deprecated -Wno-ignored-attributes -Wno-unused-function -Wno-unused-command-line-argument \
	-D_MSFS_WASM -DBRIDGE_VERSION='"$(VERSION)"' \
	-I$(SDK_DIR)/WASM/include -I$(SDK_DIR)/SimConnect/include

LDFLAGS20 := --no-entry --allow-undefined --export-dynamic \
	--export malloc --export free --export __wasm_call_ctors --export-table \
	--export mallinfo --export mchunkit_begin --export mchunkit_next \
	--export get_pages_state --export mark_decommit_pages \
	--strip-debug --gc-sections -O3 -L$(LIBDIR)
LIBS20    := -lc++ -lc++abi -lc $(LIBDIR)/libclang_rt.builtins-wasm32.a -lc

# MSFS_WasmVersions.a marks the module as a 2024 module.
LDFLAGS  := $(LDFLAGS20) \
	--export GetSimConnectVersion --export GetExtensionVersion --export GetExtensionVersionBuffer
LIBS     := $(LIBS20) $(SDK_DIR)/WASM/WasmVersions/MSFS_WasmVersions.a

# Loader probes (temporary, M03 diagnosis): empty module as 2024/2020 module,
# full bridge as 2020 module with H:-events via RPN.
PROBES   := $(BUILD)/fs24-probe-empty24.wasm $(BUILD)/fs24-probe-empty20.wasm \
	$(BUILD)/fs24-probe-bridge20.wasm

.PHONY: all probes clean
all: $(OUT)
probes: $(PROBES)

$(BUILD)/%.o: src/%.cpp VERSION | $(BUILD)
	@test -f $(SDK_DIR)/.complete || { echo "MSFS SDK missing — run 'make sdk' first"; exit 1; }
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(BUILD)/bridge20.o: src/bridge.cpp VERSION | $(BUILD)
	$(CXX) $(CXXFLAGS) -DBRIDGE_HEVENT_VIA_RPN -c $< -o $@

$(OUT): $(OBJS)
	$(WASM_LD) $(LDFLAGS) $(OBJS) $(LIBS) -o $@

$(BUILD)/fs24-probe-empty24.wasm: $(BUILD)/probe_empty.o
	$(WASM_LD) $(LDFLAGS) $< $(LIBS) -o $@

$(BUILD)/fs24-probe-empty20.wasm: $(BUILD)/probe_empty.o
	$(WASM_LD) $(LDFLAGS20) $< $(LIBS20) -o $@

$(BUILD)/fs24-probe-bridge20.wasm: $(BUILD)/bridge20.o
	$(WASM_LD) $(LDFLAGS20) $< $(LIBS20) -o $@

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD) out
