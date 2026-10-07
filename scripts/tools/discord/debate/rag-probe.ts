// SPDX-License-Identifier: Apache-2.0
import { searchLocalRag } from "../../../../packages/discord/kit/src/lab/local-rag.ts";

if (import.meta.main) {
  const config = process.argv[2];
  if (!config) throw new Error("Protected MCP config required");
  try {
    const payload = await searchLocalRag({ config, server: "shenron-rag" }, "Son Goku", 6);
    console.log(
      JSON.stringify({
        nativeFfiRag: true,
        sourceCount: payload.results.length,
        sourceIds: payload.results.map((item) => item.sourceId),
      }),
    );
    if (payload.results.length !== 6) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const failureClass = /manifest|artifact|hash\/size/i.test(message)
      ? "artifact-admission"
      : /symbol|dlopen|ABI/i.test(message)
        ? "native-binding"
        : /timeout|deadline/i.test(message)
          ? "deadline"
          : "rag-unavailable";
    console.log(
      JSON.stringify({
        nativeFfiRag: false,
        error: error instanceof Error ? error.name : "Error",
        failureClass,
      }),
    );
    process.exitCode = 1;
  }
}
