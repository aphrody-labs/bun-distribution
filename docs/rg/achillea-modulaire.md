# Achilléa modulaire — architecture portable

Achilléa a été découpée pour que **le framework soit un détail remplaçable**.
L'objectif n'est pas esthétique : il s'agit de pouvoir migrer le front Angular
vers Next.js + Tailwind + shadcn, ou d'ouvrir un client de jeu Rust, ou une app
mobile, sans réécrire le domaine.

## Les quatre couches

```
packages/achillea-types      contrat pur (DTO + enums), zéro dépendance
        ▲                    → traduisible en Rust / Swift / Kotlin
        │
packages/achillea-core       règles métier pures, multi-runtime
        ▲                    → Elo, brackets, droits, libellés, tonalités
        │
packages/achillea-client     accès API isomorphe (fetch + zod), zéro framework
        ▲                    → 197 routes, 16 ressources
        │
        ├── apps/achillea-bot     Bun      — API + Discord
        └── apps/website          Next 16  — interface publique et consommation directe

packages/achillea-contract   JSON Schema + Rust + Swift + Kotlin générés
                             → les cibles hors TypeScript
```

La dépendance ne va que vers le haut. Un paquet ne connaît jamais celui qui le
consomme, et aucune des trois premières couches ne sait qu'Angular existe.

## Ce que chaque couche a le droit de contenir

| Paquet     | Contient                                                        | Interdit                                                     |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `types`    | `interface`, `type`, `enum`                                       | fonction, classe, `=>`, toute dépendance, tout import runtime  |
| `core`     | fonctions pures, tables de constantes                             | `node:*`, `bun:*`, `window`, `document`, `process.env`, DI, ORM |
| `client`   | accès HTTP `fetch` + schémas de validation                        | Angular, React, RxJS, `window`, `server-only`                  |
| `contract` | extraction + génération                                           | —                                                              |

Ces règles ne sont pas déclaratives : elles sont **tenues par des tests**.

- `packages/achillea-types/test/purity.test.ts` — refuse toute fonction, toute
  dépendance runtime, tout import hors paquet.
- `packages/achillea-core/tests/portability.test.ts` — scanne les sources et
  refuse `node:`, `bun:`, `@angular/`, `react`, `rxjs`, `discord.js`,
  `@mikro-orm/`, `tsyringe`, `Bun.`, `process.env`, `window.`, `document.`,
  `localStorage`.
- `apps/website/src/lib/achillea/achillea.test.ts` — vérifie que les trois
  paquets s'importent et fonctionnent dans la chaîne de build Next.js.

Un glissement casse la CI le jour même, pas six mois plus tard.

## Ce que les tests garantissent

La suite ne se contente pas de confirmer le code : elle est écrite pour le
mettre en défaut. Chaque famille a été validée **par mutation** — on casse
volontairement la source, on vérifie que le test tombe. Un test incapable
d'échouer ne protège rien ; c'est exactement ce qui était arrivé au hook
`bun.lock`, dont le garde ne s'est jamais déclenché pendant des mois.

| Famille | Fichier | Ce qu'elle interdit |
| --- | --- | --- |
| Exhaustivité | `core/tests/exhaustivity.test.ts` | Un membre d'enum sans libellé, un enum entier oublié, deux membres au même libellé, un `switch` dont tous les `case` tombent dans le `default` |
| Robustesse | `core/tests/robustness.test.ts` | Un `NaN`, un `Infinity`, un négatif ou un `null` qui traverse une fonction de domaine et finit à l'écran |
| Portabilité | `core/tests/portability.test.ts` | Un `node:`, `bun:`, `@angular/`, `window` glissé dans le métier |
| Pureté | `types/test/purity.test.ts` | Une fonction, une dépendance ou un libellé dans le contrat |
| Solidité du généré | `contract/tests/soundness.test.ts` | Une collision de noms après conversion, un mot réservé non échappé, un type référencé mais jamais déclaré |
| Invariants de surface | `client/tests/invariants.test.ts` | Une URL malformée, une méthode qui n'émet aucune requête, une exception sur un 500 |

Les propriétés sont préférées aux cas : `winRate` n'est pas testé sur trois
valeurs mais sur la propriété « reste dans `[0, 1]` pour toute entrée », ce qui
couvre aussi ce qu'on n'a pas imaginé. C'est ainsi qu'ont été trouvés les onze
bugs listés au `CHANGELOG`, dont cinq partageaient une même racine :
`Math.max(0, Math.floor(x))` ne neutralise pas `NaN`.

`@rosegriffon/achillea-core/numbers` est la réponse structurelle à cette
famille : toute entrée numérique venue de l'extérieur y passe
(`toFinite`, `toCount`, `toPositiveInt`, `clamp`, `euclideanMod`), et la règle
tient en une phrase — `Number()` seul ne borne rien, `Number(null)` vaut `0`.

## Le contrat comme frontière réelle

`packages/achillea-contract` lit les sources de `achillea-types` (AST
TypeScript) et régénère à chaque build :

| Fichier                | Cible                          |
| ---------------------- | ------------------------------ |
| `achillea.schema.json` | JSON Schema 2020-12            |
| `achillea.rs`          | Rust + `serde` (vérifié par `cargo check`) |
| `Achillea.swift`       | Swift `Codable`                |
| `Achillea.kt`          | Kotlin `kotlinx.serialization` |

```bash
bun --filter @rosegriffon/achillea-contract generate   # régénère
bun --filter @rosegriffon/achillea-contract check      # CI : échoue si périmé
```

C'est ce qui rend l'énoncé « migrable vers un jeu Rust ou une app mobile »
vérifiable plutôt que déclaratif : les 226 formes du domaine ne sont jamais
retapées à la main. Détails et conventions de traduction :
`packages/achillea-contract/README.md`.

Le générateur échoue bruyamment sur ce qu'il ne sait pas traduire, plutôt que
d'aplatir en `unknown` : `Omit`/`Pick` hors clause d'héritage, littéral de type
inconnu, construction exotique. C'est ce qui a permis d'attraper que
`WireTournament extends Omit<Tournament, …>` ne produisait que ses quatre
champs propres — les trente hérités disparaissaient sans avertissement.

## Ce que la modularisation a supprimé

Avant, les DTO vivaient en double : une copie dans `achillea-types` (consommée
par le bot) et une copie dans le front Angular retiré, qui divergeaient
silencieusement — un `UserDTO` sans
`type`, des enums `LobbyState`/`TeamSide`/`PlayerNoteCategory` redéclarés,
`MatchMode` en `const` d'un côté et en `enum` de l'autre.

Ces 1 621 lignes de modèles Angular sont devenues **230 lignes de ré-exports**,
et les 66 contrats que le client avait dû déclarer faute de les trouver ont
rejoint `achillea-types`. Il n'existe plus qu'une seule déclaration par forme.

Même mouvement pour la logique : libellés, tonalités, barèmes de podium,
prédicat d'organisateur, résolution d'avatar Discord, jointure d'URL d'API,
arithmétique de pagination — tout ce qui était dans des services et des helpers
Angular vit désormais dans `core`, et le web n'en garde que le pont.

## Le client comme seule porte d'entrée de l'API

`@rosegriffon/achillea-client` couvre les 197 routes de l'API sur 16
ressources (`client.tournaments`, `client.ranked`, `client.clans`, …). Deux
propriétés en font une brique de migration et pas un simple wrapper :

- **Les schémas sont verrouillés sur le contrat** par `satisfies z.ZodType<Dto>`.
  Une divergence entre le schéma de validation et le DTO casse le `type-check`,
  elle ne se découvre pas en production.
- **Aucune exception sur erreur réseau ou HTTP** : le résultat est
  `{ ok: true, value } | { ok: false, kind, … }`. Un Server Component peut donc
  afficher l'échec sans `try/catch`, et une app mobile le traiter comme un état.

L'authentification passe par `credentials` (cookie de session) ou
`getAuthToken` / `tokenStore` — une interface injectée, jamais un accès direct
à un stockage de plateforme, ce qui laisse le paquet utilisable hors navigateur.

## Tonalités : décider sans décider de la couleur

Le métier dit « ceci est grave », jamais « ceci est rouge » :

```ts
import { sanctionTypeTone, TONE_TO_SHADCN_BADGE } from "@rosegriffon/achillea-core";

sanctionTypeTone(SanctionType.Ban);                     // "danger"
TONE_TO_SHADCN_BADGE[sanctionTypeTone(SanctionType.Ban)]; // "destructive"
```

Les valeurs de `Tone` (`success`, `warn`, `info`, `danger`, `secondary`,
`contrast`) sont des mots neutres que PrimeNG consomme tels quels côté Angular,
et que `TONE_TO_SHADCN_BADGE` / `TONE_TO_TAILWIND` traduisent côté React. Une
troisième cible ajoute sa propre table, sans toucher au métier.

## Consommer Achilléa depuis `apps/website`

Les trois paquets sont déclarés dans `apps/website/package.json` et listés dans
`transpilePackages` de `next.config.ts` (ils sont consommés en source
TypeScript, comme les autres workspaces).

```tsx
// Server Component
import { createAchilleaClient, stageTypeLabel, badgeVariant, tournamentStateTone }
	from "@/lib/achillea";
import { Badge } from "@rosegriffon/ui";

export default async function Page() {
	const client = createAchilleaClient();
	const result = await client.tournaments.list();
	if (!result.ok) return <p>Achilléa est injoignable.</p>;

	return result.value.data.map((tournoi) => (
		<article key={tournoi.id}>
			<h2>{tournoi.name}</h2>
			<Badge variant={badgeVariant(tournamentStateTone(tournoi.internalState))}>
				{stageTypeLabel(tournoi.tournamentType)}
			</Badge>
		</article>
	));
}
```

Le client ne lève jamais sur une erreur réseau ou HTTP : il renvoie un résultat
typé (`{ ok: false, kind }`), ce qui permet de l'afficher depuis un Server
Component sans `try/catch`.

Configuration : `NEXT_PUBLIC_ACHILLEA_API_URL`. Rappel du `CLAUDE.md` — les
`NEXT_PUBLIC_*` sont inlinés au build, donc lancer le déploiement depuis l'app
et pas depuis la racine.

## Portée du scope `@rosegriffon/*`

Les paquets et apps Achilléa suivent désormais la convention du monorepo :

| Avant              | Après                            |
| ------------------ | -------------------------------- |
| `@achillea/types`  | `@rosegriffon/achillea-types`    |
| `@achillea/core`   | `@rosegriffon/achillea-core`     |
| `@achillea/client` | `@rosegriffon/achillea-client`   |
| —                  | `@rosegriffon/achillea-contract` |
| `achillea-bot`     | `@rosegriffon/achillea-bot`      |

Les chemins sur disque (`apps/achillea-*`, `packages/achillea-*`) et le nom de
projet Angular sont inchangés : aucun service systemd ni chemin de déploiement
n'est affecté.

## Vérification

```bash
bun --filter @rosegriffon/achillea-types    type-check && bun --filter @rosegriffon/achillea-types    test
bun --filter @rosegriffon/achillea-core     type-check && bun --filter @rosegriffon/achillea-core     test
bun --filter @rosegriffon/achillea-client   type-check && bun --filter @rosegriffon/achillea-client   test
bun --filter @rosegriffon/achillea-contract type-check && bun --filter @rosegriffon/achillea-contract test
bun --filter @rosegriffon/achillea-contract check
bun --filter @rosegriffon/achillea-bot      type-check
bun --filter @rosegriffon/website           type-check
```

Tout est enchaîné dans `.github/workflows/ci.yml`.

## Prochaine étape si l'on migre le front

L'ordre qui minimise le risque, sachant que les trois couches basses sont déjà
prêtes :

1. Monter les écrans lecture seule (classement, tournois, profils) dans
   `apps/website` en Server Components — ils ne dépendent que de `client` +
   `core`, déjà branchés et testés.
2. Porter les écrans authentifiés, en remplaçant `AuthSessionService` par le
   `getAuthToken` / `credentials` du client.
3. Ne porter qu'en dernier le temps réel (`ranked-room-service`, Colyseus,
   Socket.IO) : c'est le seul endroit où Angular n'est pas un simple
   adaptateur.

Le reste — 4 746 lignes de services Angular — est de l'appel HTTP et de la mise
en forme, et n'a plus de logique métier à sauver.
