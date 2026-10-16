# @rosegriffon/achillea-client

Client HTTP versionné de l'API Achilléa, avec validation zod à l'exécution.
ESM strict, Fetch natif, **zéro framework** : le paquet s'importe tel quel dans
un React Server Component Next.js, dans un navigateur et dans Bun. Aucun import
`node:*` / `bun:*`, aucun accès à `window`, `document` ou `localStorage`, ni
`"use client"` ni `import "server-only"`.

C'est la brique qui permet de sortir du front Angular : Next.js, React Native et
un futur client Rust consomment la même surface, décrite une seule fois.

## Versionnement

La racine pointe le contrat `v1`. Importer le point d'entrée versionné quand la
forme des réponses ne doit pas bouger au fil d'une mise à jour de dépendance :

```ts
import { createAchilleaClient } from "@rosegriffon/achillea-client/v1";
```

## Surface couverte — 197 routes

| Ressource              | Routes | Domaine                                                                                             |
| ---------------------- | -----: | --------------------------------------------------------------------------------------------------- |
| `client.admin`         |     49 | `/admin/ops`, `/admin/db`, `/bot`, `/health`, `/database`, `/metrics`, `/moderation/sync`, `/proxy` |
| `client.tournaments`   |     35 | cycle de vie, seeding, bracket, circuit, hub de stats, lobbies                                      |
| `client.clans`         |     20 | annuaire, membres, invitations, candidatures, quotas, affiche                                       |
| `client.ranked`        |     19 | profil Elo, paliers, classement, défis, litiges, saisons, arbitrage                                 |
| `client.users`         |     11 | profil enrichi, classement, tendance, carte joueur, autocomplétion                                  |
| `client.auth`          |      9 | session, jeton temps réel, déconnexion, URL OAuth                                                   |
| `client.casts`         |      9 | évènements à diffuser, disponibilités, attributions, casters                                        |
| `client.stats`         |      8 | télémétrie d'usage du bot                                                                           |
| `client.notifications` |      7 | boîte de réception + relais temps réel internes                                                     |
| `client.organizations` |      7 | structures e-sport et leur revue                                                                    |
| `client.playerNotes`   |      7 | notes du staff sur les joueurs                                                                      |
| `client.licenses`      |      5 | émission, révocation, PDF, vérification QR publique                                                 |
| `client.sanctions`     |      4 | journal de modération cross-serveurs                                                                |
| `client.guilds`        |      3 | métadonnées des serveurs Discord scannés                                                            |
| `client.leagues`       |      2 | championnats (Astral League S1 et ses alias)                                                        |
| `client.wallet`        |      2 | solde et historique du portefeuille virtuel                                                         |

Les routes `/admin/lobbies`, `/admin/ranked` et `/admin/seasons` vivent avec leur
domaine, sur `client.ranked.admin*`.

## Contrat de types

Chaque schéma zod est verrouillé sur le DTO de `@rosegriffon/achillea-types` via
`satisfies z.ZodType<Dto>`. Un DTO qui gagne, perd ou retype un champ fait
échouer `bun run type-check` tant que le schéma n'a pas suivi — la dérive de
contrat se voit à la compilation, pas en production.

Les formes encore absentes du paquet de contrat sont regroupées dans
`src/v1/pending-contracts.ts`, avec la liste de ce qu'il reste à y remonter.

## Résultats sans exception

Aucun appel ne lève sur une erreur réseau, HTTP ou de schéma :

```ts
type AchilleaClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "unreachable"; detail: string; path: string }
  | { ok: false; kind: "http"; detail: string; path: string; status: number }
  | { ok: false; kind: "invalid_json"; detail: string; path: string }
  | { ok: false; kind: "invalid_response"; detail: string; path: string };
```

Une valeur `ok: true` a déjà traversé son schéma : elle est validée et normalisée.

## Authentification

Deux régimes, combinables :

```ts
createAchilleaClient({
  // Cookie de session HttpOnly (navigateur, même origine ou CORS autorisé).
  credentials: "include",
  // Jeton porteur (`Authorization: Bearer …`) — serveur, mobile, CLI.
  getAuthToken: () => process.env.ACHILLEA_TOKEN ?? null,
});
```

Le paquet n'accède jamais lui-même à un stockage de plateforme. Si le jeton vit
dans un stockage, injecter une implémentation d'`AchilleaTokenStore` :

```ts
createAchilleaClient({
  tokenStore: { getToken: () => secureStore.read("achillea") },
});
```

## Next.js — Server Component

```tsx
import { createAchilleaClient } from "@rosegriffon/achillea-client/v1";
import { cookies } from "next/headers";

export default async function PageCircuit() {
  // Un RSC n'a pas de cookie ambiant : la session se relaie explicitement.
  const jar = await cookies();
  const achillea = createAchilleaClient({
    baseUrl: process.env.ACHILLEA_API_URL,
    headers: { cookie: jar.toString() },
  });

  const classement = await achillea.tournaments.circuitRanking();

  if (!classement.ok)
    return <p>Classement indisponible ({classement.kind}).</p>;

  return (
    <ol>
      {classement.value.leaderboard.map(joueur => (
        <li key={joueur.userId}>
          {joueur.displayName} — {joueur.points} pts
        </li>
      ))}
    </ol>
  );
}
```

## Next.js — Client Component

```tsx
"use client";

import {
  createAchilleaClient,
  type RankedProfile,
} from "@rosegriffon/achillea-client/v1";
import { useEffect, useState } from "react";

// Même origine que l'app : le cookie de session part tout seul.
const achillea = createAchilleaClient({
  baseUrl: "/api",
  credentials: "include",
});

export function CarteRanked() {
  const [profil, setProfil] = useState<RankedProfile | null>(null);

  useEffect(() => {
    void achillea.ranked.me().then(r => setProfil(r.ok ? r.value : null));
  }, []);

  if (!profil) return null;
  return (
    <p>
      {profil.elo} Elo — {profil.tier?.key ?? "non classé"}
    </p>
  );
}
```

## Bun

```ts
import { createAchilleaClient } from "@rosegriffon/achillea-client/v1";

const achillea = createAchilleaClient({
  baseUrl: Bun.env.ACHILLEA_API_URL,
  getAuthToken: () => Bun.env.ACHILLEA_DEV_TOKEN ?? null,
  timeoutMs: 8_000,
});

const tournois = await achillea.tournaments.list({ page: 1, pagination: 25 });
if (!tournois.ok) {
  console.error(tournois.kind, tournois.detail, tournois.path);
} else {
  for (const tournoi of tournois.value.data) console.info(tournoi.name);
}
```

## Ressources non JSON

Les images, PDF et redirections OAuth sont exposés en deux temps : une URL
absolue (à poser dans un `<img>`, un `<a>` ou un `redirect()`) et un accès
binaire quand l'appelant veut les octets.

```ts
achillea.users.cardUrl("123456789012345678"); // <img src=…>
achillea.licenses.pdfUrl("…"); // <a href=…>
// Compatibilité seulement : redirige vers le login Rose Griffon unifié.
achillea.auth.discordLoginUrl("/achillea/ranked");
await achillea.users.card("123456789012345678"); // ArrayBuffer
```

## Vérification

```sh
bun --filter @rosegriffon/achillea-client type-check
bun --filter @rosegriffon/achillea-client test
bun --filter @rosegriffon/achillea-client lint
```

Les tests utilisent un `fetch` factice : ils ne touchent jamais le réseau.
