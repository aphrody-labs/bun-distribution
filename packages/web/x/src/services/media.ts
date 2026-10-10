// SPDX-License-Identifier: Apache-2.0
//
// Media upload. The chunked upload (INIT, APPEND, FINALIZE, processing wait, alt text) is
// aphrody-x (crates/web/x/src/media.rs).

import type { XClient } from "../core/client";

/** Upload a local media file and return its media_id string. */
export function uploadMedia(client: XClient, filePath: string, alt?: string): Promise<string> {
  return client.uploadMedia(filePath, alt);
}
