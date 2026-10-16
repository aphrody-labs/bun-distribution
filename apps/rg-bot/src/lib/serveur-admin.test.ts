/**
 * Non-dérive de la clé de cache des réglages.
 *
 * ── LE DÉFAUT QUE CE FICHIER EMPÊCHE ───────────────────────────────────────
 * `services/communaute.ts` ÉCRIT la clé `communaute:reglages:<guildId>` ;
 * `lib/serveur-admin.ts` la VIDE quand le site enregistre un réglage. La chaîne
 * est reproduite plutôt qu'importée — importer le service tirerait la connexion
 * Postgres dans un module qui n'en a aucun besoin.
 *
 * Le prix de ce choix, c'est qu'un renommage d'un seul côté passerait
 * inaperçu : le site enregistrerait, le bot répondrait « ok » à l'invalidation,
 * et continuerait à servir l'ancienne valeur pendant une minute sans que rien
 * ne le signale. Ce test relie les deux fichiers.
 *
 * Il lit les sources plutôt que d'importer les modules : `lib/config.ts` lève
 * au chargement quand le jeton Discord manque (fail-fast volontaire), et
 * `services/communaute.ts` ouvre un pool Postgres.
 */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const SERVEUR = fileURLToPath(new URL("./serveur-admin.ts", import.meta.url));
const SERVICE = fileURLToPath(new URL("../services/communaute.ts", import.meta.url));

describe("clé de cache des réglages", () => {
  test("le serveur d'administration vide EXACTEMENT la clé que le service écrit", async () => {
    const service = await Bun.file(SERVICE).text();
    const serveur = await Bun.file(SERVEUR).text();

    // `return \`communaute:reglages:${guildId}\`;` dans le service.
    const ecrite = service.match(/return `([a-z:]+):\$\{guildId\}`/);
    expect(ecrite?.[1]).toBeTruthy();

    // `invalidate(\`communaute:reglages:${invalider[1]}\`)` dans le serveur.
    const videe = serveur.match(/invalidate\(`([a-z:]+):\$\{/);
    expect(videe?.[1]).toBeTruthy();

    expect(videe![1]).toBe(ecrite![1]!);
  });
});

describe("garde du serveur d'administration", () => {
  test("aucun jeton par défaut n'est écrit dans le source", async () => {
    const serveur = await Bun.file(SERVEUR).text();
    // Le seul jeton lu vient de l'environnement, et une valeur vide arrête le
    // démarrage. Un `?? "quelque-chose"` ici rouvrirait le défaut qui avait
    // transformé le service d'annonces de rg-cron en tribune ouverte.
    expect(serveur).toContain('Bun.env.BOT_ADMIN_TOKEN ?? ""');
    expect(serveur).not.toMatch(/BOT_ADMIN_TOKEN\s*\?\?\s*"[^"]+"/);
  });

  test("le serveur n'écoute que la boucle locale", async () => {
    const serveur = await Bun.file(SERVEUR).text();
    expect(serveur).toContain('hostname: "127.0.0.1"');
  });

  test("la comparaison du jeton est à temps constant", async () => {
    const serveur = await Bun.file(SERVEUR).text();
    // `fourni === jeton` s'arrête au premier caractère différent : le temps de
    // réponse laisse alors deviner le préfixe, un caractère à la fois.
    expect(serveur).toContain("comparerConstant(fourni, jeton)");
    expect(serveur).not.toMatch(/fourni\s*===\s*jeton/);
  });
});
