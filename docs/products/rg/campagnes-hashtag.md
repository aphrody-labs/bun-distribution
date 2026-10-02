# Campagnes à hashtag — récolte, tolérance aux fautes, relais Discord

Une campagne (`#IERGDay`, `#InatoberRG`, `#InazumaRG`…) est pilotée **en base**,
dans `public.x_campagnes` : hashtags, règlement, visuels, bornes de dates, salon
de dépôt, salon de relais. Ouvrir, fermer ou corriger une campagne est un
`UPDATE`, jamais un déploiement — le hashtag exact n'est souvent connu que
quelques jours avant le lancement.

## Les trois chemins d'une création

| Source | Collecteur | Table |
| --- | --- | --- |
| X (le hashtag) | `packages/cron/src/tasks/ie-crawl/hashtag-harvest.ts` | `x_campagne_posts` × `tweets` |
| Discord (salon de dépôt) | `packages/cron/src/tasks/campagnes-discord.ts` | `campagne_creations_discord` × `discord_messages` |
| Instagram (dépôt manuel) | **aucun collecteur possible** — formulaire `/iergday` | `campagne_creations_instagram` |

Instagram est autorisé par le règlement, mais **aucun collecteur de hashtag
Instagram n'existe** : toutes les portes sont fermées à un client non connecté, et
l'API officielle demande une revue Meta de plusieurs semaines (mesures et
décision dans [insta.md](insta.md)). C'est donc le participant qui dépose son
permalien et son image, ce qui rend l'attribution **exacte** — l'API Graph, elle,
ne rend même pas le pseudo. La tâche `campagnes:instagram` revérifie ensuite ces
liens toutes les 12 h : sans elle, un post supprimé chez Instagram laisserait une
carte morte dans la galerie pour toujours.

Les trois sources remontent dans la même galerie publique
(`apps/website/src/lib/x-campagnes/queries.ts`), discriminées par `source`.

## Anticiper les fautes de frappe

`packages/cron/src/tasks/ie-crawl/hashtag-variantes.ts` — module **pur**, 33 tests.

Un participant recopie le hashtag à la main, depuis une affiche, souvent sur un
téléphone. `#IERGDay` arrive donc aussi en `#IERG_Day`, `#iergday2026`,
`#IERGDya`, `#IERGDy`. Chacune de ces formes est une création qui compte.

**L'index de X est EXACT** : `#IERGDay` ne remonte jamais `#IERGDya`. D'où deux
mécaniques distinctes :

1. **`variantesRecherche()`** — la liste **bornée** (12) des graphies qu'on
   *demande* à X : tiret bas au point de composition, millésime, pluriel,
   transpositions, lettre doublée, lettre avalée. Elles sont empaquetées par
   `requetesVariantes()` en **une seule requête `OR`** : X facture la page, pas le
   terme, donc douze graphies coûtent le prix d'une.
2. **`apparierHashtag()`** — le filet local, appliqué à **tout** ce que X renvoie.
   Distance de **Damerau**-Levenshtein (la transposition compte pour *une* faute,
   pas deux), tolérance 1 à partir de 6 caractères, 2 à partir de 12. La graphie
   exacte l'emporte toujours sur une variante présente dans le même post.

Ce qui n'est **pas** produit : les substitutions de touches voisines (elles font
exploser la liste sans correspondre à une faute de copie).

Les requêtes déclarées dans `x_campagnes.requetes` restent en tête et ne sont
jamais remplacées : ce sont elles qui portent la vérité éditoriale (notamment le
`since:` qui borne la campagne). `filtresDeRequete()` les recolle aux requêtes de
variantes — sans le `since:`, une variante rapatrierait toute l'histoire du
hashtag, éditions précédentes comprises.

## Relais Discord

`packages/cron/src/tasks/campagnes-relais-discord.ts` — toutes les 15 minutes
(`campagnes:relais`).

Le bot dépose **chaque création, quelle que soit sa source**, dans
`x_campagnes.relais_salon`. Pour IERG Day c'est `⚙🍰〡iergday-staff`
(`1537470522764304435`).

> ⚠ **Le salon de relais n'est PAS le salon de dépôt.** `salons_depot`
> (`🍰〡iergday`) est l'endroit **public** où les membres déposent eux-mêmes ;
> `relais_salon` est le fil de suivi de l'équipe. Confondre les deux ferait
> republier par le bot, dans le salon public, ce qu'un membre vient d'y poster.

Le message porte les **émotes des mascottes** (`RG_gaelle_hautparleur`,
`RG_roy_confetti`) et reçoit deux réactions (`RG_Roy_coeur1`,
`RG_Gaelle_coeur1`) — surchargeables par `RG_EMOTE_*` / `RG_REACTION_*`. Une
émote personnalisée n'existe que sur le serveur qui la porte : les identifiants
sont ceux relevés sur `GET /guilds/{id}/emojis`, jamais devinés.

Quatre garde-fous :

- **Idempotence** — `x_campagne_relais (campagne, source, référence)`. La ligne
  est écrite **après** l'accusé de réception de Discord, jamais avant.
- **Garde anti-déluge** — `relais_depuis` : seules les créations parues à partir
  de cet instant partent. Sans elle, activer le relais sur une campagne archivée
  déverserait ses centaines de créations d'un coup.
- **Modération respectée** — une création `masque` est rangée avec son motif, pas
  reconsidérée à chaque passe.
- **Aucune mention** — `allowed_mentions: { parse: [] }`. Le texte d'une création
  peut contenir `@everyone`.

L'ordre d'envoi est **chronologique croissant, toutes sources confondues** : le
tri est fait en TypeScript, deux requêtes triées séparément se concaténeraient en
deux blocs plutôt qu'en une chronologie.

## Mise en service d'une campagne

```sql
update public.x_campagnes
   set salons_depot  = array['<salon public>'],
       relais_salon  = '<salon de suivi>',
       relais_depuis = now()          -- ou debut_le
 where slug = '<slug>';
```

`discord:archives` (dans la veille, toutes les 5 min) arme automatiquement les
salons de `salons_depot` : rien d'autre à faire.

## Commandes

```bash
bun packages/cron/src/index.ts --run x:campagnes [slug]         # récolte X
bun packages/cron/src/index.ts --run campagnes:discord [slug]   # récolte Discord
bun packages/cron/src/index.ts --run campagnes:instagram [slug] # revalidation Instagram
bun packages/cron/src/index.ts --run campagnes:relais [slug]    # relais
bun packages/cron/src/tasks/campagnes-relais-discord.ts --campagne iergday --dry
```

## Tests

```bash
bun test packages/cron/src/tasks/            # 160 tests
bun test apps/website/src/lib/images/        # lecture des dimensions d'image
```
