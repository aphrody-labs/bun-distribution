// SPDX-License-Identifier: Apache-2.0
// Host disposition: ONE home per host (vps, dbfr), no /srv, no /opt. Read from the [layout] table of
// tools/config/host/host-policy.toml, the single source of truth (Rust: aphrody_infra::layout).
import { posix } from "node:path";
import policy from "../../../../../tools/config/host/host-policy.toml";

export type LayoutRoot = "src" | "apps" | "build" | "archive" | "state";

export interface HostLayout {
  home: string;
  src: string;
  apps: string;
  build: string;
  archive: string;
  state: string;
  compose: string;
  composeProject: string;
  releasesKeep: number;
  /** Retired location -> replacement, absolute, longest prefix first. */
  retired: [from: string, to: string][];
}

type Json = Record<string, unknown>;
const table = ((policy as Json)["layout"] ?? {}) as Json;

/** `~` and `~/x` against `home`; anything else unchanged. */
export const expandHome = (path: string, home: string): string =>
  path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;

/** The layout with every `~` expanded against `home` (default: the declared host home). */
export function hostLayout(home = String(table["home"])): HostLayout {
  const at = (key: string): string => {
    const value = table[key];
    if (typeof value !== "string") throw new Error(`host-policy.toml: [layout].${key} missing`);
    return expandHome(value, home);
  };
  const retired = Object.entries((table["retired"] ?? {}) as Record<string, string>)
    .map(([from, to]): [string, string] => [expandHome(from, home), expandHome(to, home)])
    .sort((a, b) => b[0].length - a[0].length);
  return {
    home,
    src: at("src"),
    apps: at("apps"),
    build: at("build"),
    archive: at("archive"),
    state: at("state"),
    compose: at("compose"),
    composeProject: String(table["compose_project"]),
    releasesKeep: Number(table["releases_keep"]),
    retired,
  };
}

export const HOST_LAYOUT: HostLayout = hostLayout();

/** `<root>/<parts...>` on the host, e.g. hostPath("apps", "shenron", "shared"). */
export const hostPath = (root: LayoutRoot, ...parts: string[]): string =>
  posix.join(HOST_LAYOUT[root], ...parts);

/** The retired prefix `path` starts with (path-boundary aware), or null. */
export function retiredPrefix(path: string, layout = HOST_LAYOUT): string | null {
  for (const [from] of layout.retired)
    if (path === from || path.startsWith(`${from}/`)) return from;
  return null;
}

/** Rewrite a retired location (persisted state, old receipts) to its replacement; other paths unchanged. */
export function migratePath(path: string, layout = HOST_LAYOUT): string {
  const from = retiredPrefix(path, layout);
  if (from === null) return path;
  const to = layout.retired.find(([f]) => f === from)![1];
  return `${to}${path.slice(from.length)}`;
}
