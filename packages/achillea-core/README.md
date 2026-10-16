# `@rosegriffon/achillea-core`

Logique métier **portable** d'Achilléa : un seul code source qui tourne en **navigateur**, en **edge (Deno / Web)**, en **Node** et en **Bun**.

Aucune dépendance Discord (`discord.js` / `@aphrody/discordx`), ORM (`@mikro-orm/*`), DI (`tsyringe`) ni API Node-only. Uniquement des standards Web (`crypto.subtle`, `crypto.getRandomValues`, `Intl`, `URL`, `TextEncoder`) + `@rosegriffon/achillea-types`, `@casl/ability`, `@sindresorhus/transliterate`.

## Domaines

| Import                         | Contenu                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `…/achillea-core/elo`          | `computeMatchElo`, `expectedScore`, `eloDelta`, `applyEloUpdate`, `placementPrizeAp`                            |
| `…/achillea-core/ranking`      | `eloToTier`, `eloToRankKey`, `computePercentile`                                                                |
| `…/achillea-core/league`       | Championnat : calendrier, points, classement (référence Asytral S1)                                             |
| `…/achillea-core/tournaments`  | Points de circuit, paliers, `canReportTournamentScore`, `isTournamentOrganizer`                                 |
| `…/achillea-core/brackets`     | `stageRounds`, `stageMatchCount`, `byeCount`, `standardSeedOrder`, `matchGameCount`, `roundLabel`               |
| `…/achillea-core/stats`        | `winRatePercent`, `goalDifference`, `longestStreak`, `tierDistribution`, `downsample`, `median`                 |
| `…/achillea-core/clans`        | Hiérarchie, `canActOnMember`, `sortClanMembers`, `isClanRecruiting`, priorité des distinctions                  |
| `…/achillea-core/casts`        | `castReadiness`, `canGoLive`, `canTransitionCastStatus`, `rankCandidatesForRole`                                |
| `…/achillea-core/sanctions`    | `evaluateEscalation` (3/5/8 → mute/ban)                                                                         |
| `…/achillea-core/licenses`     | `formatLicenseNumber`, `generateQrSecret`, `evaluateLicenseValidity`, `signHmacSha256`                          |
| `…/achillea-core/votes`        | `evaluateProposalOutcome` (MAJORITY / SUPERMAJORITY_2_3 / UNANIMOUS)                                            |
| `…/achillea-core/wallet`       | `signedAmount`, `netAmount`, `applyTransactions`, `canAfford`, `totalsByType`                                   |
| `…/achillea-core/access`       | `buildAbilityFor` (CASL RBAC), `AchilleaRole`                                                                   |
| `…/achillea-core/pagination`   | `pageCount`, `clampPage`, `pageOffset`, `buildPageMeta`, `normalizePageQuery`, `pageWindow`                     |
| `…/achillea-core/http`         | `joinApiUrl`, `buildQueryString`, `withQuery`                                                                   |
| `…/achillea-core/identity`     | `resolveDiscordAvatarUrl`, `discordDefaultAvatarUrl`, `rankImagePath`                                           |
| `…/achillea-core/labels`       | Libellés fr-FR de tous les enums + options de `<select>`                                                        |
| `…/achillea-core/presentation` | `Tone` neutre + `TONE_TO_SHADCN_BADGE` / `TONE_TO_TAILWIND` et les mappeurs métier                              |
| `…/achillea-core/format`       | `formatDate`, `formatNumber`, `formatAchCurrency`                                                               |
| `…/achillea-core/names`        | `normalizeNames`                                                                                                |
| `…/achillea-core/validation`   | `validString`, `isValidUrl`, `numberAlign`, `chunkArray`                                                        |
| `…/achillea-core/enums`        | Ré-export des enums de contrat + `VotingStrategy`, `AchilleaRole`                                               |

> Tout est aussi exporté depuis la racine `@rosegriffon/achillea-core`. Le bot (TS `moduleResolution: Node`) importe **uniquement** depuis le specifier bare ; les sous-chemins (`/elo`, …) sont destinés aux consommateurs en résolution `bundler`/`Node16`/Deno.

## Portabilité tenue par un test

`tests/portability.test.ts` scanne toutes les sources et échoue sur `node:`,
`bun:`, `@angular/`, `react`, `rxjs`, `discord.js`, `@mikro-orm/`, `tsyringe`,
`Bun.`, `process.env`, `window.`, `document.`, `localStorage`, et sur toute
dépendance runtime hors des trois autorisées. Une régression casse la CI le
jour même.

Architecture d'ensemble : [`docs/achillea-modulaire.md`](../../docs/achillea-modulaire.md).

## Exemples de consommation par cible

### 1. Angular (navigateur) — service injectable + supabase-js

```ts
import { Injectable, signal } from "@angular/core";
import { computeMatchElo, eloToRankKey, type RankTier } from "@rosegriffon/achillea-core";
import { createClient } from "@supabase/supabase-js";

@Injectable({ providedIn: "root" })
export class RankingService {
	private supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
	readonly tiers = signal<RankTier[]>([]);

	async preview(myElo: number, oppElo: number) {
		const { newWinner } = computeMatchElo(myElo, oppElo);
		return eloToRankKey(newWinner, this.tiers()); // "Gold", "Diamond", …
	}
}
```

### 2. Fonction serverless / Edge (Node)

```ts
// api/escalate.ts
import { evaluateEscalation } from "@rosegriffon/achillea-core";

export async function POST(req: Request) {
	const { activeWarns } = await req.json();
	const decision = evaluateEscalation(activeWarns); // null | { type, durationSec }
	return Response.json({ decision });
}
```

### 3. Supabase Edge Function (Deno / Web)

```ts
// supabase/functions/verify-license/index.ts
import { evaluateLicenseValidity, isValidLicenseNumber } from "npm:@rosegriffon/achillea-core/licenses";

Deno.serve(async (req) => {
	const { licenseNumber, status, validUntil } = await req.json();
	if (!isValidLicenseNumber(licenseNumber)) {
		return new Response("format invalide", { status: 400 });
	}
	const result = evaluateLicenseValidity({ status, validUntil });
	return Response.json(result); // { valid, reason? }
});
```

### 4. Script Bun

```ts
// scripts/recompute-ranks.ts
import { computeMatchElo, DEFAULT_K_FACTOR } from "@rosegriffon/achillea-core/elo";

const { newWinner, newLoser, delta } = computeMatchElo(1000, 1000, DEFAULT_K_FACTOR);
console.info({ newWinner, newLoser, delta }); // { 1016, 984, 16 }
```

### 5. Webhook handler (signature HMAC, Web Crypto — Node / edge / Bun)

```ts
import { signHmacSha256, verifyHmacSha256 } from "@rosegriffon/achillea-core/licenses";

// Émission d'un QR auto-vérifiable
const payload = JSON.stringify({ licenseNumber: "ACH-2026-00042" });
const signature = await signHmacSha256(payload, secret);

// Réception
const ok = await verifyHmacSha256(payload, incomingSignature, secret);
if (!ok) throw new Error("signature invalide");
```

## Développement

```bash
bun run --filter @rosegriffon/achillea-core type-check
bun run --filter @rosegriffon/achillea-core test   # bun test (tests/core.test.ts + tests/domains.test.ts)
bun run --filter @rosegriffon/achillea-core lint
bunx oxfmt packages/achillea-core
```

> Consommé **en source** (`main`/`types`/`exports` pointent sur `./src/*.ts`) : pas de build séparé, les consommateurs (web, bot, edge) importent directement le TypeScript.
