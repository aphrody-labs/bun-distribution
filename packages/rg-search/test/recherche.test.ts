import { describe, expect, test } from "bun:test";

import {
  BASES_PAR_DEFAUT,
  construireRequete,
  formaterLigne,
  grouperParDomaine,
  LIBELLES_TYPES_RECHERCHE,
  LONGUEUR_MINIMALE,
  motifIlike,
  rechercherPartout,
  type LigneBrute,
} from "../src/index";

describe("motif ILIKE", () => {
  test("entoure le terme de jokers", () => {
    expect(motifIlike("axel")).toBe("%axel%");
  });

  /**
   * Sans échappement, chercher « 100% » rend `%100%%` : le `%` saisi devient un
   * joker et la requête ramène tout ce qui commence par « 100 ». Idem pour `_`,
   * qui remplace n'importe quel caractère.
   */
  test("échappe les jokers saisis par l'utilisateur", () => {
    expect(motifIlike("100%")).toBe("%100\\%%");
    expect(motifIlike("a_b")).toBe("%a\\_b%");
    expect(motifIlike("c:\\x")).toBe("%c:\\\\x%");
  });
});

describe("requête d'union", () => {
  const sql = construireRequete("rg") + "\nUNION ALL\n" + construireRequete("inagle");

  test("the two store unions retain all three presentation domains", () => {
    expect(sql).toContain("public.articles");
    expect(sql).toContain("public.inagle_characters");
    expect(sql).toContain("achillea.clan");
    expect(sql).toContain('achillea."user"');
  });

  test("couvre les types Wiki réellement affichés par la recherche globale", () => {
    for (const table of [
      "inagle_keshins_clean",
      "inagle_souls_clean",
      "inagle_miximax_clean",
      "inagle_awakenings_clean",
      "inagle_mode_changes_clean",
      "inagle_auras",
      "inagle_teams",
      "patch_notes",
    ]) {
      expect(sql).toContain(`FROM public.${table}`);
    }
    // Les tactiques sont classées depuis inagle_items, sans seconde lecture.
    expect(sql.match(/FROM public\.inagle_items\b/g)).toHaveLength(1);
    expect(sql.match(/FROM public\.articles\b/g)).toHaveLength(1);
    expect(sql).toContain("CASE WHEN category = 'special_tactics'");
    expect(sql).toContain("name_en ILIKE $1");
    expect(sql).toContain("name_ja ILIKE $1");
    expect(sql).toContain("title_fr ILIKE $1");
  });

  test("n'interpole jamais de valeur : seuls $1 et $2 varient", () => {
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
    // Aucune valeur saisie par l'utilisateur n'est interpolée : les seules
    // chaînes SQL sont les catégories et filtres constants du paquet.
    const litteraux = sql.match(/'[^']*'/g) ?? [];
    expect(litteraux).toEqual(["'published'", "'special_tactics'"]);
  });

  test("chaque branche porte son index de source", () => {
    // Sans cet index, impossible de savoir d'où vient une ligne au retour.
    expect(sql).toContain("0::int AS source");
    expect(sql).toContain("6::int AS source");
  });

  test("le nombre de branches suit le nombre de sources", () => {
    expect(sql.split("UNION ALL").length).toBe(15);
    expect((sql.match(/FROM /g) ?? []).length).toBe(15);
  });
});

describe("mise en forme", () => {
  const ligne = (source: string, id = "42", titre = "Axel"): LigneBrute => ({
    detail: null,
    id,
    source,
    titre,
  });

  test("préfixe l'URL par la base du domaine", () => {
    expect(formaterLigne(ligne("1", "axel-blaze"), BASES_PAR_DEFAUT)?.href).toBe("/wiki/chara/axel-blaze");
    expect(formaterLigne(ligne("4"), BASES_PAR_DEFAUT)?.href).toBe("/achillea/clans/42");
  });

  test("suit des bases différentes sans réécriture", () => {
    // Azalée montait le wiki à la racine : la mise en forme doit suivre.
    const bases = { association: "", esport: "/achillea", wiki: "" };
    expect(formaterLigne(ligne("1", "axel"), bases)?.href).toBe("/chara/axel");
  });

  test("rend null sur une source inconnue plutôt que de fabriquer une URL", () => {
    expect(formaterLigne(ligne("99"), BASES_PAR_DEFAUT)).toBeNull();
  });

  test("l'identifiant rendu est unique entre domaines", () => {
    // Deux tables peuvent porter le même id : sans préfixe de type, React
    // verrait deux clés identiques dans la liste de résultats.
    const a = formaterLigne(ligne("1", "42"), BASES_PAR_DEFAUT);
    const b = formaterLigne(ligne("4", "42"), BASES_PAR_DEFAUT);
    expect(a?.id).not.toBe(b?.id);
  });

  test("distingue BASARA et tactique avec des liens Wiki réels", () => {
    expect(formaterLigne({ ...ligne("1", "mark"), detail: "BASARA" }, BASES_PAR_DEFAUT)).toMatchObject({
      href: "/wiki/chara/mark",
      type: "basara",
    });
    expect(formaterLigne({ ...ligne("3", "wht0001"), detail: "special_tactics" }, BASES_PAR_DEFAUT)).toMatchObject({
      href: "/wiki/tactic/wht0001",
      type: "tactique",
    });
    expect(formaterLigne({ ...ligne("3", "item01"), detail: "consume" }, BASES_PAR_DEFAUT)).toMatchObject({
      href: "/wiki/item/item01",
      type: "objet",
    });
  });

  test("classe les actualités Azalée dans Wiki sans relire articles", () => {
    expect(formaterLigne({ ...ligne("0", "azalee-news"), detail: "azalee" }, BASES_PAR_DEFAUT)).toMatchObject({
      domaine: "wiki",
      href: "/news/azalee-news",
      type: "article",
    });
    expect(formaterLigne({ ...ligne("0", "rg-news"), detail: "website" }, BASES_PAR_DEFAUT)).toMatchObject({
      domaine: "association",
      href: "/news/rg-news",
    });
  });

  test("adresse toutes les auras, équipes et notes de mise à jour", () => {
    const chemins = [
      ["7", "keshin", "/wiki/aura/esprits-guerriers/42"],
      ["8", "totem", "/wiki/aura/totems/42"],
      ["9", "miximax", "/wiki/aura/miximax/42"],
      ["10", "eveil", "/wiki/aura/eveil/42"],
      ["11", "changement-mode", "/wiki/aura/changement-mode/42"],
      ["12", "aura", "/wiki/aura/autres/42"],
      ["13", "equipe", "/wiki/equipe/42"],
      ["14", "patchnote", "/wiki/patch-notes/42"],
    ] as const;
    for (const [source, type, href] of chemins) {
      expect(formaterLigne(ligne(source), BASES_PAR_DEFAUT)).toMatchObject({ type, href });
      expect(LIBELLES_TYPES_RECHERCHE[type].length).toBeGreaterThan(0);
    }
  });
});

describe("recherche complète", () => {
  const lignes: LigneBrute[] = [
    { detail: null, id: "c1", source: "1", titre: "Axel Blaze édition limitée" },
    { detail: null, id: "c2", source: "1", titre: "Axel" },
    { detail: null, id: "k1", source: "4", titre: "Axel Corp" },
    { detail: null, id: "a1", source: "0", titre: "Axel revient" },
  ];
  const executer = {
    rg: async () => lignes.filter(row => row.source !== "1"),
    inagle: async () => lignes.filter(row => row.source === "1"),
  };

  test("isolates store SQL, preserves global source indices, and sorts combined results", async () => {
    const queries: Array<{ store: string; sql: string; parameters: unknown[] }> = [];
    const result = await rechercherPartout(
      {
        rg: async (sql, parameters) => {
          queries.push({ store: "rg", sql, parameters });
          return lignes.filter(row => row.source !== "1");
        },
        inagle: async (sql, parameters) => {
          queries.push({ store: "inagle", sql, parameters });
          return lignes.filter(row => row.source === "1");
        },
      },
      "  axel%  ",
      { limiteParSource: 3, limiteTotale: 3 },
    );
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toContain("public.articles");
    expect(queries[0]?.sql).toContain("achillea.clan");
    expect(queries[0]?.sql).not.toContain("public.inagle_");
    expect(queries[1]?.sql).toContain("public.inagle_characters");
    expect(queries[1]?.sql).not.toContain("public.articles");
    expect(queries[1]?.sql).not.toContain("achillea.");
    expect(queries[1]?.sql).toContain("1::int AS source");
    expect(queries.map(query => query.parameters)).toEqual([
      ["%axel\\%%", 3],
      ["%axel\\%%", 3],
    ]);
    expect(result.map(row => row.id)).toEqual(["article:a1", "personnage:c2", "personnage:c1"]);
  });

  test("a Neon failure remains a failed combined search instead of a partial success", async () => {
    await expect(
      rechercherPartout(
        {
          rg: async () => [],
          inagle: async () => {
            throw new Error("Neon unavailable");
          },
        },
        "axel",
      ),
    ).rejects.toThrow("Neon unavailable");
  });

  test("refuse une requête trop courte sans toucher la base", async () => {
    let appele = false;
    const espion = async () => {
      appele = true;
      return [];
    };
    expect(await rechercherPartout({ rg: espion, inagle: espion }, "a")).toEqual([]);
    expect(appele).toBe(false);
    expect(LONGUEUR_MINIMALE).toBe(2);
  });

  test("ignore les espaces autour du terme", async () => {
    expect(await rechercherPartout(executer, "  a  ")).toEqual([]);
  });

  test("trie par domaine puis par titre le plus court", async () => {
    const resultats = await rechercherPartout(executer, "axel");
    expect(resultats.map(r => r.domaine)).toEqual(["association", "wiki", "wiki", "esport"]);
    // Au sein du wiki, la correspondance courte passe devant.
    expect(resultats[1]?.titre).toBe("Axel");
  });

  test("remonte une panne SQL au lieu de la confondre avec zéro résultat", async () => {
    const casse = async () => {
      throw new Error('relation "achillea.clan" does not exist');
    };
    expect(rechercherPartout({ rg: casse, inagle: async () => [] }, "axel")).rejects.toThrow(
      'relation "achillea.clan" does not exist',
    );
  });

  test("respecte la limite totale", async () => {
    const resultats = await rechercherPartout(executer, "axel", { limiteTotale: 2 });
    expect(resultats).toHaveLength(2);
  });

  test("groupe par domaine en omettant les domaines vides", async () => {
    const groupes = grouperParDomaine(await rechercherPartout(executer, "axel"));
    expect(groupes.map(g => g.domaine)).toEqual(["association", "wiki", "esport"]);
    expect(groupes[1]?.resultats).toHaveLength(2);
  });
});
