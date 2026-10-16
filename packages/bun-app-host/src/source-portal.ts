// SPDX-License-Identifier: MIT

export const sourcePortalOrigin = "https://source.aphrody.app";
export const sourcePortalApiPath = "/api/v1/repos/search";
export const sourcePortalOwners = [
  "aphrody-dev",
  "aphrody-labs",
  "aphrody-labs-native",
] as const;

export type PublicSourceRepository = {
  owner: (typeof sourcePortalOwners)[number];
  name: string;
  htmlURL: string;
  defaultBranch: string | null;
  mirror: boolean;
  observedAt: string;
};

export type PortalSnapshot = {
  schemaVersion: 1;
  origin: typeof sourcePortalOrigin;
  apiPath: typeof sourcePortalApiPath;
  owners: typeof sourcePortalOwners;
  pageSize: 50;
  maxPages: 10;
  complete: true;
  pages: number;
  observedAt: string;
  repositories: PublicSourceRepository[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function keysMatch(value: object, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function canonicalURL(owner: string, name: string, candidate: unknown): string {
  assert(typeof candidate === "string", "Invalid public repository URL.");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Invalid public repository URL.");
  }
  assert(
    url.protocol === "https:" &&
      url.origin === sourcePortalOrigin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === `/${owner}/${name}`,
    "Public repository URL escaped the source portal.",
  );
  return url.toString().replace(/\/$/, "");
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

/** Validate and reconstruct the public-only snapshot; unknown fields are discarded by rejection. */
export function validateSnapshot(value: unknown): PortalSnapshot {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid source portal snapshot.",
  );
  const snapshot = value as Record<string, unknown>;
  assert(
    keysMatch(snapshot, [
      "apiPath",
      "complete",
      "maxPages",
      "observedAt",
      "origin",
      "owners",
      "pageSize",
      "pages",
      "repositories",
      "schemaVersion",
    ]),
    "Unsupported source portal snapshot fields.",
  );
  assert(
    snapshot.schemaVersion === 1 &&
      snapshot.origin === sourcePortalOrigin &&
      snapshot.apiPath === sourcePortalApiPath &&
      JSON.stringify(snapshot.owners) === JSON.stringify(sourcePortalOwners) &&
      snapshot.pageSize === 50 &&
      snapshot.maxPages === 10 &&
      snapshot.complete === true &&
      Number.isInteger(snapshot.pages) &&
      (snapshot.pages as number) >= 1 &&
      (snapshot.pages as number) <= 10 &&
      validTimestamp(snapshot.observedAt) &&
      Array.isArray(snapshot.repositories) &&
      snapshot.repositories.length <= 500,
    "Incomplete or unsupported source portal snapshot.",
  );

  const repositories: PublicSourceRepository[] = [];
  const seen = new Set<string>();
  let previousName = "";
  for (const item of snapshot.repositories) {
    assert(
      item && typeof item === "object" && !Array.isArray(item),
      "Invalid public repository entry.",
    );
    const repository = item as Record<string, unknown>;
    assert(
      keysMatch(repository, [
        "defaultBranch",
        "htmlURL",
        "mirror",
        "name",
        "observedAt",
        "owner",
      ]),
      "Unsupported public repository fields.",
    );
    const owner = repository.owner;
    const name = repository.name;
    assert(
      typeof owner === "string" &&
        sourcePortalOwners.includes(
          owner as (typeof sourcePortalOwners)[number],
        ),
      "Unexpected public repository owner.",
    );
    assert(
      typeof name === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name),
      "Invalid public repository name.",
    );
    assert(
      typeof repository.mirror === "boolean",
      "Invalid public repository mirror state.",
    );
    const defaultBranch = repository.defaultBranch;
    assert(
      defaultBranch === null ||
        (typeof defaultBranch === "string" &&
          defaultBranch.length <= 255 &&
          !hasControlCharacters(defaultBranch)),
      "Invalid public repository branch.",
    );
    assert(
      repository.observedAt === snapshot.observedAt,
      "Inconsistent public repository timestamp.",
    );
    const htmlURL = canonicalURL(owner, name, repository.htmlURL);
    assert(
      htmlURL === repository.htmlURL,
      "Non-canonical public repository URL.",
    );
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    assert(!seen.has(key), "Duplicate public repository entry.");
    seen.add(key);
    const sortKey = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    assert(
      !previousName || previousName < sortKey,
      "Public repositories are not sorted alphabetically.",
    );
    previousName = sortKey;
    repositories.push({
      owner: owner as (typeof sourcePortalOwners)[number],
      name,
      htmlURL,
      defaultBranch,
      mirror: repository.mirror,
      observedAt: repository.observedAt as string,
    });
  }

  return {
    schemaVersion: 1,
    origin: sourcePortalOrigin,
    apiPath: sourcePortalApiPath,
    owners: sourcePortalOwners,
    pageSize: 50,
    maxPages: 10,
    complete: true,
    pages: snapshot.pages as number,
    observedAt: snapshot.observedAt as string,
    repositories,
  };
}
