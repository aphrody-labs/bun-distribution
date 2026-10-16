#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import {
  sourcePortalApiPath,
  sourcePortalOrigin,
  sourcePortalOwners,
  validateSnapshot,
  type PortalSnapshot,
} from "../packages/bun-app-host/src/source-portal.ts";

const pageSize = 50;
const maxPages = 10;
const requestTimeoutMs = 15_000;
const operationTimeoutMs = 30_000;
const root = join(import.meta.dir, "..");
const snapshotPath = join(root, "infra", "source-portal.json");

function fail(message: string): never {
  throw new Error(message);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

function repositoryURL(
  owner: string,
  name: string,
  candidate: unknown,
): string {
  if (typeof candidate !== "string")
    fail("A public repository URL is invalid.");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("A public repository URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== sourcePortalOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/${owner}/${name}`
  )
    return fail("A public repository URL escaped the source portal.");
  return url.toString().replace(/\/$/, "");
}

function repoOwner(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "login" in value &&
    typeof value.login === "string"
  )
    return value.login;
  return null;
}

function parseRepository(
  value: unknown,
  observedAt: string,
): PortalSnapshot["repositories"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("The source portal returned an invalid repository.");
  const repo = value as Record<string, unknown>;
  const owner = repoOwner(repo.owner);
  if (
    !sourcePortalOwners.includes(owner as (typeof sourcePortalOwners)[number])
  )
    return null;
  if (repo.private === true) return null;
  if (repo.private !== false)
    fail("The source portal returned an unqualified visibility state.");
  const name = repo.name;
  if (
    typeof name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)
  )
    fail("The source portal returned an invalid public repository name.");
  if (typeof repo.mirror !== "boolean")
    fail("The source portal returned an invalid mirror state.");
  const defaultBranch = repo.default_branch;
  if (
    defaultBranch !== null &&
    defaultBranch !== undefined &&
    typeof defaultBranch !== "string"
  )
    fail("The source portal returned an invalid default branch.");
  if (
    typeof defaultBranch === "string" &&
    (defaultBranch.length > 255 || hasControlCharacters(defaultBranch))
  )
    fail("The source portal returned an invalid default branch.");
  return {
    owner: owner as (typeof sourcePortalOwners)[number],
    name,
    htmlURL: repositoryURL(owner!, name, repo.html_url),
    defaultBranch:
      typeof defaultBranch === "string" && defaultBranch ? defaultBranch : null,
    mirror: repo.mirror,
    observedAt,
  };
}

async function fetchPage(page: number, deadline: number): Promise<unknown[]> {
  const remaining = deadline - Date.now();
  if (remaining < 1)
    fail("The source portal refresh exceeded its operation deadline.");
  const url = new URL(sourcePortalApiPath, sourcePortalOrigin);
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("order", "asc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "alpha");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remaining)),
  });
  if (response.status !== 200)
    fail("Anonymous source portal search did not return HTTP 200.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 4_000_000)
    fail("The source portal page exceeded its response bound.");
  const reader = response.body?.getReader();
  if (!reader) fail("The source portal returned an empty response body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4_000_000) {
      await reader.cancel();
      fail("The source portal page exceeded its response bound.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let result: unknown;
  try {
    result = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail("The source portal returned invalid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    fail("The source portal returned an invalid page.");
  const pageResult = result as { ok?: unknown; data?: unknown };
  if (
    pageResult.ok !== true ||
    !Array.isArray(pageResult.data) ||
    pageResult.data.length > pageSize
  )
    fail("The source portal returned an incomplete page.");
  return pageResult.data;
}

async function loadPublicSnapshot(): Promise<PortalSnapshot> {
  const deadline = Date.now() + operationTimeoutMs;
  const observedAt = new Date().toISOString();
  const repositories = new Map<
    string,
    PortalSnapshot["repositories"][number]
  >();
  let pages = 0;
  let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    const results = await fetchPage(page, deadline);
    pages = page;
    for (const item of results) {
      const repository = parseRepository(item, observedAt);
      if (!repository) continue;
      const key = `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
      const previous = repositories.get(key);
      if (
        previous &&
        (previous.htmlURL !== repository.htmlURL ||
          previous.mirror !== repository.mirror ||
          previous.defaultBranch !== repository.defaultBranch)
      )
        fail(
          "The source portal returned conflicting duplicate public repositories.",
        );
      if (!previous) repositories.set(key, repository);
    }
    if (results.length < pageSize) {
      complete = true;
      break;
    }
  }
  if (!complete)
    fail(
      "The source portal search exceeded its page bound; no partial snapshot was written.",
    );
  const sorted = [...repositories.values()].sort((left, right) => {
    const leftKey = `${left.owner.toLowerCase()}/${left.name.toLowerCase()}`;
    const rightKey = `${right.owner.toLowerCase()}/${right.name.toLowerCase()}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return validateSnapshot({
    schemaVersion: 1,
    origin: sourcePortalOrigin,
    apiPath: sourcePortalApiPath,
    owners: sourcePortalOwners,
    pageSize,
    maxPages,
    complete,
    pages,
    observedAt,
    repositories: sorted,
  });
}

function repositoryProjection(snapshot: PortalSnapshot): string {
  return JSON.stringify(
    snapshot.repositories.map(
      ({ owner, name, htmlURL, defaultBranch, mirror }) => ({
        owner,
        name,
        htmlURL,
        defaultBranch,
        mirror,
      }),
    ),
  );
}

const [action = "plan", ...arguments_] = Bun.argv.slice(2);
if (action === "plan") {
  if (arguments_.length) fail("Use source-portal.ts plan.");
  console.log(
    JSON.stringify(
      {
        action,
        origin: sourcePortalOrigin,
        apiPath: sourcePortalApiPath,
        owners: sourcePortalOwners,
        pageSize,
        maxPages,
        snapshotPath,
      },
      null,
      2,
    ),
  );
} else if (action === "refresh") {
  if (arguments_.length) fail("Use source-portal.ts refresh.");
  const snapshot = await loadPublicSnapshot();
  await Bun.write(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    JSON.stringify({
      action,
      complete: snapshot.complete,
      pages: snapshot.pages,
      publicRepositories: snapshot.repositories.length,
      observedAt: snapshot.observedAt,
    }),
  );
} else if (action === "verify") {
  if (
    arguments_.some((argument) => argument !== "--live") ||
    arguments_.length > 1
  )
    fail("Use source-portal.ts verify [--live].");
  const snapshot = validateSnapshot(await Bun.file(snapshotPath).json());
  if (arguments_[0] === "--live") {
    const current = await loadPublicSnapshot();
    if (repositoryProjection(current) !== repositoryProjection(snapshot))
      fail(
        "The saved public repository snapshot differs from the anonymous live source.",
      );
  }
  console.log(
    JSON.stringify({
      action,
      live: arguments_[0] === "--live",
      complete: snapshot.complete,
      pages: snapshot.pages,
      publicRepositories: snapshot.repositories.length,
      observedAt: snapshot.observedAt,
    }),
  );
} else {
  fail("Use source-portal.ts plan | refresh | verify [--live].");
}
