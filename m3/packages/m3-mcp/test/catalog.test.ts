import { expect, test } from "bun:test";
import {
  listPackages,
  listTemplates,
  lookupTokens,
  researchLinks,
  searchDocs,
  validateTokens,
} from "../src/catalog";

test("packages include m3-mcp", () => {
  const p = listPackages().join("\n");
  expect(p).toContain("@aphrody/m3-mcp");
});
test("token lookup and validation", () => {
  expect(lookupTokens("corner-full")[0]?.value).toBe("9999px");
  expect(lookupTokens("on-primary-container").length).toBeGreaterThan(0);
  expect(validateTokens("a{color:var(--md-sys-color-primary);b:var(--md-nope)}").unknown).toEqual([
    "--md-nope",
  ]);
});
test("docs, research and templates", () => {
  expect(searchDocs("Material", 3).length).toBeGreaterThan(0);
  expect(researchLinks().links.length).toBeGreaterThan(20);
  expect(listTemplates()).toContain("templates/react");
});
