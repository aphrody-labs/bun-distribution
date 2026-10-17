// SPDX-License-Identifier: Apache-2.0
import { inSkipped, skippedSpans } from "@aphrody/next-bun/codemods/lex";

export interface MigrationRequirement {
  file: string;
  capability: string;
  detail: string;
}

/** A conversion may be inspected before its native host contracts are implemented. */
export function migrationRequirements(file: string, source: string): MigrationRequirement[] {
  const normalized = file.replaceAll("\\", "/");
  const requirements: MigrationRequirement[] = [];
  const add = (capability: string, detail: string) => {
    requirements.push({ file: normalized, capability, detail });
  };
  // Ignore comments when checking directives and hook bindings.
  const spans = skippedSpans(source);
  const comments = spans.filter(span => source.startsWith("//", span.start) || source.startsWith("/*", span.start));
  let code = source;
  for (let index = comments.length - 1; index >= 0; index--) {
    const span = comments[index]!;
    code = code.slice(0, span.start) + " ".repeat(span.end - span.start) + code.slice(span.end);
  }
  if (
    [...code.matchAll(/(^|[;{}\r\n])(\s*)(['"])use server\3\s*(?:;|[\r\n}])/g)].some(match =>
      spans.some(span => span.start === match.index! + match[1]!.length + match[2]!.length),
    )
  )
    add(
      "server-action adapter",
      "Backend actions require a native host server-action adapter; client directive removal does not implement them.",
    );
  if (/(?:^|\/)(?:src\/)?pages\//.test(normalized))
    add("Pages Router adapter", "Legacy pages routing is not represented by the generated App Router hierarchy.");
  if (/(?:^|\/)(?:route|middleware|proxy)\.[cm]?[jt]sx?$/.test(normalized))
    add(
      "request host adapter",
      "Route handlers and middleware need native request registration and installed API hosting; copying their modules does not activate them.",
    );
  if (/(?:^|\/)(?:error|global-error|loading|template|not-found|default)\.[jt]sx?$/.test(normalized))
    add(
      "route boundary adapter",
      "The route tree needs this loading, error, template, not-found or slot boundary to preserve its behavior.",
    );
  const loader = normalized.endsWith(".tsx")
    ? "tsx"
    : normalized.endsWith(".jsx")
      ? "jsx"
      : normalized.endsWith(".ts")
        ? "ts"
        : "js";
  const imports = new Bun.Transpiler({ loader }).scan(source).imports;
  const next = new Set([
    "next/navigation",
    "next/link",
    "next/image",
    "next/dynamic",
    "next/form",
    "next/head",
    "next/server",
  ]);
  for (const { path } of imports) {
    if (path === "next/router")
      add(
        "Pages Router adapter",
        "The legacy router query, events and readiness contract differs from the App Router shim.",
      );
    else if (path.startsWith("next/font/"))
      add(
        "font asset adapter",
        "The font shim exposes names only; local assets, font faces and source-relative URLs require a native font asset adapter.",
      );
    else if (path === "next/headers")
      add(
        "request context adapter",
        "Browser cookies and synthetic headers do not preserve server request identity or HttpOnly state.",
      );
    else if (path === "server-only" || /^(?:node:)?(?:fs(?:\/promises)?|child_process|os)$/.test(path))
      add(
        "backend module adapter",
        "Host-only imports require backend separation and a native host adapter before this module reaches the client bundle.",
      );
    else if (path.startsWith("next/") && !next.has(path))
      add("Next module adapter", "No migration runtime contract is registered for " + path + ".");
  }
  if ([...code.matchAll(/\buseSelectedLayoutSegments?\s*\(/g)].some(match => !inSkipped(spans, match.index!)))
    add(
      "layout segment adapter",
      "Layout-segment hooks need nested layout ownership; a global pathname split does not preserve their contract.",
    );
  return requirements;
}

export function assertMigrationRequirements(requirements: readonly MigrationRequirement[]): void {
  if (requirements.length)
    throw new Error(
      "Migration requires native host adapters before activation:\n" +
        requirements
          .map(requirement => requirement.file + ": " + requirement.capability + " — " + requirement.detail)
          .join("\n") +
        "\nUse dryRun to inspect the conversion without activating unsupported host behavior.",
    );
}
