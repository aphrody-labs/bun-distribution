// SPDX-License-Identifier: Apache-2.0
//
// Import of a Twitter data archive (`tweets.js`) into the store. Locating the file, stripping the
// `window.YTD.*` prefix and converting the tweets are aphrody-x (crates/web/x/src/archive.rs).

import { local } from "../core/local";
import type { Tweet } from "../core/parse";
import type { Store } from "./store";

/** Locate the tweets file inside an archive directory or accept a direct path. */
export function resolveTweetsFile(input: string): string | null {
  return local<string | null>("archive_resolve_file", { path: input });
}

/** Strip the window.YTD.* assignment prefix and parse the JSON array. */
export function parseArchiveArray(raw: string): any[] {
  return local<any[]>("archive_parse", { raw });
}

/** Convert one archive element into a Tweet structure. */
export function archiveTweetToTweet(
  elem: unknown,
  owner: { username: string; name: string },
): Tweet | null {
  return local<Tweet | null>("archive_tweet", { element: elem, owner });
}

/** Import a tweets archive into the SQLite store; returns the number of tweets imported. */
export async function importArchive(
  store: Store,
  path: string,
  ownerHandle: string,
): Promise<number> {
  return store.importArchive(path, ownerHandle);
}
