# Charte de présentation des bots Discord

Les deux bots — Rose Griffon et Azalée — servent un serveur de plus de deux
mille membres. Ce qui rend leurs réponses lisibles n'est pas la richesse d'un
embed isolé, c'est la **répétition** : la même couleur veut toujours dire la
même chose, le même bouton fait toujours la même chose, le pied de page dit
toujours d'où vient la réponse.

Tout ce qui suit vit dans **`apps/bot/src/lib/ui/`** et n'a qu'un point
d'entrée :

```ts
import { fiche, differer, succes, echec, vide, pied, rangeePagination } from "../lib/ui";
```

| Module | Rôle | `discord.js` ? |
| --- | --- | --- |
| `theme.ts` | couleurs, icônes, marque du profil, limites de l'API | non |
| `texte.ts` | bornage, échappement, assemblage, horodatage natif | non |
| `nombres.ts` | entiers, pourcentages, octets, latences, durées | non |
| `etat.ts` | comptage des pages, grammaire du `customId` | non |
| `embed.ts` | `creerEmbed`, `pied`, `piedTexte`, classe `Fiche` | oui |
| `pagination.ts` | rangée de boutons normalisée, bouton de lien | oui |
| `reponse.ts` | différer, charges `succes`/`echec`/`vide`, gardes | oui |

C'est l'équivalent Discord de ce qu'est `@rose-griffon/ui` pour les deux apps
Next : **aucune commande n'écrit une couleur, une émoji d'état ou une limite
d'API en dur.**

## Le patron d'une commande

```ts
@Slash({ name: "fiche", description: "La fiche d'un personnage du jeu" })
async fiche(@SlashOption({ … }) recherche: string, interaction: ChatInputCommandInteraction) {
  await differer(interaction);                       // 1. différer AVANT toute E/S
  try {
    const perso = await azalee().character(recherche); // 2. lire
    if (!perso) {
      await repondre(interaction, vide("Aucun personnage", "Essaie le nom japonais ou un identifiant."));
      return;
    }
    const f = fiche({ titre: texteFr(perso.names), url: urlWiki(`/chara/${perso.slug}`) }) // 3. peindre
      .champ("Identité", identite, { enLigne: true })
      .miniature(portrait);
    await interaction.editReply({
      embeds: [piedDeCommande(f.finir(), interaction)],  // 4. pied = provenance + marque
      components: rangeePagination({ … }),               // 5. pagination si besoin
    });
  } catch (err) {
    await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err))); // 6.
  }
}
```

1. **Différer d'abord.** Discord n'accorde que trois secondes au premier accusé
   de réception. `differer(interaction, { prive: true })` pour `/staff` et
   `/administration`, sans option pour les surfaces de communauté.
2. **Lire.** Tout le calcul vit dans un module pur (`lib/*-format.ts`), testé
   sans bot ni base.
3. **Peindre avec `fiche()`.** Elle tient le budget des 6 000 caractères *à
   l'ajout* : un champ qui ne rentre plus n'est pas posé (et `tronquee` passe à
   `true`) au lieu de faire refuser le message entier.
4. **Poser le pied.** `piedDeCommande(embed, interaction)` écrit
   `/agenda semaine · page 2/5 · Rose Griffon · rosegriffon.fr` avec l'icône de
   marque. Hors interaction (annonce automatique), `pied(embed, { note })`.
5. **Paginer avec `rangeePagination`** — jamais une rangée maison.
6. **Rattraper en `echec(titre, quoi-faire)`**, jamais en texte nu.

## Couleurs

| Intention | Emploi | Valeur |
| --- | --- | --- |
| `marque` | réponse normale (l'écrasante majorité) | couleur du profil (`#a14b3f` / `#F89C5A`) |
| `succes` | une action a abouti | `#3BA55D` |
| `attention` | résultat partiel, donnée périmée, limite atteinte | `#FAA61A` |
| `echec` | l'action a échoué | `#ED4245` |
| `info` | rappel de syntaxe, renvoi vers une autre commande | `#5865F2` |
| `muet` | vrai mais accessoire, liste vide | `#2B2D31` |

Les quatre couleurs d'état sont celles du client Discord : le membre les a déjà
apprises ailleurs. La couleur ne porte jamais l'information seule — le texte
reste lisible en noir et blanc.

## Icônes

Une icône par idée, toujours la même, toujours Unicode (une émoji personnalisée
n'existe que sur le serveur qui la porte, et les deux bots en servent deux).
Le lexique complet est `ICONES` dans `theme.ts`.

## Pagination

Une seule rangée pour toutes les listes du bot :

```
⏮  ◀  « 3 / 17 »  ▶  ⏭       (les sauts n'apparaissent qu'au-delà de 5 pages)
```

Le repère central n'est jamais cliquable : sur mobile, le pied de l'embed est
tronqué, et sans lui on ignore où l'on se trouve.

L'état d'une liste (page, filtres, recherche) est **entièrement porté par le
`customId`** :

```
<prefixe>|<champ>|<champ>|…        encoderEtat("az", ["galerie", 3, null, "mark"])
```

Aucune mémoire de processus : un redémarrage ne laisse jamais de bouton mort, et
deux membres parcourent la même liste sans se voler leur position. Au-delà des
**100 caractères** imposés par Discord, `encoderEtat` rend `null` et la rangée
disparaît — un composant refusé ferait échouer l'envoi du message entier, embed
compris.

## Limites de l'API (dures)

| Champ | Limite |
| --- | --- |
| titre | 256 |
| description | 4 096 |
| nom / valeur de champ | 256 / 1 024 |
| champs par embed | 25 |
| pied | 2 048 |
| **total d'un embed** | **6 000** |
| contenu texte d'un message | 2 000 |
| `customId` | 100 |
| propositions d'autocomplétion | 25 × 100 caractères |

Un dépassement ne tronque pas : l'API **refuse le message entier**, et le membre
ne voit rien — pas même une erreur partielle. `LIMITES` (`theme.ts`) fait
autorité ; `Fiche` et `borner()` les tiennent pour vous.

## Ce qui est éphémère

- **Toujours** : `/staff` et `/administration` (elles nomment des unités
  systemd, des ports en boucle locale, des identifiants internes), les refus
  d'accès, les échecs, les clics sur les boutons d'un autre membre.
- **Jamais** : les fiches de jeu, l'agenda, la boutique, les listes publiques —
  leur intérêt est d'être lues par le salon.

## Règles de nommage des commandes

- Racine = un **nom** au singulier (`/agenda`, `/boutique`, `/membre`,
  `/azalee`), sous-commande = un **verbe** ou un **objet** (`/agenda semaine`,
  `/administration role donner`).
- Tout en minuscules, sans accent ni tiret (contrainte de l'API).
- Description : une phrase, en français, sans point final, ≤ 100 caractères,
  qui dit **ce que le membre obtient**, pas ce que le code fait.
- Une commande qui écrit vit sous `/administration`, une commande qui lit
  l'exploitation sous `/staff`, le reste est public.
- Les deux bots ont des listes de modules **disjointes** (`lib/profil.ts`) : une
  même commande n'est jamais servie deux fois sur un même serveur.

## Tests

`bun test apps/bot/src/lib/ui` couvre le bornage, le budget d'embed, la forme du
pied, la grammaire des `customId` et le dessin de la rangée de pagination —
c'est-à-dire tout ce qui, sinon, ne se voit qu'en cliquant dans Discord.
