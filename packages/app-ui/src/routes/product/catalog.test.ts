// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { documentsFrom, loadCatalog, templatesFrom } from "./catalog";
import {
  isPublicDestination,
  publicDestinations,
} from "../../public-navigation";
import { deriveTitleFromPath } from "../../components/TabManager/route-title";

const article = {
  id: "runtime-architecture",
  title: "Runtimes",
  category: "Architecture",
  summary: "Shared runtime",
  readTime: "2 min",
  tags: ["Bun"],
  content: "# Runtimes\n\nReal content.",
};
const template = {
  id: "react-app",
  name: "React",
  tagline: "An app",
  description: "Real source",
  tags: ["React"],
  cliCommand: "aphrody create demo",
  dependencies: { react: "19" },
  files: [
    {
      name: "app.tsx",
      path: "src/app.tsx",
      language: "tsx",
      content: "export const App = () => <main />;",
    },
  ],
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("native catalogs preserve original markdown, CLI and source files", () => {
  expect(documentsFrom([article])).toEqual([article]);
  expect(templatesFrom([template])).toEqual([template]);
  expect(documentsFrom([])).toEqual([]);
});

test("catalogs reject duplicate IDs, broken shapes and unsafe route identifiers", () => {
  expect(() => documentsFrom([article, article])).toThrow("duplicate");
  expect(() => documentsFrom([{ ...article, id: "../secrets" }])).toThrow(
    "identifiers",
  );
  expect(() => documentsFrom([{ ...article, tags: [2] }])).toThrow("invalid");
  expect(() =>
    templatesFrom([{ ...template, files: [{ path: "app.tsx" }] }]),
  ).toThrow("invalid");
  expect(() =>
    templatesFrom([{ ...template, dependencies: { react: null } }]),
  ).toThrow("invalid");
  expect(() => documentsFrom({ html: "an SPA fallback" })).toThrow("invalid");
});

test("catalog requests use only same-origin read-only endpoints and abort on disposal", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  globalThis.fetch = (async (
    path: string | URL | Request,
    options?: RequestInit,
  ) => {
    expect(path).toBe("/api/docs");
    expect(options?.credentials).toBe("same-origin");
    expect(options?.method).toBeUndefined();
    receivedSignal = options?.signal as AbortSignal;
    return Response.json([article]);
  }) as typeof fetch;
  expect(
    await loadCatalog("/api/docs", documentsFrom, controller.signal),
  ).toEqual([article]);
  expect(receivedSignal?.aborted).toBe(false);
  controller.abort();
  expect(receivedSignal?.aborted).toBe(true);
});

test("HTTP failure and malformed JSON cannot become an indefinite loading state", async () => {
  globalThis.fetch = (async () =>
    new Response("denied", { status: 403 })) as typeof fetch;
  await expect(
    loadCatalog("/api/templates", templatesFrom, new AbortController().signal),
  ).rejects.toThrow("HTTP 403");
  globalThis.fetch = (async () =>
    new Response("<!doctype html>")) as typeof fetch;
  await expect(
    loadCatalog("/api/docs", documentsFrom, new AbortController().signal),
  ).rejects.toThrow();
});

test("public deep links stay inside canonical navigation and have meaningful tab titles", () => {
  expect(publicDestinations.map(({ route }) => route)).toEqual([
    "/",
    "/docs",
    "/templates",
    "/material-3",
  ]);
  for (const route of [
    "/",
    "/docs/runtime-architecture",
    "/templates/react-app",
    "/material-3/components",
    "/showcase/brands",
  ])
    expect(isPublicDestination(route)).toBe(true);
  expect(isPublicDestination("/docs-private")).toBe(false);
  expect(isPublicDestination("/explorer")).toBe(false);
  expect(deriveTitleFromPath("/docs/runtime-architecture", "")).toBe(
    "Documentation",
  );
  expect(deriveTitleFromPath("/showcase/components", "")).toBe("Material 3");
});
