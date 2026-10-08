// SPDX-License-Identifier: Apache-2.0

/** What one codemod did to one file. `code` equals the input when nothing applied. */
export interface CodemodResult {
  code: string;
  /** What changed, one line each. */
  changes: string[];
  /** What needs a human: shapes the codemod recognised but cannot rewrite safely. */
  warnings: string[];
  /** A new path relative to the project root (`middleware.ts` -> `proxy.ts`). */
  rename?: string;
}

export interface Codemod {
  /** Stable id for the CLI (`next-config`, `middleware-to-proxy`, ...). */
  id: string;
  /** One line for `--list`. */
  title: string;
  /** Migration it belongs to: `next16`, `mui`, `tailwind4`. */
  group: "next16" | "mui" | "tailwind4";
  /** Does it apply to this project-relative path (forward slashes)? */
  test: (path: string) => boolean;
  run: (source: string, path: string) => CodemodResult;
}

export const unchanged = (code: string): CodemodResult => ({ code, changes: [], warnings: [] });
