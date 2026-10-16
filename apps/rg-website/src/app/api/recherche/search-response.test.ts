import { describe, expect, mock, test } from "bun:test";
import { respondreRecherche } from "./search-response";

describe("GET /api/recherche", () => {
  test("distingue une panne de base d'une recherche vide", async () => {
    const logError = console.error;
    console.error = mock(() => {});
    try {
      const response = await respondreRecherche(new Request("http://localhost/api/recherche?q=axel"), {
        rg: async () => {
          throw new Error("database unavailable");
        },
        inagle: async () => [],
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        erreur: "Recherche temporairement indisponible",
      });
    } finally {
      console.error = logError;
    }
  });

  test("une requête trop courte retourne une liste vide sans interroger la base", async () => {
    const executer = mock(async () => []);
    const response = await respondreRecherche(new Request("http://localhost/api/recherche?q=a"), {
      rg: executer,
      inagle: executer,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resultats: [] });
    expect(executer).not.toHaveBeenCalled();
  });
});
