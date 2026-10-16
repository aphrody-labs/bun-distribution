import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadRootDocs, renderMemory, renderPlan, renderReadme } from "../src/root-docs.ts";

const root = fileURLToPath(new URL("../../../docs/aphrody/", import.meta.url));

test("README exposes the canonical agent installation before the inventory", () => {
  const data = loadRootDocs(root);
  const readme = renderReadme(data, "Totals: test inventory.");
  expect(readme).toContain("docs/operations/INSTALL-AGENT.md");
  expect(readme.indexOf("codex exec")).toBeLessThan(readme.indexOf("Totals:"));
  expect(readme).toContain("## Repository\n\nTotals:");
  expect(readme.endsWith("\n")).toBe(true);
});

test("README sections follow the summary, before installation and inventory", () => {
  const data = loadRootDocs(root);
  data.readme.summary = "Summary fixture.";
  data.readme.sections = [
    { id: "a", title: "First", public: true, body: ["Alpha body."] },
    { id: "b", title: "Second", body: ["- beta"] },
  ];
  data.readme.installation = ["Installation fixture"];
  const readme = renderReadme(data, "Totals: fixture.");
  expect(readme).toContain(
    "Summary fixture.\n\n## First\n\nAlpha body.\n\n## Second\n\n- beta\n\nInstallation fixture",
  );
  expect(readme.indexOf("## Second")).toBeLessThan(readme.indexOf("Totals:"));
});

test("README installation does not alter generated plan or evidence", () => {
  const data = loadRootDocs(root);
  const before = [renderPlan(data), renderMemory(data)];
  data.readme.installation = ["Installation fixture"];
  expect(renderReadme(data, "Totals: fixture.")).toContain("Installation fixture");
  expect([renderPlan(data), renderMemory(data)]).toEqual(before);
});
