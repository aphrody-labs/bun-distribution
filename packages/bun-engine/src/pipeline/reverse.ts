import { ghidraRoot, ntrGhidraRoot } from "../re/ghidra";

export const reverseEngineeringPipeline = {
  owner: "bun-engine-core::reverse",
  windowsHost: "bun:windows",
  stages: [
    { id: "inspect-pe", owner: "bun:windows.pe", input: "PE32/PE32+" },
    { id: "decompile-rust", owner: "crates/ghidra-decompiler", input: "PE/ELF/Mach-O" },
    { id: "analyze-ghidra", owner: ghidraRoot, input: "multi-architecture binaries" },
    { id: "load-ntr", owner: ntrGhidraRoot, input: "Nintendo DS/DSi ROM" },
  ],
} as const;
