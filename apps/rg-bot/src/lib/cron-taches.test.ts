/**
 * Politique d'accès aux tâches du cron.
 *
 * Le point sensible n'est pas la liste elle-même mais la NORMALISATION : le
 * démon accepte `discord-backfill` et `discord:backfill` pour la même fonction
 * (`runnerMap` de `packages/cron/src/index.ts`). Une liste noire qui ne
 * connaîtrait qu'une seule des deux écritures serait contournable en tapant
 * l'autre.
 */
import { describe, expect, test } from "bun:test";

import {
  TACHES_ADMIN,
  TACHES_CRON,
  TACHES_INTERDITES,
  niveauTache,
  normaliserNomTache,
  raisonRefus,
  resoudreTache,
  suggererTaches,
} from "./cron-taches";

describe("catalogue", () => {
  test("les 26 tâches servies par GET :3005/tasks", () => {
    expect(TACHES_CRON).toHaveLength(26);
    expect(TACHES_CRON).toContain("db");
    expect(TACHES_CRON).toContain("stats:achillea");
    expect(TACHES_CRON).toContain("achillea:weekly-payout");
    expect(TACHES_CRON).toContain("github-publish");
    // Publiée le 17/8/2026 en même temps qu'elle a été planifiée : elle répare
    // ce que `db` efface (vidéos et vignettes des techniques).
    expect(TACHES_CRON).toContain("zukan:videos");
  });

  /**
   * Les quatre tâches que le catalogue du bot ignorait.
   *
   * Elles existent dans `runnerMap` (`packages/cron/src/index.ts`) et sont
   * servies par `GET /tasks` depuis leur écriture, mais la liste recopiée dans
   * le bot s'était arrêtée à dix-huit : `/cron lancer noctaly:import` répondait
   * « tâche inconnue » sur une tâche qui marche. C'est la raison d'être du
   * catalogue partagé — ce test est là pour que la divergence ne revienne pas.
   */
  test("les tâches ajoutées au démon après la première rédaction sont là", () => {
    expect(TACHES_CRON).toContain("noctaly:import");
    expect(TACHES_CRON).toContain("campagnes:discord");
    expect(TACHES_CRON).toContain("campagnes:instagram");
    expect(TACHES_CRON).toContain("campagnes:relais");
  });

  test("aucun doublon", () => {
    expect(new Set(TACHES_CRON).size).toBe(TACHES_CRON.length);
  });
});

describe("normalisation", () => {
  test("les deux écritures acceptées par le démon convergent", () => {
    expect(normaliserNomTache("discord-backfill")).toBe(normaliserNomTache("discord:backfill"));
    expect(normaliserNomTache("x-campagnes")).toBe(normaliserNomTache("x:campagnes"));
    expect(normaliserNomTache("SEO-LLMS-TXT")).toBe(normaliserNomTache("seo:llms-txt"));
  });

  test("`github-publish` garde son tiret : ce n'est pas un espace de noms", () => {
    expect(normaliserNomTache("github-publish")).toBe("github-publish");
    expect(resoudreTache("github:publish")).toBe("github-publish");
  });

  test("resoudreTache rend le nom canonique ou null", () => {
    expect(resoudreTache("DISCORD-POLLS")).toBe("discord:polls");
    expect(resoudreTache("  warm ")).toBe("warm");
    expect(resoudreTache("rm -rf")).toBeNull();
    expect(resoudreTache(null)).toBeNull();
  });
});

describe("niveauTache", () => {
  test("les 4 tâches destructrices sont interdites, quelle que soit l'écriture", () => {
    expect(TACHES_INTERDITES).toEqual(["db", "crawl", "github-publish", "discord:backfill"]);
    for (const nom of ["db", "crawl", "github-publish", "discord:backfill", "discord-backfill", "github:publish"]) {
      expect(niveauTache(nom)).toBe("interdit");
    }
  });

  test("le staff peut lancer les tâches idempotentes", () => {
    for (const nom of TACHES_ADMIN) {
      expect(niveauTache(nom)).toBe("admin");
    }
  });

  test("les tâches qui écrivent en production ou consomment un quota exigent admin", () => {
    for (const nom of ["publish", "patreon", "reminders", "cdn", "seo:indexnow", "x:campagnes"]) {
      expect(niveauTache(nom)).toBe("admin-strict");
    }
  });

  test("une tâche non classée penche vers la restriction, pas vers la permission", () => {
    expect(niveauTache("discord")).toBe("admin-strict");
    expect(niveauTache("discord:scan")).toBe("admin-strict");
  });

  test("un nom inconnu est traité comme interdit", () => {
    expect(niveauTache("supprimer-tout")).toBe("interdit");
    expect(niveauTache("")).toBe("interdit");
    expect(niveauTache(null)).toBe("interdit");
  });

  test("chaque tâche du catalogue a un niveau défini", () => {
    for (const nom of TACHES_CRON) {
      expect(["interdit", "admin-strict", "admin"]).toContain(niveauTache(nom));
    }
  });
});

describe("raisonRefus", () => {
  test("distingue « inconnue » de « interdite »", () => {
    expect(raisonRefus("nawak")).toContain("inconnue");
    expect(raisonRefus("db")).toContain("ne peut pas être déclenchée à distance");
    // Le motif fait partie du refus : une interdiction sans raison finit
    // toujours par être levée « parce qu'on ne sait plus pourquoi ».
    expect(raisonRefus("db")).toContain("données de jeu");
  });

  test("indique la porte de sortie légitime", () => {
    expect(raisonRefus("crawl")).toContain("--run crawl");
  });
});

describe("suggererTaches", () => {
  test("filtre sur la saisie, tiret ou deux-points indifféremment", () => {
    expect(suggererTaches("discord-mes")).toEqual(["discord:messages"]);
    expect(suggererTaches("seo")).toEqual(["seo:indexnow", "seo:llms-txt"]);
  });

  test("ne propose jamais une tâche interdite quand on demande à l'exclure", () => {
    const proposees = suggererTaches("", { exclureInterdites: true });
    for (const interdite of TACHES_INTERDITES) {
      expect(proposees).not.toContain(interdite);
    }
    expect(proposees).toHaveLength(TACHES_CRON.length - TACHES_INTERDITES.length);
  });

  test("plafonne à 25, la limite de Discord", () => {
    expect(suggererTaches("").length).toBeLessThanOrEqual(25);
  });
});
