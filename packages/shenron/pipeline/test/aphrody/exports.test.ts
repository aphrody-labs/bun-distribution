// SPDX-License-Identifier: Apache-2.0
/** Exact public surface of `@shenron/pipeline/aphrody` and its subpaths (B16). */
import { describe, expect, it } from "bun:test";
import * as root from "../../src/aphrody/index";
import * as cli from "../../src/aphrody/cli";
import pkg from "../../package.json";

describe("@shenron/pipeline/aphrody exports", () => {
  it("root exposes the shared service clients and script adapters", () => {
    expect(Object.keys(root).toSorted()).toEqual([
      "AphrodyComputeClient",
      "AphrodyFramesClient",
      "AphrodyTranslateService",
      "AphrodyWebClient",
      "AphrodyWikiSearchService",
      "AphrodyWikiService",
      "SHENRON_EMBED_DIMENSIONS",
      "SHENRON_EMBED_MODEL",
      "ShenronEmbeddingsClient",
      "TranslateOptionsSchema",
      "TranslationResultSchema",
      "WikiPageDossierSchema",
      "WikiSearchResultSchema",
      "WikiSectionSchema",
      "aphrodyInfraCheck",
      "aphrodyInfraStatus",
      "aphrodyWebCrawl",
      "aphrodyWebMirror",
      "aphrodyWebRecon",
      "aphrodyWebScrape",
      "aphrodyWebSearch",
      "resolveWikiApiUrl",
      "scrapeWithAphrody",
    ]);
  });

  it("root no longer carries the FFI bridge nor the A2A hub", () => {
    const names = Object.keys(root);
    for (const gone of [
      "AphrodyNativeBridge",
      "ShenronBridge",
      "ShenronA2AHub",
      "searchMemory",
      "mcpCall",
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it("cli subpath exposes the JSON wrappers", () => {
    expect(Object.keys(cli).toSorted()).toEqual([
      "DEFAULT_APHRODY_CLI_TIMEOUT_MS",
      "aphrodyDoctor",
      "aphrodyGitInspect",
      "runAphrodyCli",
    ]);
  });

  it("manifest maps every subpath to source with a runtime class", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.exports["./aphrody"]).toBe("./src/aphrody/index.ts");
    expect(pkg.exports["./aphrody/compute"]).toBe("./src/aphrody/compute.ts");
    expect(pkg.exports["./aphrody/cli"]).toBe("./src/aphrody/cli.ts");
    expect(pkg.shenron.runtime["./aphrody"]).toBe("server");
    expect(pkg.shenron.runtime["./aphrody/cli"]).toBe("bun");
  });

  it("a2a subpath keeps the hub API", async () => {
    const a2a = await import("../../src/aphrody/a2a");
    expect(typeof a2a.ShenronA2AHub.configure).toBe("function");
    expect(typeof a2a.ShenronA2AHub.handleJsonRpc).toBe("function");
    expect(typeof a2a.ShenronA2AHub.setProbes).toBe("function");
  });
});
