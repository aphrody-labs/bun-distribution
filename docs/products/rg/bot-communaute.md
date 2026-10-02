# Vie de communauté des bots Discord

Niveaux, jetons Kizuna, collection de joueurs, tickets. Tout vit dans
`apps/bot`, sous le profil **`rg`** (le bot Rose Griffon) ; le profil `azalee`
ne charge aucun de ces modules.

> **Trois principes gouvernent tout ce document.**
> 1. **Discrétion.** Le bot ne publie rien de lui-même tant que le staff ne l'a
>    pas demandé, et les commandes répondent en privé par défaut.
> 2. **Hiérarchie stricte.** Aucun rôle à permission sensible ne peut être
>    attribué automatiquement, jamais, quelle que soit la configuration.
> 3. **Activation manuelle.** Tout cron, tâche ou service qui publie dans un
>    salon public doit être **activé, validé et configuré à la main** par un
>    administrateur ou un modérateur. Une migration ne l'allume pas, un défaut
>    de code ne l'allume pas, et un salon ne se devine jamais par son nom.

## Ce qui est déjà validé, et ne doit pas être coupé

| Publication automatique | Décidé le | Garde en place |
| --- | --- | --- |
| **Posts X du bot Azalée** (`🌸〡𝓐𝔃𝓪𝓵𝓮́𝓮`) | validé | carte de validation humaine dans `🌿📰〡général-azalée` — rien ne part sans un clic |
| **Relais des créations iergday** (`⚙🍰〡iergday-staff`) | validé | salon de STAFF, pas public ; `relais_depuis` borne le déluge |

Tout le reste (annonces de niveau, accueil, recrutements remarquables, annonces
d'articles) est **éteint** tant qu'un humain ne l'a pas allumé.

## Le défaut que cette règle a fait trouver

`packages/cron/src/index.ts` exposait un service HTTP d'annonces (port 3006)
avec trois problèmes, corrigés le 14/8/2026 :

- le secret valait `default-secret-key-12345` **des deux côtés** quand
  `DISCORD_ANNOUNCE_SECRET` n'était pas posé — et il ne l'était pas ;
- il écoutait sur `*` au lieu de la boucle locale ;
- sans salon configuré, il en **cherchait un par nom** (`annonces`, `news`,
  `general`) et publiait dedans.

Le service refuse désormais tout sans secret (503), n'écoute que `127.0.0.1`,
et exige un salon **désigné**.

Le secret n'était pas seulement absent : `packages/cron/.env` le fixait
**explicitement à la valeur publique** `default-secret-key-12345`, des deux
côtés du fil (site et cron). Il a été remplacé par 32 octets aléatoires dans
les trois fichiers concernés, et `packages/cron/.env.example` ne livre plus de
valeur utilisable.

⚠ **À arbitrer par le staff** : `DISCORD_NEWS_CHANNEL_ID` vaut
`1441915377754964061`, c'est-à-dire **`🚨〡live`**. Les annonces d'articles
partent donc dans le salon des directs, faute de
`DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID` et
`DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID`. Ces deux variables existent
précisément pour séparer les trois flux ; tant qu'elles sont vides, tout tombe
au même endroit.

**Salon de test** : `1086617065818947624`. Toute vérification qui publie
réellement passe par lui — jamais par un salon vu par les membres.

---

## 1. Ce qui a été repris de l'existant

| Service en place | Ce qu'on en garde | Ce qu'on corrige |
| --- | --- | --- |
| **Noctaly** (niveaux, app `875811233616519219`) | la courbe d'activité, les paliers de rôle, l'XP des membres retrouvée | la courbe devient celle **du jeu** (`inagle_exp_table`) ; l'annonce ne part plus dans le salon du message |
| **ticketsbot.net** (tickets, depuis le 16/4/2023) | les fils privés, le salon d'historique, la numérotation (reprise à **86**) | plus aucune transcription chez un tiers ; le motif de fermeture devient **obligatoire** |

### Import de l'XP — état réel

> **Fait le 14/8/2026 : 283 profils en base.** La clé API a été créée sur le
> tableau de bord Noctaly, et l'import complet a tourné : **1 834 membres
> interrogés, 271 profils importés**, 51 sans XP, 1 512 inconnus de Noctaly,
> 322 archives brutes. `bot_profils` porte désormais **283 lignes toutes
> porteuses d'XP**, XP maximale 44 480, niveau 32.
>
> Le reste de cette section décrit ce qui a été fait AVANT la clé, et pourquoi
> une partie des XP reste un minorant : c'est ce que la colonne « source » du
> classement (`/admin/bot/membres`) rend visible.

#### Avant la clé — le dépouillement de l'historique

`apps/bot/src/scripts/import-xp-tiers.ts` avait récupéré **65 membres sur
~1 902** (3,4 %). Deux modes : le premier (top 10, image `/leaderboard` du
9/8/2026, XP arrondie à la centaine) puis `--source=historique`, qui a dépouillé
l'historique COMPLET de six salons plutôt qu'un seul instantané — fusion
`GREATEST(xp, ...)` en base, une mesure ancienne ne rétrograde jamais une
valeur plus fraîche déjà écrite.

| Salon | Couverture | Trouvé |
| --- | --- | ---: |
| `#🤖〡bots` | intégrale, 2023→2026 | 19 (`/rank` + `/leaderboard`) |
| `#🤪〡memes-inazuma` | intégrale, 2023→2026 | 3 |
| `#🎈〡questions` | intégrale, 2023→2026 | 1 |
| `#💬〡général` | arrêtée au 11/3/2026 | 207 |
| `#📷〡médias` | arrêtée au 11/3/2026 | 45 |
| `#🎨〡vos-fanarts` | arrêtée au 17/3/2026 | 7 |

L'essentiel du volume (54 des 65 membres) ne vient PAS d'une carte `/rank` ou
`/leaderboard`, mais des embeds automatiques **« 🎉 Niveau supérieur ! »**
postés dans les salons de discussion générale — ils mentionnent l'ID Discord
en clair, donc aucune résolution par pseudo. Leur XP est le seuil OFFICIEL du
palier annoncé (table `noctaly.com/table`), un minorant réel et non la valeur
exacte de l'instant.

C'était tout ce qui était atteignable **sans clé et sans session** :

- l'API de Noctaly (`GET /api/v1/guilds/{id}/users/{id}/level-profile`) répond
  **401** sans clé (testé en direct), et la clé s'obtient par une connexion
  humaine sur leur tableau de bord ;
- Noctaly n'a été activé sur le serveur que le **11/3/2026** : les 3 salons
  paginés en entier jusqu'à 2023 n'ont RIEN trouvé avant cette date, ce qui a
  justifié d'arrêter les 3 autres dès qu'ils y remontaient sans rien trouver
  de plus.

> ⚠ **Une affirmation de cette page était fausse** et a coûté du temps : « la
> page publique du classement charge ses données côté client (rien dans le HTML
> brut) ». Vérifié le 14/8/2026 : les profils sont **dans le rendu serveur**,
> sous la propriété `initProfiles` de la charge React. Ils n'apparaissent pas
> dans une lecture naïve du HTML parce que Next dépose sa charge en fragments
> échappés (`self.__next_f.push([1,"…"])`) qu'il faut recoller avant de
> chercher. Voir la section suivante.

**Piège trouvé et évité** : deux comptes différents partagent un pseudo
quasi identique, « IceCream » (toujours sur le serveur) et « Icecream »
(parti — `404 Unknown Member` à l'API, ce qui explique pourquoi la recherche
par pseudo ne le trouvait pas). Vérifié avant écriture pour ne pas fusionner
leurs deux XP sur un seul profil.

### L'import complet par l'API — `import-noctaly.ts`

`apps/bot/src/scripts/import-noctaly.ts` reprend **tout** ce que l'API Noctaly
expose en lecture, une fois la clé posée dans `apps/bot/.env`
(`NOCTALY_API_KEY`, générée sur `noctaly.com/dashboard` par un compte ayant
« Gérer le serveur » — une clé par serveur, connexion humaine obligatoire) :

| Route | Portée | Ce qu'on en fait |
| --- | --- | --- |
| `GET …/users/{id}/level-profile` | 1 requête / membre | `xp`, `niveau`, `messages_comptes` |
| `GET …/users/{id}/eco-profile?items&chests&dailyStreak` | 1 requête / membre | `serie_quotidienne`, monnaie → jetons (taux explicite) |
| `GET …/items` et `GET …/chests` | 2 requêtes en tout | catalogue archivé tel quel |

**Il n'existe aucune route de liste dans l'API** : ni classement, ni export, ni
pagination. L'import est donc une boucle d'une à deux requêtes par membre sur
les 1 834 humains présents de `discord_members`.

**Le 429 coûte une heure, pas une seconde.** La documentation annonce 50 req/s
mais aussi un `retryAfter` de 3600 et une mise en liste noire pour les
applications qui insistent. D'où trois choix : cadence alignée sur le quota
**mesuré**, arrêt à `MARGE_QUOTA` requêtes de la limite avec attente du
`X-RateLimit-Reset-After`, et **interruption pure et simple** sur un 429 plutôt
qu'un réessai. L'import étant idempotent, reprendre plus tard ne coûte rien.

> ⚠ **La documentation se trompe d'un facteur vingt-cinq.** Mesuré le 14/8/2026
> avec une vraie clé : les en-têtes annoncent `X-RateLimit-Limit: 120` et
> `X-RateLimit-Reset-After: 60`, et `Remaining` décroît d'une unité par requête.
> Le plafond réel est de **120 requêtes par fenêtre de 60 secondes**, soit
> **2 par seconde**, pas 50. La cadence par défaut (`CADENCE_DEFAUT`) vaut donc
> 2 : réglée sur la documentation, elle vidait le quota en douze secondes puis
> passait le reste de l'import à attendre, en frôlant le 429 à chaque
> redémarrage de fenêtre. Un import complet dure ~15 minutes, pas 3.

### La seconde source : le classement public

La page `noctaly.com/fr/leaderboard/{guildID}` publie **cent profils complets**
dans son rendu serveur, avec exactement les champs de `level-profile` :

```json
{"userID":"…","username":"…","avatarID":"…",
 "level":26,"xp":44480,"messages":4977,"reactions":231,"voiceMinutes":298}
```

Le `xp` de cette source est bien l'XP **totale** — croisé avec l'API sur le même
membre : le classement dit `xp: 44480`, l'API répond `totalXp: 44480` (et
`xp: 3855` pour l'intra-niveau, que le classement ne publie pas et dont l'import
ne se sert pas).

Trois propriétés en font une source utile et non un pis-aller :

1. **Cent profils suffisent.** Sur la guilde Rose Griffon, le 1ᵉʳ a 44 480 XP et
   le **100ᵉ en a 120**, soit le niveau 0. Au-delà, il n'y a rien de
   significatif à importer.
2. **Les quatre tris élargissent la couverture.** `?sort=level|messages|voice|reactions`
   rendent quatre top-100 différents : leur union donne **163 membres
   distincts** au lieu de 100. La fusion garde le maximum de chaque compteur.
3. **Elle amorce l'import par API.** L'ordre du classement devient l'ordre
   d'interrogation : si le quota interrompt l'import, ce qui est fait est ce qui
   comptait.

Deux contraintes à connaître :

- **Cloudflare juge sur l'empreinte TLS.** Le `fetch` de Bun reçoit `403` avec
  `cf-mitigated: challenge` sur toutes les pages HTML de noctaly.com, là où
  `curl` passe en 200. Aucun en-tête n'y change rien. L'import passe donc par un
  sous-processus `curl` pour cette source — et par `fetch` pour l'API, qui n'est
  PAS derrière ce défi.
- **La page exige une session.** En anonyme elle répond 200 mais sans profils
  (0 au lieu de 100). Les cookies vivent dans `.secrets/noctaly-cookies.json`
  (jamais versionné) et **expirent** : sans eux, cette source rend simplement
  zéro profil, ce qui n'est pas une panne.

Sans clé API, l'import ne s'arrête plus : il tourne en **mode dégradé** sur
cette seule source au lieu de sortir en erreur.

**Ce que le classement ne remplace pas.** Mesuré sur l'import complet : le
classement connaissait 163 membres, l'API en a trouvé **271** avec de l'XP. Les
108 de différence sont des membres sortis des quatre top-100 — chacun sous les
120 XP du centième, mais bien réels. Le classement est donc une **amorce
excellente et une source de secours honnête**, pas un substitut à la boucle
complète : il couvre 60 % des profils pour 4 requêtes au lieu de 1 834.

### Le module d'économie est éteint — et le savoir divise l'import par deux

`GET /guilds/{id}/items` répond `400 {"code":"module_disabled"}` sur ce serveur,
et `eco-profile` répond `404` pour chaque membre. L'import sonde donc **une
fois** ce catalogue : si le module est éteint, la passe d'économie entière est
abandonnée.

Sans cette sonde, l'import posait une seconde question par membre — mille huit
cents requêtes — dont la réponse était connue d'avance. À 120 requêtes par
minute, ce n'était pas « un peu de réseau » : c'était le double de la durée et
le double des occasions de déclencher un 429.

Le statut HTTP seul ne suffit pas à trancher (400 ne distingue pas un module
éteint d'une requête malformée) : c'est le champ `code` du corps qui porte
l'information, d'où le second paramètre de `classerReponse`.

Gain mesuré sur l'import complet du 14/8/2026 : **1 834 requêtes évitées**, la
moitié du total. L'import est passé de ~30 minutes annoncées à 15.

### Où ça se regarde — `/admin/bot/membres`

Le classement importé n'était visible que depuis Discord, dix lignes à la fois.
La page `/admin/bot/membres` l'expose en entier : pagination, quatre tris (XP,
jetons gagnés, messages, activité récente), et surtout une colonne **source**.

Cette colonne n'est pas décorative. Elle se déduit de l'archive, qui est
auto-descriptive — la réponse d'API porte `totalXp`, l'entrée de classement
porte `userID`, et l'absence d'archive signale le dépouillement d'historique :

| Source | Nature de l'XP | Compte au 14/8/2026 |
| --- | --- | ---: |
| API Noctaly | valeur exacte | 160 |
| Classement public | exacte, datée du dernier rendu | 0 |
| Historique des salons | **minorant** (seuil du palier annoncé) | 12 |

Afficher un classement sans dire d'où vient chaque ligne inviterait à comparer
des valeurs qui ne sont pas de même nature. L'en-tête de la page donne aussi la
couverture réelle (profils avec XP / humains présents) — la seule façon de
répondre à « est-ce que l'import est fini ? ».

**Tout est archivé brut avant d'être interprété.** `bot_import_noctaly` garde
les deux réponses JSON verbatim, `bot_import_noctaly_catalogue` les deux
catalogues (migration `20260814_bot_import_noctaly.sql`, RLS sans policy). La
raison est simple : le jour où Noctaly quitte le serveur, l'API cesse de
répondre et l'import ne se rejoue pas. Ce qu'on n'a pas mappé aujourd'hui —
l'inventaire d'objets, les coffres, la durabilité — n'a aucun équivalent chez
nous (notre collection, ce sont les 6 090 joueurs du jeu, pas des épées), mais
le jeter aurait été irréversible.

**La monnaie ne s'importe pas sans avoir regardé.** Un jeton Kizuna se gagne à
25/jour et un recrutement en coûte 150 ; la monnaie Noctaly suit une
configuration de serveur inconnue avant lecture. Le taux est donc explicite et
vaut **0 par défaut** — aucune monnaie importée — et `--essai` affiche la
distribution réelle (médiane, maximum, total) pour choisir ensuite avec
`--taux=`. Les jetons s'additionnent une seule fois, gardés par
`bot_import_noctaly.importe_le` : un crédit est un mouvement, pas un état, et
relancer l'import ne recrédite personne.

**Aucune valeur n'est jamais rétrogradée** : `GREATEST` sur `xp`, `niveau`,
`messages_comptes` et `serie_quotidienne`. Le bot crédite déjà de l'XP depuis
le 14/8/2026 — un import lancé après coup ne doit pas ramener un membre actif à
sa valeur Noctaly, plus ancienne.

**Les membres sans rien ne créent pas de ligne** : un 404 ou un profil à zéro
n'écrit pas. La ligne se créera d'elle-même au premier message.

```bash
bun apps/bot/src/scripts/import-noctaly.ts --essai      # rien n'est écrit
bun apps/bot/src/scripts/import-noctaly.ts              # XP + archive
bun apps/bot/src/scripts/import-noctaly.ts --taux=0.1   # + monnaie ÷10
bun apps/bot/src/scripts/import-noctaly.ts --cadence=5  # plus prudent
bun apps/bot/src/scripts/import-noctaly.ts --tous       # + membres partis
```

Les 4 paliers de rôles ont été **confirmés sur le tableau de bord Noctaly le
14/8/2026** — 10 → Joueur Intermédiaire, 25 → Joueur FF, 40 → Joueur FFI,
60 → Joueur Route Victoire — identiques à ce que `import-xp-tiers.ts` avait
déduit du salon `#🎀〡rôles`, donc rien à corriger en base.

---

## 2. Niveaux — la courbe du jeu

`apps/bot/src/lib/experience.ts` recopie les **100 paliers de
`inagle_exp_table`**, la table d'expérience d'Inazuma Eleven Victory Road. Ce
n'est pas décoratif : monter de niveau sur le Discord coûte exactement ce que ça
coûte en jeu.

| Niveau | XP cumulée | ≈ messages (20 XP / min) |
| ---: | ---: | ---: |
| 10 | 2 422 | 121 |
| 20 | 12 291 | 615 |
| 30 | 38 310 | 1 916 |
| 50 | 195 502 | 9 776 |
| 99 | 2 878 742 | 143 938 |

Les **rangs** reprennent l'échelle de rareté du jeu, avec ses libellés français
exacts (`inagle_characters.rarity_label`) : **Normal** (1‑19), **Expérimenté**
(20‑49), **Héros** (50‑79), **BASARA** (80‑100).

### Gain

- 15 à 25 XP par message, **une fois par minute** au maximum.
- Le délai est tenu par Redis, pas par une lecture Postgres : sur un serveur
  actif, la lecture coûterait plus cher que l'écriture qu'elle évite.
- **Le contenu des messages n'est jamais lu.** L'intent `MessageContent` est
  privilégié et n'est pas demandé ; Discord livre `messageCreate` avec un
  contenu vide. On compte des messages, on ne les lit pas — et ce n'est pas une
  promesse, c'est ce que l'API nous envoie.

### Annonces — silencieuses par défaut

`niveaux.annonce` vaut **`aucune`** sur une guilde vierge. Là où elle est posée :

- `palierAnnonce` (défaut **5**) ne laisse passer que les niveaux ronds ;
- `annoncerRang` laisse passer les trois changements de rang d'une vie de membre.

Le mode `place` (annoncer dans le salon du message) existe, c'est le défaut des
bots du marché, et c'est celui qui fait couper les bots de niveaux au bout d'une
semaine sur un serveur de deux mille membres.

---

## 3. Récompenses de rôle — la surface la plus dangereuse

`/gestion niveaux recompense` attribue un rôle **tout seul, sans qu'un humain
regarde**. Quatre familles de rôles sont donc **refusées**
(`apps/bot/src/lib/hierarchie.ts`) :

1. `@everyone` ;
2. les rôles **gérés par une intégration** (bot, Patreon, boost Nitro) — Discord
   refuse de les attribuer, et l'erreur n'arrive qu'au premier membre concerné ;
3. les rôles **au niveau ou au-dessus du bot** — la hiérarchie l'interdit, et
   sans ce refus le réglage est accepté puis ne fait jamais rien ;
4. les rôles portant **une permission sensible** — `Administrator`,
   `ManageGuild`, `ManageRoles`, `ManageChannels`, `BanMembers`, `KickMembers`,
   `ManageWebhooks`, `MentionEveryone`.

Sur ce serveur, **29 rôles sur 94** tombent dans la quatrième catégorie (relevé
du 14/8/2026) : sans ce garde-fou, « niveau 30 → Modérateurs » est à un clic.

Le contrôle est fait **deux fois** : au réglage, et de nouveau à chaque
attribution (`events/experience.ts`). La seconde passe couvre les lignes
importées d'un autre bot, celles écrites en SQL, et surtout les rôles qui
gagnent des permissions **après** leur enregistrement — le cas le plus vicieux,
parce qu'il ne déclenche aucune alerte.

---

## 4. Jetons Kizuna — la monnaie du jeu

Ce n'est pas une invention : le **Jeton Kizuna** est la monnaie de la Boutique
Kizuna d'Inazuma Eleven Victory Road, texte `0xD63615BE` —
fr « Jeton Kizuna », en « Bond Token », ja « キズナトークン ».

**Trois sources, et l'absence délibérée d'une quatrième :**

| Source | Détail |
| --- | --- |
| `quotidien` | 25 jetons, +5 par jour consécutif, prime plafonnée à +50 au 11ᵉ jour |
| `montee-niveau` | 10 × le niveau atteint |
| `don` | de 1 à 5 000 par don, 10 000 par jour et par membre |

**Aucun gain par message.** C'était le choix évident, et c'est celui qui
transforme un salon en concours de messages d'un mot.

Chaque mouvement écrit **deux lignes dans la même transaction** : le solde et sa
ligne de journal signée. L'invariant se vérifie en une requête :

```sql
select p.discord_id, p.jetons, coalesce(sum(j.delta), 0)
  from bot_profils p
  left join bot_journal_kizuna j using (guild_id, discord_id)
 group by p.discord_id, p.jetons
having p.jetons <> coalesce(sum(j.delta), 0);
```

Zéro ligne = tout va bien.

---

## 5. Collection — recruter les joueurs du jeu

`/collection recruter` tire **un joueur au sort parmi les 6 090 nommés** des
données du jeu, à égalité de chances. Il n'y a donc aucun taux à annoncer : la
rareté observée est celle du jeu, et elle est vérifiable sur le wiki.

| Rareté | Effectif | Part | Remboursement d'un doublon |
| --- | ---: | ---: | ---: |
| Normal | 5 747 | 94,4 % | 30 |
| Expérimenté | 150 | 2,5 % | 100 |
| Héros | 122 | 2,0 % | 250 |
| BASARA | 71 | 1,2 % | 600 |

Une seule entorse : **un tirage sur dix ne peut pas rendre un joueur Normal**.
Sans elle, 56 % des membres n'auraient rien vu d'autre au bout de dix tirages.

Les **plaques de nom** (54, `inagle_nameplates`) s'achètent et servent de fond à
la carte de profil. Prix par palier de déblocage : 300 / 900 / 2 000 / 4 500.

La collection **ne donne aucun avantage** : ni XP, ni rôle, ni place au
classement. C'est la condition pour qu'une économie interne ne devienne pas une
taxe sur ceux qui n'y jouent pas.

---

## 6. Tickets — fils privés, rien chez un tiers

- Un ticket est un **fil privé** dans `📩〡demandes-tickets`, nommé
  `ticket-0086` — **le numéro, jamais le pseudo** : le nom d'un fil apparaît
  dans la liste du salon et dans le journal d'audit du serveur.
- Cinq catégories. **Signalement** est *sensible* : il ne va **qu'à la
  direction**, parce qu'un signalement peut viser un modérateur.
- **Un seul ticket ouvert par membre.** Le second renvoie vers le premier au
  lieu de refuser.
- Fermeture : **motif obligatoire**, fil **archivé et verrouillé** (jamais
  supprimé), carte de fermeture dans `📦〡ticket-history` avec les mêmes champs
  que les 84 cartes précédentes.

### Le piège qui rend un système de tickets inutile

Un fil privé n'est visible **que de ses invités et des porteurs de « Gérer les
fils »**. Mentionner un *rôle* dans un fil ne l'y fait pas entrer. Un panneau
publié sans cette permission crée des tickets que **personne au staff ne voit**,
et la panne est silencieuse.

`/gestion ticket diagnostic` le vérifie rôle par rôle, et
`/gestion ticket panneau` **refuse de publier** tant qu'un blocage subsiste.

---

## 7. Commandes

### Membres — privées par défaut, `partager: true` pour publier

| Commande | Effet |
| --- | --- |
| `/profil [membre] [partager]` | carte de progression (plaque du jeu en fond, joueur fétiche, rang) |
| `/classement [critere] [page] [partager]` | niveaux ou jetons Kizuna |
| `/kizuna solde\|quotidien\|donner\|journal` | solde, passage du jour, don, historique |
| `/collection voir\|recruter\|plaques\|acheter` | collection et boutique |
| `/personnaliser favori\|plaque` | ce que la carte affiche |
| `/ticket ouvrir\|fermer\|prendre\|rendre\|info\|liste` | tickets |

`/kizuna quotidien`, `/kizuna donner` et `/kizuna journal` sont **toujours**
privés. Le destinataire d'un don est prévenu **en message direct** : les deux
personnes concernées sont au courant, et personne d'autre.

### Staff — sous `/gestion`, doublement gardées

`defaultMemberPermissions = ManageGuild` retire la commande de la liste des
membres ordinaires (confort d'interface) ; `exigerDroits` lit le rôle réel dans
`profiles` (la vraie garde).

| Commande | Effet |
| --- | --- |
| `/gestion niveaux reglages\|recompense\|retirer\|annonce\|salon` | progression et récompenses |
| `/gestion ticket reglages\|poser\|role\|diagnostic\|panneau\|encours` | tickets |
| `/gestion sondage creer\|cloturer` | sondages natifs Discord |

---

## 8. Base de données

`apps/website/sql/migrations/20260814_bot_communaute.sql` (+ `_reglages`, `_kizuna`).

| Table | Contenu | Lisible publiquement ? |
| --- | --- | --- |
| `bot_profils` | XP, niveau, jetons, cosmétiques équipés | **oui**, colonnes de classement seulement |
| `bot_journal_kizuna` | mouvements signés | **non** — c'est un graphe social |
| `bot_inventaire` | joueurs et plaques possédés | **non** |
| `bot_tickets` | métadonnées, **aucun message** | **non** |
| `bot_reglages_guilde` | réglages jsonb validés par zod | **non** |
| `bot_recompenses_niveau` | palier → rôle | **non** |

`dernier_gain_le` est explicitement **exclu** de la lecture publique : c'est un
horodatage de présence, donc une donnée de comportement, sans rapport avec un
classement.

> ⚠ Toute table créée en `postgres` doit finir par `alter table … owner to rg;`.
> Le bot se connecte sous le rôle `rg` : sans ça, il lève « permission denied »
> à la première écriture, longtemps après la migration et loin d'elle.

---

## 9. Menus de rôles en libre-service

`/gestion roles creer` pose un panneau dans un salon ; les membres y prennent et
y rendent leurs rôles eux-mêmes, en **menu déroulant** (25 rôles) ou en
**boutons** (5). C'est ce qui remplace les « rôles à réaction » d'un bot tiers :
une réaction ne dit pas ce qu'elle donne, se retire par mégarde, et ne sait pas
répondre.

**C'est la surface la plus exposée du bot** — n'importe qui clique, sans qu'un
humain intervienne, pendant des mois. Les rôles proposables passent donc par la
**même garde stricte** que les récompenses de niveau (§3), et ils y passent
**deux fois** : à l'ajout au menu, et à chaque clic (un rôle peut gagner des
permissions après avoir été mis au menu — ce jour-là, rien n'alerte personne).

Trois détails qui ne se devinent pas :

- un menu déroulant Discord rend la **sélection complète**, pas le changement :
  le calcul se fait par différence, sinon un rôle décoché n'est jamais retiré ;
- `minValues: 0` est ce qui rend le menu **réversible** — sans lui, Discord
  exige au moins une option et personne ne peut tout retirer ;
- le menu ne touche **que ses propres rôles** : un rôle obtenu ailleurs
  (récompense de niveau, rôle de staff) n'est jamais retiré parce qu'il n'était
  pas coché ici.

Retirer un rôle d'un menu, ou supprimer le menu, **ne dépouille personne** : les
membres qui l'avaient pris le gardent.

`bot_menus_roles` ne contient **aucune trace de qui a pris quel rôle** — Discord
tient déjà cette information, et la dupliquer chez nous en ferait un historique
de préférences (pronoms, centres d'intérêt, âge) consultable des années plus
tard.

## 10. Accueil des nouveaux membres

`/gestion accueil` règle le message de bienvenue (salon, message privé, ou
rien), son texte, la carte image, et le rôle posé à l'arrivée.

- **`aucune` par défaut**, comme les annonces de niveau. Un serveur qui reçoit
  vingt arrivées par jour n'a peut-être aucune envie de vingt messages.
- **Le rôle d'arrivée est la surface la plus large du bot** — posé à *chaque*
  arrivée, sans clic, sans niveau à atteindre. Il passe donc par la garde
  stricte du §3, et il est revérifié à chaque arrivée.
- **Aucune mention de masse possible.** Le texte est réglable par le staff ;
  `allowedMentions: { users: [membre.id] }` borne l'envoi, pour qu'un
  `@everyone` glissé dedans ne devienne pas un ping de deux mille personnes.
- **Pas de message de départ.** Il annoncerait publiquement chaque départ, y
  compris ceux qui suivent un conflit ou une sanction — le journal d'audit
  Discord porte déjà cette information, et elle appartient au staff.

`/gestion accueil apercu` montre exactement ce que verra le prochain arrivant,
sans rien publier, et signale les configurations muettes (lieu « salon » sans
salon posé).

Le texte accepte trois jetons et **rien d'autre** : `{membre}`, `{serveur}`,
`{compte}`. Un moteur de gabarit dans un champ réglable serait une surface
d'injection pour rien.

## 11. Modération — sanctions, dossier, auto-modération

Les sanctions existaient déjà (`bannir`, `debannir`, `expulser`, `exclure`,
`lever-exclusion`, `avertir`), toutes consignées dans `admin_audit_log`. Trois
ajouts closent le dispositif.

### `/moderation historique` — la boucle qui n'était pas fermée

Le code de `avertir` dit lui-même pourquoi il consigne : « une récidive se juge
sur l'historique ». Sauf qu'**aucune commande ne lisait cet historique** : pour
savoir si un membre en était à son premier ou à son cinquième avertissement, il
fallait ouvrir Postgres — donc jamais, et la gradation se faisait de mémoire.

Le dossier distingue **le total** (ce qui s'est passé depuis toujours) et **les
90 derniers jours** (ce qui pèse aujourd'hui) : quatre avertissements dont trois
datent de deux ans, ce n'est pas trois avertissements ce mois-ci. Une **levée**
(exclusion levée, débannissement) figure dans l'historique mais ne compte pas
dans la gravité — on ne punit pas d'avoir été gracié.

La commande ne **recommande aucune sanction**. « Trois avertissements ⇒
exclusion » est une règle de communauté, pas de code : l'écrire ici la rendrait
invisible à ceux qui l'appliquent.

### `/administration journal salon` — la sanction, là où le staff la lit

`admin_audit_log` est la source : elle se requête, elle survit à la purge d'un
salon, le site la lit. Elle ne se lit pas depuis Discord — donc le reste du
staff apprenait un avertissement par la personne avertie, deux modérateurs
pouvaient traiter le même incident sans le savoir, et l'historique ne servait
qu'à celui qui pensait à l'ouvrir.

Chaque action de `/moderation moderation` (avertissement, exclusion, levée,
expulsion, bannissement, débannissement) paraît désormais dans le salon réglé
par `/administration journal salon` — sur le serveur Rose Griffon, `#💬📖〡logs`
(`1073752409387573339`), branché le 31/8/2026. La carte porte la mention **et**
le nom **et** l'identifiant du membre visé (un pseudo change, une mention ne se
résout plus quand le compte est parti), le motif, l'auteur de la sanction, et
les précisions propres à l'action — durée, messages effacés, remise du message
privé. Les levées sont **vertes** : le journal se parcourt à la couleur avant de
se lire.

Rien n'est publié tant qu'un salon n'a pas été posé : c'est la règle
d'activation manuelle du §3, et le réglage vit en base (`moderation.salonJournal`)
— éditable aussi depuis `/admin/bot/reglages`. Si la publication échoue (salon
supprimé, droits retirés), l'accusé de réception de la sanction le dit en clair
à celui qui vient de sanctionner : une action déjà appliquée ne se rejoue pas,
la seule chose utile est de savoir ce qui n'a PAS été écrit.

⚠ Le salon nomme des membres et leurs motifs : il se réserve au staff. Sur le
serveur Rose Griffon, `@everyone` n'y voit rien, seuls les Modérateurs y ont
accès.

### `/moderation automod` — celle de Discord, pas la nôtre

Un filtre maison exigerait de lire le contenu des messages, donc l'intent
privilégié `MessageContent` — et de renoncer à la garantie du §2. L'AutoMod de
Discord fait mieux et ailleurs : il s'exécute **avant publication** (un message
bloqué n'a jamais existé, là où un filtre maison le supprime après que tout le
monde l'a vu), ne consomme aucun intent, et ses jeux de mots-clés sont maintenus
par Discord dans toutes les langues.

Ce bot ne filtre donc rien : il **configure** les règles de Discord et les rend
visibles depuis Discord. Discord n'autorise qu'**une** règle par type
(anti-spam, mots-clés prédéfinis, anti-mentions) : on lit l'existant et on met à
jour plutôt que de créer — une seconde création échoue avec une erreur illisible.

État du serveur au 14/8/2026 : 3 règles déjà en place (mots dans les pseudos,
anti-mentions, un filtre de mots-clés). Manquent l'**anti-spam** et les **jeux
de mots-clés de Discord** — à activer par un admin, conformément au principe 3.

⚠ Les rôles à permission « Gérer le serveur » échappent nativement à l'AutoMod :
Discord ne les filtre pas, quelle que soit la règle.

## 12. Suggestions — le vote reste chez Discord

`/suggestion proposer` publie dans le salon configuré (fermé par défaut) ; le
bot pose 👍 et 👎, et **c'est tout**. Le registre de qui a voté quoi reste chez
Discord ; nous n'en lisons que les compteurs, au moment où le staff tranche.

C'est la même ligne rouge que les sondages : le réflexe serait une table
`(suggestion, membre, valeur)` — une table nominative de votes, chez nous, pour
toujours, sur un serveur où tout le monde se connaît.

`/gestion suggestion trancher` **réécrit le message d'origine** au lieu d'en
poster un second : sinon le salon accumule deux messages par suggestion, et
surtout le vote reste attaché au premier — les gens continuent de voter une
suggestion déjà tranchée. Les réactions sont retirées à la décision.

Le **motif est obligatoire**, et l'auteur est prévenu en message privé : une
suggestion écartée sans raison est pire qu'une suggestion ignorée.

Détail qui se voit tout de suite s'il manque : le bot pose lui-même les deux
réactions, donc ses propres clics sont dans les compteurs. `score()` les retire
— sans ça, une suggestion que personne n'a votée s'affiche « 1 pour, 1 contre ».

## 13. Permissions du bot — Administrator, et c'est voulu

Le bot Rose Griffon porte la permission **Administrator** sur le serveur.

C'est une **décision explicite du 14/8/2026**, pas un oubli : le bot doit savoir
faire le plus de choses possible, et il est déjà le seul outil qui écrit dans
`administration`, `gestion` et `moderation` (rôles, salons, bannissements,
exclusions, fils, webhooks). Réduire ses permissions au minimum théorique
casserait des commandes existantes à chaque ajout de fonctionnalité, pour un
gain nul — le vrai verrou d'accès n'est pas Discord, c'est `requireRgAdmin`
(`lib/rbac.ts`), qui lit le rôle réel dans `profiles` et décide seul.

**Ne pas « corriger » ce point.** Ce qui doit rester strict, c'est ce que le bot
attribue AUTOMATIQUEMENT (§3) — pas ce qu'il peut faire quand un administrateur
Rose Griffon le lui demande.

## 14. Exploitation

```bash
# après toute modification de apps/bot
sudo systemctl restart rg-bot.service
journalctl -u rg-bot.service --since "-1 min" | tail -20
```

Le démarrage doit afficher « ✓ Commandes enregistrées » et lister les guildes.
`initApplicationCommands failed` avec `Invalid Form Body` signale un dépassement
du plafond de 8 000 caractères par racine de commande : c'est ce qui a déjà fait
éclater `/administration` en trois racines (`/administration`, `/gestion`,
`/moderation`).
