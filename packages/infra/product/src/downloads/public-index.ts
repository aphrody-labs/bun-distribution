// SPDX-License-Identifier: Apache-2.0
/** Public HTTP adapter contract. The configured Bun SDK owns export verification and indexing. */
export interface PublicIndexInput {
  query: string;
  collection: string;
  num: number;
  start: number;
}

export interface PublicIndexBody {
  query: string;
  organic: { title: string; url: string; snippet: string }[];
  source: "public-crawl-cache";
  collection: string;
  generatedAt: string;
}

export type PublicIndexSearch = (
  input: PublicIndexInput,
  signal?: AbortSignal,
) => Promise<{ body: PublicIndexBody; etag: string; cache: "hit" | "miss" }>;

/** Explicit public export pointer policy; no default HOME, profile or database. */
export interface PublicIndexCollection {
  pointer: string;
  hosts: string[];
  policySha256: string;
  owner: string;
}

export interface PublicIndexSdkOptions {
  root: string;
  collections: Record<string, PublicIndexCollection>;
}
