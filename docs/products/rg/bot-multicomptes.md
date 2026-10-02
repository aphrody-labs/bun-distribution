# Rapprochement de comptes — `/moderation multicomptes`

Reconnaître les comptes Discord qui pourraient appartenir à une même personne :
un membre banni qui revient sous un autre pseudo, un compte d'appoint qui vote
deux fois à un sondage, une vague de comptes jetables arrivée en une minute.

**Ce dispositif ne prouve rien.** Discord ne donne ni adresse IP ni empreinte
d'appareil : tout repose sur des ressemblances observables, et la conclusion
appartient au staff. Aucune commande ne sanctionne, ne recommande de sanction,
ni ne publie quoi que ce soit — les quatre sous-commandes répondent en éphémère.

## Les commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `/moderation multicomptes membre <membre> [niveau]` | Les comptes qui ressemblent à un membre, avec le détail des indices. |
| `/moderation multicomptes balayage [niveau] [jours]` | Tout le serveur, du plus fort au plus faible, paginé. |
| `/moderation multicomptes verdict <a> <b> <décision> [motif]` | Confirme une paire, l'écarte, ou annule un verdict posé. |
| `/moderation multicomptes tranchees` | Ce que le staff a déjà décidé. |

Toutes exigent le rôle `admin` ou `staff` dans `profiles` (garde
`requireRgAdmin`, `lib/rbac.ts`), et le serveur Rose Griffon : `discord_members`
n'a pas de colonne `guild_id`, elle ne décrit que cette communauté.

## Les indices

| Indice | Poids | Ce qu'il constate |
| --- | --- | --- |
| 🔗 Même compte du site | 70 | Deux comptes Discord rattachés au même profil, courriel, Steam ou Patreon. **Ce n'est pas une ressemblance** : la personne l'a établi elle-même en se connectant. Mais c'est aussi le plus rare — 16 membres sur 2 079 portent une liaison exploitable (voir *Limites*). |
| 🖼️ Même avatar | 34 | Même condensat d'image — donc le même fichier téléversé. Dégressif : partagé par huit comptes, il ne vaut presque plus rien. |
| 🏷️ Même surnom | 24 | Même surnom posé sur le serveur. |
| 🔁 Relève | 24 | Un compte part, l'autre arrive dans la foulée. Le motif du contournement de sanction. |
| 🔤 Même racine de pseudo | 22 | `markevans` et `markevans_alt2` tombent sur la même racine. Dégressif aussi. |
| 🔤 Pseudos voisins | 18 | Ressemblance entre toutes les identités (pseudo, nom d'affichage, surnom) des deux comptes. |
| 🕰️ Activités alternées | 18 | Jamais actifs dans le même créneau de dix minutes, alors qu'ils écrivent dans les mêmes salons. **Ne se déclenche pas encore** : l'archive manque de matière (voir *Limites*). |
| 🥚 Créations rapprochées | 18 | Comptes créés à quelques heures d'intervalle (date lue dans le flocon). |
| 🚪 Arrivées rapprochées | 16 | Arrivés sur le serveur à quelques minutes d'intervalle. |
| 🌱 Compte neuf | 8 | Le plus récent a rejoint moins d'une semaine après sa création. Exige un indice **d'identité** à côté : « créé la veille de son arrivée » décrit la moitié des nouveaux membres. |
| 👥 Activités simultanées | −8 | Souvent actifs en même temps. **Ne disculpe pas** — on tient très bien deux comptes sur deux appareils. |

**Les trois indices de date partagent un budget de 24 points** — le seuil de
« à examiner », et pas un de plus. Ils ne sont pas indépendants : deux amis
invités le même soir créent leur compte dans la même demi-heure, rejoignent
dans la même minute et sont neufs à l'arrivée. Sans ce plafond, cela faisait
42 points, c'est-à-dire « faisceau d'indices » sur deux personnes qui ont
cliqué sur la même invitation — et 92 % des rapprochements reposaient sur ces
trois-là seuls. Une cohorte d'arrivée est un contexte, pas une preuve.

Le score est la somme des poids, et le niveau en découle :

| Niveau | Seuil | Lecture |
| --- | --- | --- |
| 🟥 Rattachement établi | 65 | Ou dès qu'une liaison déclarée existe. |
| 🟧 Faisceau d'indices | 42 | Plusieurs constatations indépendantes concordent. |
| 🟨 À examiner | 24 | La valeur par défaut du balayage. |
| ⬜ Coïncidence | 12 | Deux comptes créés le même jour, rien de plus. |

**Aucun indice observable n'atteint seul le seuil de « faisceau »**, et aucune
constatation n'est facturée deux fois — un surnom partagé ne peut pas compter à
la fois comme « même surnom » et comme « pseudos voisins ». C'est le calibrage,
et `lib/multicomptes.test.ts` le verrouille.

## Ce qui a été refusé

- **L'adresse postale.** `profiles` porte les adresses de livraison des
  acheteurs de la boutique, et deux commandes expédiées à la même adresse
  seraient un indice puissant. Il est écarté : son faux positif le plus probable,
  ce sont deux frères et sœurs — exactement le double compte *légitime* que
  l'outil doit épargner — et l'afficher révélerait au staff que deux membres
  vivent sous le même toit.
- **Les avatars par défaut.** Discord n'en sert que cinq pour toute la
  plateforme ; 122 membres se les partagent, dont 25 sur la même image. Les
  compter produirait à lui seul plus de fausses paires que tout le reste n'en
  produit de vraies.
- **L'action automatique.** Rien ne bannit, rien n'alerte, rien ne se publie.
  « Trois comptes rapprochés ⇒ exclusion » est une règle de communauté, pas une
  règle de code.

## Les verdicts

Le rapprochement ne stocke aucun score : il recalcule tout à chaque appel, parce
qu'un score figé se périme à la première réinscription. Ce qui persiste, c'est la
décision humaine, dans `bot_multicomptes_verdicts` (migration
`apps/website/sql/migrations/20260829_bot_multicomptes.sql`).

- `confirme` — une note, rien de plus : elle ne bannit personne.
- `ecarte` — la paire cesse de remonter dans `balayage`. Elle reste visible sur
  la fiche de chaque membre concerné : masquer au staff sa propre décision serait
  pire que de la répéter.

Sans ces verdicts, chaque balayage remonterait les mêmes faux positifs, et un
outil qui redemande sans cesse la même chose finit par n'être plus lu.

## Fonctionnement

```
discord_members ─┐
discord_messages ├─→ services/multicomptes.ts ─→ lib/multicomptes.ts ─→ commande
account, profiles┘   (SQL, cache 5 min)          (module pur, testé)
```

- **`lib/multicomptes.ts`** — module pur : normalisation des pseudos (accents,
  « leet », alphabets décoratifs, suffixes de double compte), distance de
  Levenshtein plafonnée, poids, seuils, regroupement.
- **`services/multicomptes.ts`** — les requêtes, le cliché en mémoire, les
  verdicts. Les liaisons sont des empreintes opaques (`courriel:<md5>`), le
  condensat étant calculé par Postgres : aucune adresse ne transite par le bot.
- **`commands/administration/multicomptes.ts`** — les quatre sous-commandes.

Le balayage ne compare pas tout avec tout : 2 098 membres feraient 2,2 millions
de paires. Les candidats sont fabriqués par regroupement (même avatar, même
racine, même préfixe, même jour de création ou d'arrivée, même liaison), et une
grappe trop large est ignorée — un préfixe de quatre lettres partagé par treize
comptes ne dit rien.

**Mesuré sur la production du 30/8/2026 :** 2 079 comptes, 4 824 paires
examinées, 469 ms à froid et 207 ms sur le cliché. 1 048 rapprochements —
1 rattachement établi, 2 faisceaux, 66 à examiner, le reste en coïncidences.
Déclenchements par indice : `creation` 781, `arrivee` 290, `pseudo` 59,
`avatar` 36, `jeune` 35, `racine` 23, `releve` 4.

⚠ **Un piège qui coûte cher, et qui ne se voit pas.** La normalisation plie les
chiffres en lettres (`m4rk` → `mark`). Retirer les chiffres de queue APRÈS ce
pliage ne retire rien : `christo931` vaut déjà `christo9ei`, qui ne finit plus
par un chiffre. C'était le cas de 94 % des pseudos à suffixe numérique, et
l'indice `racine` ne se déclenchait que 4 fois au lieu de 23. Le retrait de
queue se fait donc sur la chaîne NON pliée. Le test qui aurait dû l'attraper ne
le voyait pas : son seul cas était `MarkEvans_alt2`, et `2` est l'unique chiffre
absent de la table de pliage.

## Limites connues

- **L'indice « activités alternées » ne se déclenche aujourd'hui jamais.** Il
  n'est pas faux, il manque de matière : `discord_messages` ne couvre que les
  salons suivis, 50 auteurs seulement franchissent le minimum de 25 créneaux, et
  sur les 1 048 rapprochements une seule paire a les deux comptes assez actifs —
  sans salon commun. Il se réveillera quand l'archive s'étoffera ; d'ici là, ne
  pas le compter dans la couverture.
- **Le rattachement déclaré est cent fois plus étroit qu'il n'y paraît.** 1 816
  profils portent un `discord_id`, mais la liaison exige aussi un courriel ou un
  `patreon_id`, et `profiles.email` est presque toujours NULL : **16 membres sur
  2 079** portent une liaison, et aucune paire du balayage n'en porte
  aujourd'hui. C'est l'indice le plus lourd du module et le plus rare — ne pas
  le lire comme une couverture large.
- `discord_members` est alimentée par `rg-cron` : un membre arrivé dans la
  demi-heure peut ne pas encore y figurer.
- Il n'existe **pas** d'alerte à l'arrivée. Elle demanderait un salon de veille
  dans les réglages de communauté, et la règle du dépôt veut qu'aucun service ne
  publie sans activation explicite. `balayage jours:7` couvre le même besoin en
  mode consultation.
