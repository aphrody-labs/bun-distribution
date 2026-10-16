// SPDX-License-Identifier: Apache-2.0
export interface DocumentArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  readTime: string;
  tags: string[];
  content: string;
}
export interface ProductTemplate {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  cliCommand: string;
  dependencies: Record<string, string>;
  files: Array<{
    name: string;
    path: string;
    language: string;
    content: string;
  }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}
function fields(value: Record<string, unknown>, names: string[]): boolean {
  return names.every((name) => typeof value[name] === "string");
}
function catalog<T>(value: unknown, valid: (entry: unknown) => boolean): T[] {
  if (!Array.isArray(value) || value.length > 10_000 || !value.every(valid))
    throw new Error("The catalog response is invalid.");
  const ids = value.map((entry: { id: string }) => entry.id);
  if (
    ids.some((id) => !id || !/^[\w-]+$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("The catalog contains invalid or duplicate identifiers.");
  return value as T[];
}
export function documentsFrom(value: unknown): DocumentArticle[] {
  return catalog(
    value,
    (entry) =>
      record(entry) &&
      fields(entry, [
        "id",
        "title",
        "category",
        "summary",
        "readTime",
        "content",
      ]) &&
      strings(entry.tags),
  );
}
export function templatesFrom(value: unknown): ProductTemplate[] {
  return catalog(
    value,
    (entry) =>
      record(entry) &&
      fields(entry, ["id", "name", "tagline", "description", "cliCommand"]) &&
      strings(entry.tags) &&
      record(entry.dependencies) &&
      Object.values(entry.dependencies).every(
        (version) => typeof version === "string",
      ) &&
      Array.isArray(entry.files) &&
      entry.files.every(
        (file) =>
          record(file) && fields(file, ["name", "path", "language", "content"]),
      ),
  );
}

/** Same-origin, read-only native catalogs. Never invokes a desktop capability. */
export async function loadCatalog<T>(
  path: "/api/docs" | "/api/templates",
  parse: (value: unknown) => T[],
  signal: AbortSignal,
): Promise<T[]> {
  const response = await fetch(path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Catalog unavailable (HTTP ${response.status}).`);
  return parse(await response.json());
}
