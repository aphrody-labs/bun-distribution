# Administration web du bot Discord

Le bot Discord n'avait aucune surface web. Ses réglages ne se voyaient que
depuis `/administration réglages`, dans Discord, et son état d'exécution nulle
part. Le tableau de bord interroge désormais l'unique `rg-bot.service`.

Cette page décrit ce qui a été ajouté : un **contrat de types partagé**, un
**serveur d'administration** dans chaque processus de bot, une **API** côté
site, et **quatre pages** sous `/admin`.

---

## Ce que ça remplace

| Avant | Maintenant |
| --- | --- |
| Réglages éditables seulement par slash command | `/admin/bot/reglages` — les six sections, avec des noms de salons au lieu de flocons |
| Aucune vue de l'état du bot | `/admin/bot` — passerelle, latence, serveurs, mémoire, commandes |
| Aucun inventaire des slash commands hors du code | `/admin/bot/commandes` — lu dans les processus, filtrable |
| Classement visible seulement dans Discord, dix lignes à la fois | `/admin/bot/membres` — 283 profils, 4 tris, provenance de chaque XP |
| Tâches cron déclenchables depuis Discord seulement | `/admin/cron` — catalogue, planification, déclenchement |

---

## Le contrat partagé (`@rosegriffon/types`)

Deux modules nouveaux, tous deux **purs** (zod et rien d'autre : aucune E/S,
aucun `discord.js`, aucun `Bun.*`). Ils s'importent donc aussi bien dans un
composant React que dans une commande Discord ou une route Next.

### `@rosegriffon/types/bot`

Porte le **schéma des réglages de communauté** — celui qui valide
`bot_reglages_guilde.valeurs`, une colonne `jsonb` sans schéma côté base.

Il vivait dans `apps/rg/bot/src/lib/reglages-communaute.ts`, et il y était bien
tant que le bot était seul à écrire. À partir du moment où le site édite la même
colonne, deux écrivains la partagent : un schéma recopié aurait garanti qu'un
jour le formulaire enregistre une valeur que le bot refuse de relire — et comme
`lireReglages()` ne lève **jamais**, le bot serait retombé sur ses défauts,
c'est-à-dire aurait **effacé en pratique tous les réglages du serveur** sans le
moindre signal.

`apps/rg/bot/src/lib/reglages-communaute.ts` reste en place comme réexport : une
quarantaine de fichiers l'importent par ce chemin.

Contient aussi `PROFILS_BOT` (les deux identités, leur unité systemd, leur
couleur, leur port d'administration) et les types d'état d'exécution
(`EtatBot`, `CommandeBot`, `GuildeBot`).

#### Le piège de la modification partielle

`SchemaModificationReglages` n'est **pas** `SchemaReglages.partial()`, et la
différence n'est pas cosmétique.

```ts
// Avec .partial() — les défauts sont matérialisés :
SchemaNiveaux.partial().parse({ actif: false })
// → { actif: false, annonce: "aucune", salonAnnonce: null, palierAnnonce: 5, … }
```

Appliqué comme modification partielle, ce document **remet aux défauts tout ce
que le formulaire n'a pas envoyé**. Basculer un interrupteur effacerait le salon
d'annonce configuré six mois plus tôt.

`partielSansDefauts()` déballe donc chaque `ZodDefault` / `ZodPrefault` avant de
rendre le champ facultatif, et **recommence sur les sous-objets** (`niveaux.gain`
est le seul aujourd'hui, mais c'est exactement là que le piège se referme : un
formulaire qui n'expose que le délai anti-spam remettrait la fourchette d'XP à
15–25). Absent veut alors dire absent, et `fusionnerReglages()` garde la valeur
en place. Deux tests de `packages/rg/types/src/bot.test.ts` verrouillent ce
comportement.

### `@rosegriffon/types/cron`

Le catalogue des **22 tâches** de `rg-cron.service` : nom canonique, libellé,
rôle, famille, planification, niveau d'accès, motif d'interdiction, durée
indicative.

Trois surfaces les nommaient, chacune dans son coin, et elles avaient divergé :
le bot connaissait **18** tâches quand le démon en servait **22**. `/cron lancer
noctaly:import` répondait « tâche inconnue » sur une tâche qui marche.
`campagnes:discord`, `campagnes:instagram` et `campagnes:relais` étaient dans le
même cas.

Deux défauts corrigés au passage, tous deux relevés par `catalogue.test.ts` :

- **`stats:achillea` était planifiée mais absente de `runnerMap`.** La tâche
  tournait toutes les 15 minutes et figurait dans `GET /tasks`, mais
  `POST /tasks/stats:achillea/run` répondait 400 « Tâche inconnue ».
- **`GET /tasks` recopiait sa liste à la main.** Elle rend maintenant
  `TACHES_CRON`, `PLANIFICATIONS` et `CATALOGUE_TACHES` tels quels.

`packages/rg/cron/src/catalogue.test.ts` relie le `runnerMap` du démon au catalogue
partagé : ajouter une entrée d'un côté sans la décrire de l'autre fait échouer la
CI, avec le nom manquant dans le message.

---

## Le serveur d'administration du bot

`apps/rg/bot/src/lib/serveur-admin.ts`, démarré après `clientReady`, sur
`127.0.0.1` uniquement.

| Profil | Port | Unité |
| --- | --- | --- |
| `rg` | 3007 | `rg-bot.service` |

Surchargeable par `BOT_ADMIN_PORT` (poste de développement).

### Routes

| Route | Rôle |
| --- | --- |
| `GET /sante` | Sonde ouverte : `{ ok, profil, pret, uptimeSecondes }` |
| `GET /etat` | Passerelle, latence, guildes servies et **absentes**, commandes, mémoire |
| `GET /commandes` | L'arbre `discordx` aplati — chemin, description, options typées |
| `GET /guildes/:id/salons` | Salons textuels, annonces, forums et catégories |
| `GET /guildes/:id/roles` | Rôles hors `@everyone`, du plus haut au plus bas |
| `POST /reglages/:id/invalider` | Vide le cache de réglages (seule route non idempotente) |

### Trois règles, trois raisons

1. **Aucun secret, aucun serveur.** Sans `BOT_ADMIN_TOKEN`, le serveur ne démarre
   pas du tout et le journal le dit. Un jeton par défaut est ce qui avait
   transformé le service d'annonces de `rg-cron` en tribune ouverte.
2. **Boucle locale.** Le seul appelant légitime est le site, sur la même machine.
   L'inventaire des salons et des rôles n'a pas à être exposé au réseau.
3. **Lecture, plus une seule écriture.** Ce serveur n'envoie aucun message, ne
   pose aucun rôle, ne bannit personne. Ces actes passent par les slash commands,
   qui portent leur garde et leur journal d'audit. Un port HTTP en boucle locale
   ne doit jamais être un raccourci vers la modération.

La comparaison du jeton est à **temps constant** : `a === b` sur des chaînes
s'arrête au premier caractère différent, ce qui laisse deviner le préfixe.

### Pourquoi passer par le processus et pas par la base

Tout ce que ce serveur rend n'est écrit **nulle part** : la passerelle est-elle
ouverte, quelles commandes ont réellement été enregistrées, sur quels serveurs,
quels salons existent. C'est l'état d'un processus, pas une donnée. Le lire
ailleurs qu'auprès du processus reviendrait à recopier une liste — et une liste
recopiée diverge.

Les **réglages**, eux, restent lus et écrits directement en Postgres par le
site : ce sont des données, elles ont une table.

---

## L'API du site

Toutes les routes sont gardées par `requireApiAdmin()` (rôle `admin` ou `staff`).

| Route | Méthode | Effet |
| --- | --- | --- |
| `/api/admin/bot/etat` | `GET` | État des deux bots + de l'ordonnanceur |
| `/api/admin/bot/commandes` | `GET` | Catalogue fusionné des deux profils |
| `/api/admin/bot/annuaire?guild=` | `GET` | Salons et rôles, pour peupler les sélecteurs |
| `/api/admin/bot/reglages?guild=` | `GET` | Document courant + manques par section |
| `/api/admin/bot/reglages?guild=` | `PATCH` | Modification **partielle** |
| `/api/admin/bot/reglages?guild=` | `DELETE` | Rétablit les défauts — rôle `admin` **strict** |
| `/api/admin/cron` | `GET` | État du démon, catalogue, télémétrie Discord |
| `/api/admin/cron/lancer` | `POST` | Déclenche une tâche, après vérification du rôle |

### Pourquoi `PATCH` et jamais `PUT`

Un envoi du document entier depuis un formulaire est une course perdue d'avance :
le staff ouvre la page, un administrateur change le salon de tickets depuis
Discord dans la minute, et le formulaire — qui a lu l'ancien document — le
réécrit à l'ancienne valeur en cliquant « enregistrer ».

Un patch ne porte que ce qui a bougé. Le formulaire enregistre d'ailleurs
**section par section**, pour la même raison.

### La politique cron est appliquée deux fois

Le démon a sa propre garde (`CRON_SECRET` ou cookie de session administrateur).
Le site applique **en plus** `peutDeclencher()` avant d'envoyer quoi que ce
soit : un `staff` ne doit pas pouvoir lancer une tâche `admin-strict` en devinant
l'URL, et les quatre tâches interdites (`db`, `crawl`, `github-publish`,
`discord:backfill`) le sont depuis toutes les surfaces.

Le bouton absent d'une carte n'est qu'une politesse — cacher un bouton n'a jamais
empêché personne de poster la requête à la main.

---

## Les pages

| Chemin | Contenu |
| --- | --- |
| `/admin/bot` | Les deux profils (identité, uptime, latence, serveurs, mémoire), les compteurs de communauté, et ce qu'il reste à configurer |
| `/admin/bot/membres` | Classement paginé : 4 tris, rang calculé en SQL, **provenance de chaque XP** |
| `/admin/bot/reglages` | Les six sections, un bouton d’enregistrement chacune |
| `/admin/bot/commandes` | Catalogue filtrable par texte, profil et portée |
| `/admin/cron` | Les 22 tâches par famille, avec leur planification et leur bouton |

### `/admin/bot/membres` — la provenance est une donnée

Trois imports successifs ont alimenté `bot_profils`, et **toutes les XP ne se
valent pas** : celle de l'API Noctaly est exacte, celle reconstituée depuis les
annonces « Niveau supérieur » retrouvées dans les salons est un **minorant** (le
seuil du palier, pas la valeur réelle). Un classement qui mélangerait les deux
sans le dire inviterait à des comparaisons fausses.

La provenance se déduit de l'archive, sans colonne supplémentaire : la réponse
d'API porte `totalXp`, l'entrée de classement porte `userID`, et l'absence
d'archive signale l'historique. Voir `couvertureImport()` et `provenanceDe()`
dans `apps/rg/website/src/lib/bot/membres.ts`.

⚠ **Coupure serveur / client obligatoire.** `lib/bot/membres.ts` porte
`import "server-only"` (il ouvre le pool Postgres) ; le tableau est un îlot
`"use client"` qui a besoin des mêmes libellés et des mêmes types. Ceux-ci
vivent donc dans `lib/bot/membres-shared.ts`, que l'îlot importe DIRECTEMENT.
Passer par le module serveur ferait échouer le build sur un `Can't resolve 'fs'`
très loin de sa cause — c'est le patron déjà retenu pour `lib/wiki/<x>-shared.ts`
et `lib/cpk/`.

Le rang vient d'un `row_number()` calculé sur le même tri que l'affichage : le
déduire de l'index de page donnerait un rang juste par accident, et faux dès
qu'une ligne est filtrée. Les tris sont une correspondance **fermée** vers des
clauses `ORDER BY` — la valeur vient d'un paramètre d'URL, et une colonne
concaténée dans du SQL est une injection qui attend son tour.

Une **guilde configurée mais non rejointe** est signalée en tête de
`/admin/bot` : c'est la panne la plus silencieuse du bot — le service tourne, le
journal est propre, et les commandes n'apparaissent nulle part sur ce serveur.

Le tableau de bord ne tombe jamais en 500 quand un service est arrêté : chaque
sonde rend son erreur plutôt que de la lever. C'est justement le moment où on
consulte la page.

---

## Mise en service

### Variables d'environnement

```bash
# ../rg/.env.local — lu par rg-bot.service
BOT_ADMIN_TOKEN=<64 caractères hexadécimaux>

# ../rg/apps/website/.env — lu par website-web.service
BOT_ADMIN_TOKEN=<la MÊME valeur>
CRON_SECRET=<la même que celle de .env.local>
```

Génération : `openssl rand -hex 32`.

Sans `BOT_ADMIN_TOKEN`, tout continue de fonctionner : les bots démarrent avec un
avertissement dans le journal, et `/admin/bot` affiche « injoignable ». Rien ne
casse — la surface web est simplement muette.

Surcharges facultatives, pour un poste de développement :
`BOT_ADMIN_PORT`, `BOT_ADMIN_URL_RG`, `CRON_API_URL`.

### Après déploiement

```bash
sudo systemctl restart rg-bot.service
sudo systemctl restart rg-cron.service
bun run deploy website
```

Contrôle :

```bash
journalctl -u rg-bot.service --since "-1 min" | grep "Serveur d'administration"
curl -s http://127.0.0.1:3007/sante
```

---

## Voir aussi

- [bot-commandes.md](bot-commandes.md) — catalogue des slash commands et plan de bascule
- [bot-communaute.md](bot-communaute.md) — niveaux, jetons Kizuna, tickets
- [bot-azalee.md](bot-azalee.md) — le second profil et son registre
- [deploy.md](../../operations/rg/deploy.md) — services, procédures, interdits
