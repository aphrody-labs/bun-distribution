// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test";
import { loadSelectedSourceCatalogs } from "./index";

test("loads only source catalogs selected by the profile", async () => {
  const loaded: string[] = [];
  const catalogs = await loadSelectedSourceCatalogs(["cachyos"], {
    cachyos: async () => {
      loaded.push("cachyos");
      return { id: "cachyos" };
    },
    omarchy: async () => {
      loaded.push("omarchy");
      return { id: "omarchy" };
    },
  });

  expect(loaded).toEqual(["cachyos"]);
  expect(catalogs).toEqual({ cachyos: { id: "cachyos" } });
});

test("rejects unknown or duplicated source catalog identifiers", async () => {
  const loader = async () => ({ id: "cachyos" });
  await expect(loadSelectedSourceCatalogs(["missing"], { cachyos: loader })).rejects.toThrow(
    "Unknown Arch source catalog: missing",
  );
  await expect(
    loadSelectedSourceCatalogs(["cachyos", "cachyos"], {
      cachyos: loader,
    }),
  ).rejects.toThrow("identifiers must be unique");
});
