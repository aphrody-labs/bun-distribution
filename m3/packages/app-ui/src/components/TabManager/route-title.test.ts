import { expect, test } from "bun:test";
import { deriveTitleFromPath } from "./route-title";

test("Studio links and application tabs share the actual page title", () => {
  expect(deriveTitleFromPath("/studio", "?section=drive")).toBe("Drive");
  expect(deriveTitleFromPath("/studio", "?section=unknown")).toBe("Outils des agents");
  expect(deriveTitleFromPath("/models", "")).toBe("Modèles & IA");
  expect(deriveTitleFromPath("/sources/source-id", "")).toBeNull();
});

test("explorer paths are decoded once and malformed paths stay navigable", () => {
  const params = new URLSearchParams({
    path: JSON.stringify({ Physical: { path: "/manga/100% canon" } }),
  });
  expect(deriveTitleFromPath("/explorer", "?" + params)).toBe("100% canon");
  expect(deriveTitleFromPath("/explorer", "?path=%bad")).toBe("Fichiers");
  expect(deriveTitleFromPath("/explorer", "?view=device")).toBe("Cet appareil");
});
