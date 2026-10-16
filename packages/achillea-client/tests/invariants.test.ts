/**
 * Invariants de surface : ce qui doit être vrai des 197 routes, toutes
 * ressources confondues.
 *
 * Les tests par méthode vérifient une route à la fois et ratent les défauts
 * transverses : un chemin qui oublie son `/`, un identifiant interpolé sans
 * échappement, une méthode qui n'interroge jamais le réseau parce qu'on a
 * oublié le `return`. Ici, chaque méthode publique est appelée une fois avec
 * un `fetch` factice, et on vérifie des propriétés valables pour toutes.
 */

import { describe, expect, test } from "bun:test";

import { AchilleaClient } from "../src/v1/client";

const BASE_URL = "https://exemple.test/api";

/** Argument plausible par position, pour appeler n'importe quelle méthode. */
const ARGUMENTS: unknown[] = ["1", 1, "1", 1, "1", 1];

/**
 * Variantes d'arguments essayées quand la première signature est refusée.
 * `uploadImage` veut un `Blob`, pas une chaîne : sans ça, l'exception du
 * `FormData` ressemblerait à un défaut du client.
 */
const ARGUMENT_VARIANTS: unknown[][] = [
  ARGUMENTS,
  [new Blob(["x"], { type: "image/png" }), "image.png", "1", 1],
  [{ nom: "valeur" }, "1", 1],
];

/**
 * Les builders locaux finissent par `Url` et ne font aucun appel réseau.
 * `providerOAuthUrl` est l'exception contractuelle : l'API doit créer un
 * state CSRF et renvoie donc son URL après une requête authentifiée.
 */
function isUrlBuilder(method: string): boolean {
  return method.endsWith("Url") && method !== "providerOAuthUrl";
}

/** Appelle `method` avec la première variante d'arguments acceptée. */
async function callAnyway(
  owner: Record<string, unknown> | undefined,
  method: string,
): Promise<{ value: unknown; called: true } | { called: false }> {
  const target = owner?.[method] as ((...args: unknown[]) => unknown) | undefined;
  if (typeof target !== "function") return { called: false };

  for (const variant of ARGUMENT_VARIANTS) {
    try {
      return { value: await target.call(owner, ...variant.slice(0, target.length)), called: true };
    } catch {
      continue;
    }
  }
  return { called: false };
}

interface Call {
  url: string;
  method: string;
}

/** Instancie un client dont chaque appel est enregistré au lieu de partir. */
function recordingClient(status = 200, body = "{}"): { client: AchilleaClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = new AchilleaClient({
    baseUrl: BASE_URL,
    fetch: (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }));
    },
  });
  return { client, calls };
}

/** Ressources exposées par l'agrégat, et leurs méthodes publiques. */
function resources(client: AchilleaClient): Array<[string, object]> {
  return Object.entries(client)
    .filter(([name, value]) => name !== "http" && typeof value === "object" && value !== null)
    .map(([name, value]) => [name, value as object]);
}

function methodNames(resource: object): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(resource)).filter(
    name => name !== "constructor" && typeof (resource as Record<string, unknown>)[name] === "function",
  );
}

describe("surface du client", () => {
  const { client } = recordingClient();

  test("chaque ressource déclarée expose au moins une méthode", () => {
    const empty = resources(client)
      .filter(([, resource]) => methodNames(resource).length === 0)
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });

  test("la surface couvre les seize ressources attendues", () => {
    expect(
      resources(client)
        .map(([name]) => name)
        .sort(),
    ).toEqual([
      "admin",
      "auth",
      "casts",
      "clans",
      "guilds",
      "leagues",
      "licenses",
      "notifications",
      "organizations",
      "playerNotes",
      "ranked",
      "sanctions",
      "stats",
      "tournaments",
      "users",
      "wallet",
    ]);
  });

  test("la surface totale reste de l'ordre attendu", () => {
    const total = resources(client).reduce((sum, [, resource]) => sum + methodNames(resource).length, 0);
    // Un effondrement (ressource vidée par une refonte) doit se voir ici.
    expect(total).toBeGreaterThan(150);
  });
});

describe("chaque méthode construit une requête valide", () => {
  test("toute méthode appelante émet bien une requête", async () => {
    const silent: string[] = [];

    for (const [resourceName, resource] of resources(recordingClient().client)) {
      for (const method of methodNames(resource)) {
        if (isUrlBuilder(method)) continue;

        const { client: fresh, calls } = recordingClient();
        const owner = (fresh as unknown as Record<string, Record<string, unknown>>)[resourceName];
        const outcome = await callAnyway(owner, method);
        if (!outcome.called) continue;

        if (calls.length === 0) silent.push(`${resourceName}.${method}`);
      }
    }

    expect(silent, `Méthodes qui n'émettent aucune requête (return oublié ?) : ${silent.join(", ")}`).toEqual([]);
  });

  test("les constructeurs d'URL rendent un lien absolu sans toucher au réseau", async () => {
    const invalid: string[] = [];

    for (const [resourceName, resource] of resources(recordingClient().client)) {
      for (const method of methodNames(resource)) {
        if (!isUrlBuilder(method)) continue;

        const { client: fresh, calls } = recordingClient();
        const owner = (fresh as unknown as Record<string, Record<string, unknown>>)[resourceName];
        const outcome = await callAnyway(owner, method);
        if (!outcome.called) continue;

        const label = `${resourceName}.${method} → ${String(outcome.value)}`;
        if (calls.length > 0) invalid.push(`${label} (a émis une requête)`);
        if (typeof outcome.value !== "string") {
          invalid.push(`${label} (pas une chaîne)`);
          continue;
        }
        if (!outcome.value.startsWith("http")) invalid.push(`${label} (lien relatif)`);
        if (outcome.value.includes("undefined")) invalid.push(`${label} (interpolation ratée)`);
      }
    }

    expect(invalid).toEqual([]);
  });

  test("aucune URL produite n'est malformée", async () => {
    const malformed: string[] = [];

    for (const [resourceName, resource] of resources(recordingClient().client)) {
      for (const method of methodNames(resource)) {
        if (isUrlBuilder(method)) continue;

        const { client: fresh, calls } = recordingClient();
        const owner = (fresh as unknown as Record<string, Record<string, unknown>>)[resourceName];
        const outcome = await callAnyway(owner, method);
        if (!outcome.called) continue;

        for (const { url } of calls) {
          const label = `${resourceName}.${method} → ${url}`;
          if (!url.startsWith(BASE_URL)) malformed.push(`${label} (hors base)`);
          // `//` en milieu de chemin trahit un segment vide.
          if (url.slice(BASE_URL.length).includes("//")) malformed.push(`${label} (double /)`);
          if (url.includes("undefined") || url.includes("[object")) {
            malformed.push(`${label} (interpolation ratée)`);
          }
          if (/\s/u.test(url)) malformed.push(`${label} (espace non échappé)`);
        }
      }
    }

    expect(malformed).toEqual([]);
  });

  test("une erreur HTTP ne lève jamais et rend toujours ok: false", async () => {
    const wrong: string[] = [];

    for (const [resourceName, resource] of resources(recordingClient().client)) {
      for (const method of methodNames(resource)) {
        if (isUrlBuilder(method)) continue;

        const { client: fresh } = recordingClient(500, "pas du json");
        const owner = (fresh as unknown as Record<string, Record<string, unknown>>)[resourceName];
        const outcome = await callAnyway(owner, method);
        if (!outcome.called) continue;

        const result = outcome.value;
        if (result && typeof result === "object" && "ok" in result) {
          if ((result as { ok: boolean }).ok !== false) {
            wrong.push(`${resourceName}.${method} (ok: true sur un 500)`);
          }
        }
      }
    }

    expect(wrong, `Méthodes qui ne signalent pas l'échec : ${wrong.join(", ")}`).toEqual([]);
  });
});
