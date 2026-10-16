import {
  discoverAphrodyBinaries,
  runAphrodyBinary,
  type AphrodyBinary,
} from "./binaries.ts";
import {
  discoverBunPackageWorkspaces,
  type BunPackageWorkspace,
} from "./packages.ts";
import { runInfra, type InfraInvocation, type InfraResult } from "./runtime.ts";

export type AphrodyBridgeCatalog = {
  package: "@aphrody/workspace";
  bun: {
    runtime: string;
    workspaces: BunPackageWorkspace[];
  };
  rust: {
    binaries: AphrodyBinary[];
    infra: "aphrody-infra";
  };
  api: {
    infraDefaultUrl: string;
  };
};

/**
 * Single Bun-to-Rust catalogue for first-party workspaces. It exposes only
 * discovered executables and keeps Infra's source-aware invocation intact.
 */
export async function loadAphrodyBridgeCatalog(): Promise<AphrodyBridgeCatalog> {
  const [workspaces, binaries] = await Promise.all([
    discoverBunPackageWorkspaces(),
    discoverAphrodyBinaries(),
  ]);
  return {
    package: "@aphrody/workspace",
    bun: { runtime: process.execPath, workspaces },
    rust: { binaries, infra: "aphrody-infra" },
    api: { infraDefaultUrl: "http://127.0.0.1:8787" },
  };
}

/** Execute a Rust surface through the central bridge, never an arbitrary PATH command. */
export async function runRustBridge(
  binary: string,
  args: string[],
  infraInvocation: Omit<InfraInvocation, "args"> = {},
): Promise<number> {
  if (binary === "aphrody-infra") {
    const result: InfraResult = await runInfra({ ...infraInvocation, args });
    if (infraInvocation.stdout !== "inherit" && result.stdout)
      process.stdout.write(result.stdout);
    if (infraInvocation.stderr !== "inherit" && result.stderr)
      process.stderr.write(result.stderr);
    return result.exitCode;
  }
  return runAphrodyBinary(binary, args);
}
