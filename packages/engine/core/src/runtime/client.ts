/**
 * High-level bridge to @aphrody/yolo-runtime C ABI 1.4 native engine.
 */
import { Runtime } from "../../../runtime/src/index";
import { sharedRuntime, closeSharedRuntime, system, processes } from "../../../runtime/src/modules";
import {
  hostTarget,
  runtimeHome,
  verifyArtifact,
  loadArtifact,
  installedArtifactDir,
  type ArtifactManifest,
} from "../../../runtime/src/artifact";

export {
  Runtime,
  sharedRuntime,
  closeSharedRuntime,
  system,
  processes,
  hostTarget,
  runtimeHome,
  verifyArtifact,
  loadArtifact,
  installedArtifactDir,
  type ArtifactManifest,
};

export interface RuntimeStatus {
  readonly installed: boolean;
  readonly active?: string | undefined;
  readonly abi?: string | undefined;
  readonly version?: string | undefined;
  readonly capabilities?: readonly string[] | undefined;
  readonly target: string;
}

export function getRuntimeStatus(): RuntimeStatus {
  const target = hostTarget();
  try {
    const shared = sharedRuntime();
    const info = shared.buildInfo();
    return {
      installed: true,
      active: `${info.name}-${info.version}`,
      abi: info.abi,
      version: info.version,
      capabilities: shared.capabilities(),
      target,
    };
  } catch {
    return {
      installed: false,
      target,
    };
  }
}
