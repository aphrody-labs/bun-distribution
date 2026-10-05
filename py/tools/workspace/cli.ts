// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { supervise, type MeasureOptions } from "./supervisor.ts";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const python = ["uv", "run", "--locked", "python", "tools/packaging/modernize_workspace.py"];
export const commands = {
  build: [...python, "apply"],
  check: [...python, "check"],
  locks: [...python, "locks"],
  distributions: [...python, "distributions"],
  providers: [...python, "providers"],
  test: ["uv", "run", "--locked", "--no-sync", "pytest"],
  lint: ["uv", "run", "--locked", "--no-sync", "ruff", "check", "."],
  fmt: ["uv", "run", "--locked", "--no-sync", "ruff", "format", "."],
  "format:check": ["uv", "run", "--locked", "--no-sync", "ruff", "format", "--check", "."],
  typecheck: ["uv", "run", "--locked", "--no-sync", "mypy"],
} satisfies Record<string, string[]>;

export async function measure(command: string[], cwd: string = root, options: MeasureOptions = {}) {
  return supervise(command, cwd, options);
}

export async function main(args: string[], options: MeasureOptions = {}): Promise<number> {
  args = [...args];
  const timeoutFlag = args.indexOf("--timeout-ms");
  if (timeoutFlag >= 0) {
    const timeoutMs = Number(args[timeoutFlag + 1]);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      console.log(JSON.stringify({ schemaVersion: 2, success: false, error: "Invalid timeout" }));
      return 2;
    }
    args.splice(timeoutFlag, 2);
    options = { ...options, timeoutMs };
  }
  let [action, ...extra] = args;
  // Preserve the existing CI invocation: bun run fmt -- --check.
  if (action === "fmt" && (extra.join(" ") === "-- --check" || extra.join(" ") === "--check")) {
    action = "format:check";
    extra = [];
  }
  if (args.length === 0 || action === "plan" || action === "--help" || action === "-h") {
    if (extra.length) {
      console.log(
        JSON.stringify({ schemaVersion: 2, success: false, error: "Unexpected arguments" }),
      );
      return 2;
    }
    console.log(
      JSON.stringify(
        {
          schemaVersion: 2,
          usage: "bun tools/workspace/cli.ts <plan|command> [--timeout-ms <positive integer>]",
          root,
          commands,
          success: true,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (!action || !Object.hasOwn(commands, action) || extra.length) {
    console.log(
      JSON.stringify({
        schemaVersion: 2,
        success: false,
        error: "Unknown command or unexpected arguments",
      }),
    );
    return 2;
  }
  const result = await measure(commands[action as keyof typeof commands], root, options);
  console.log(JSON.stringify({ schemaVersion: 2, action, ...result }, null, 2));
  return result.exitCode || (result.success ? 0 : 1);
}

if (import.meta.main) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    process.exitCode = await main(process.argv.slice(2), { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
