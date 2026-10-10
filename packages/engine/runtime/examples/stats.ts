// Light consumer: calls a native capability through the SDK, compiling no engine.
// Run: bun run packages/engine/runtime/examples/stats.ts   (after `just yolo::runtime-build`)
import { Runtime } from "../src/index";

using runtime = Runtime.load();
console.log("build   :", runtime.buildInfo());
console.log("caps    :", runtime.capabilities());
console.log("stats   :", runtime.systemStats());

using op = runtime.startBenchmark(50_000_000);
const result = op.wait(10_000);
console.log("bench   :", result);
