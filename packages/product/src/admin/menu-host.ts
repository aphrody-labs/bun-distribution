// SPDX-License-Identifier: Apache-2.0
import type { Context } from "./lib/context.ts";
import { loadProfile, trainHostId } from "./lib/profile.ts";

/** The server the training menu acts on (the one meant for training); says why when there is none yet. */
export async function resolveActive(ctx: Context): Promise<string | undefined> {
  const pack = await loadProfile(ctx.paths);
  if (!pack) {
    ctx.ui.say("Pas encore de fichier d'accès : choisis d'abord « Tout installer ou réparer ».");
    return undefined;
  }
  return trainHostId(pack);
}
