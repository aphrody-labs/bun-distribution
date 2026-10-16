// SPDX-License-Identifier: MIT
/** Image and video metadata through Bun.Image / Bun.Video (bun-engine probe owner). */
import { resolve } from "node:path";
import { probeMedia } from "../../bun-engine/src/native-capabilities.ts";

export function inspectMedia(input: string): Promise<Record<string, unknown>> {
  return probeMedia(resolve(input));
}
