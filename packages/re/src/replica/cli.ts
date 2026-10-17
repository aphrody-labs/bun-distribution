// `re replica`, `re ghidra-win` and `re magika`: the Bun OS RE commands formerly hosted by bun-engine.
import { basename, extname, resolve } from "node:path";
import { buildGhidraWindows, inspectPeForGhidra, probeGhidraWindows } from "../ghidra/windows.js";
import { identifyWithMagika, setupMagika } from "../ml/magika.js";
import { initializeReplicaInput } from "./input.js";
import { inspectNdsReplica } from "./nds.js";
import { replicaPipeline } from "./pipeline.js";
import { listReplicaSkills, readReplicaSkill } from "./skills.js";

const varReplica = resolve(import.meta.dir, "..", "..", "..", "..", "var", "replica");

function print(value: unknown): number {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return 0;
}

/** `re replica skills | skill <name> | pipeline | nds <rom> | init <rom> [output]` */
export async function main(argv: string[]): Promise<number> {
  const [command, input, output] = argv;
  if (command === "skills") return print(await listReplicaSkills());
  if (command === "skill" && input) return print(await readReplicaSkill(input));
  if (command === "pipeline") return print(await replicaPipeline());
  if (command === "nds" && input) return print(await inspectNdsReplica(input));
  if (command === "init" && input)
    return print(await initializeReplicaInput(input, output ?? resolve(varReplica, basename(input, extname(input)))));
  console.error("usage: re replica skills | skill <name> | pipeline | nds <rom.nds> | init <rom.nds> [output]");
  return 2;
}

/** `re ghidra-win probe | inspect <pe> | build` */
export async function ghidraMain(argv: string[]): Promise<number> {
  const [command, input] = argv;
  if (command === "probe") return print(await probeGhidraWindows());
  if (command === "inspect" && input) return print(await inspectPeForGhidra(input));
  if (command === "build") return buildGhidraWindows();
  console.error("usage: re ghidra-win probe | inspect <pe> | build");
  return 2;
}

/** `re magika setup | identify <path>` */
export async function magikaMain(argv: string[]): Promise<number> {
  const [command, input] = argv;
  if (command === "setup") return setupMagika();
  if (command === "identify" && input) return print(await identifyWithMagika(input));
  console.error("usage: re magika setup | identify <path>");
  return 2;
}
