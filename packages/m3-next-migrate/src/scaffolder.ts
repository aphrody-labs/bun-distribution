// SPDX-License-Identifier: Apache-2.0
import {
  appFiles,
  assertNativeShellOwner,
  assertPrivateOwnerWorkspace,
  TAURI_3,
  writeFiles,
} from "@aphrody/scaffold";
import { generateAppRouterCode, type RouteHierarchy } from "./layout";

/**
 * Tauri 3 line scaffolded into generated apps. The single copy lives in `@aphrody/scaffold` (mirror of
 * the root `Cargo.toml` and `tools/config/tauri-upstream.json`, bumped with `bun run desktop:sync`).
 */
export { TAURI_3 };

export interface ScaffoldOptions {
  projectName?: string;
  target?: "tauri" | "vite";
  outDir: string;
  modernizeM3?: boolean;
  hierarchy?: RouteHierarchy;
  dependencies?: Record<string, string>;
}

/** Writes the migrated project: the `app` template of `@aphrody/scaffold` with the migrated route tree as `src/App.tsx`. */
export async function scaffoldTargetProject(
  options: ScaffoldOptions,
): Promise<void> {
  const {
    projectName = "migrated-app",
    target = "tauri",
    outDir,
    modernizeM3 = false,
    hierarchy,
  } = options;
  assertPrivateOwnerWorkspace(outDir);
  assertNativeShellOwner(target);
  const files = appFiles({
    name: projectName,
    target,
    modernizeM3,
    dependencies: options.dependencies,
    appTsx: hierarchy
      ? generateAppRouterCode(hierarchy, { modernizeM3, target })
      : undefined,
  });
  await writeFiles(outDir, files, "empty");
}
