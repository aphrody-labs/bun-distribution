// SPDX-License-Identifier: Apache-2.0
/**
 * Self-update of the exe, reusing creator-kit's engine (SHA-256 + size check, staging, running exe renamed to `.old`).
 * Only the source differs: the artifact `omar-kit` of the downloads catalogue, cross-checked against SHA256SUMS.
 */
import {
  autoUpdateInBackground,
  currentPlatform,
  updateFromRelease,
  stateFile,
  type AppIdentity,
  type UpdateResult,
} from "../../shared/update.ts";
import type { Context } from "./context.ts";
import {
  checkArtifact,
  downloadsFor,
  pickArtifact,
  toRelease,
  WINDOWS_PLATFORM,
} from "./downloads.ts";
import { loadProfile } from "./profile.ts";

export const KIT_ARTIFACT = "aphrody-setup";

export const omarApp = (version: string): AppIdentity => ({
  name: "Aphrody/Setup",
  version,
  disableEnv: "APHRODY_OMAR_NO_UPDATE",
  updateCommand: "mise-a-jour",
});

/** `base` overrides the site (tests, and a pack that names another one): default is the access pack's, then the public site. */
export async function updateKit(
  ctx: Context,
  options: {
    checkOnly?: boolean;
    base?: string;
    artifact?: string;
    app?: AppIdentity;
  } = {},
): Promise<UpdateResult> {
  const name = options.artifact ?? KIT_ARTIFACT;
  const base =
    options.base ??
    (await loadProfile(ctx.paths))?.downloadsBase ??
    "https://downloads.aphrody.com";
  const snapshot = await downloadsFor({ ...ctx }, base);
  const manifest = snapshot.manifest;
  const release = toRelease(manifest, name, currentPlatform());
  if (!release)
    return {
      status: "skipped",
      detail: "aucune mise à jour de ce programme n'est publiée",
    };
  const artifact = pickArtifact(manifest, name, WINDOWS_PLATFORM, ".tar.gz");
  if (artifact) checkArtifact(snapshot.base, artifact, snapshot.sums);
  return updateFromRelease(release, {
    version: ctx.version,
    execPath: ctx.exePath,
    checkOnly: options.checkOnly ?? false,
    fetchImpl: ctx.fetchImpl,
    statePath: stateFile(ctx.sys.env, options.app ?? omarApp(ctx.version)),
  });
}

export { autoUpdateInBackground };
