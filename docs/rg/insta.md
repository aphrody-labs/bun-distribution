# Instagram — ce qui marche, ce qui ne marche pas, et ce qu'on a bâti

> Toutes les mesures de ce document ont été faites **le 13/8/2026**, en `curl`,
> sans compte connecté, avec un UA Chrome 126. Aucun chiffre n'est repris d'une
> documentation : ce qui n'a pas été observé n'est pas affirmé.

## 1. Le problème

Le règlement d'une campagne Rose Griffon (`#IERGDay`) autorise Instagram. La
page `/iergday` doit donc pouvoir montrer les créations qui y sont publiées.

**Il n'existe aucun moyen automatique de récolter un hashtag Instagram.** Ce
n'est pas un manque d'outillage de notre côté : Instagram a fermé, une par une,
toutes les portes qu'un collecteur pouvait emprunter.

## 2. Ce qui est mort, mesuré

| Requête (sans compte) | Réponse observée |
| --- | --- |
| `GET /explore/tags/nature/?__a=1` | **200**, corps = `for (;;);{"__ar":1,"error":1357055,…}` — enveloppe d'erreur Meta, **zéro donnée** |
| `GET /explore/tags/iergday/?__a=1&__d=dis` | **404**, 20 916 o de « Page Not Found » |
| `GET /explore/tags/nature/` (HTML) | 200, 605 506 o — **0 occurrence de `window._sharedData`**, 38 des 44 `<script src>` sont des `data:` URI |
| `GET /graphql/query/?query_hash=9b498c08…` | **401** `{"require_login":true}` — et c'est le hash qu'`instaloader` 4.15.3 emploie encore |
| `GET /api/v1/tags/web_info/?tag_name=nature` | **302** → `/accounts/login/` |
| `GET i.instagram.com/api/v1/tags/web_info/…` | **302** |
| `GET /explore/tags/nature/embed/` | **404** |

Et sur **le post réel de la campagne**
(`https://www.instagram.com/rose_griffonfr/p/Db_AxXAlywQ/`) :

| Requête | Réponse |
| --- | --- |
| la page du post | **200**, 605 523 o, `<title>Instagram</title>` — **0 `og:image`, 0 `og:description`, 0 JSON-LD, 0 `_sharedData`** |
| `?__a=1&__d=dis` | **500**, corps `Oops, an error occurred.` |
| `/embed/` et `/embed/captioned/` | 200, **la même coquille vide** |
| **`graph.facebook.com/v23.0/instagram_oembed`** | **200 ✅**, sans jeton |

À un client non connecté, Instagram sert désormais **la même coquille SPA de
~605 Ko pour tout** — page de tag, page de post, page d'embed. Le scraping HTML
est mort **par construction**, pas par accident de sélecteur.

### Les deux projets Python évalués

- **`tomkdickinson/Instagram-Search-API-Python`** — dernier commit **30/03/2018**.
  Plante au premier appel : il concatène `instagram.com` + `script['src']`, or
  ces `src` sont maintenant des `data:` URI (`InvalidURL`). Même corrigé,
  `extract_shared_data()` rend `None`. **Mort à deux endroits indépendants.**
- **`simonseo/instagram-hashtag-crawler`** — commit de **février 2026**, mais ce
  n'est que ~250 lignes d'emballage autour d'`instaloader`. Testé sur `#iergday`
  et `#nature` : **403 `login_required`** les deux fois. Son « login-free »
  signifie « sans saisir de mot de passe » — il lit les cookies d'un navigateur,
  donc **il faut un compte connecté**.

### Les bibliothèques maintenues

`instaloader` (4.15.3, 26/07/2026) et `instagrapi` (2.18.14, 12/08/2026) sont
vivantes, mais exigent toutes deux **une session Instagram**. Les employer avec
`@rose_griffonfr` exposerait **le compte de l'association** à un blocage en
pleine campagne. Le README d'`instagrapi` le dit lui-même : *« best suited for
testing, research, and controlled internal automation »*, *« For account-owned
business workflows, prefer official Instagram APIs »*.

> **Décision : on n'utilise ni l'un ni l'autre.** Pas avec le compte de
> l'association, et pas avec un compte jetable non plus — un bannissement en
> cours de campagne ferait perdre la collecte sans préavis.

## 3. L'API Graph officielle — la voie durable, mais pas pour cette campagne

`ig_hashtag_search` est **vivant** (appel sans jeton → 400 `Param user_id is not
a valid Instagram User ID`, c'est-à-dire « l'endpoint répond, il lui manque
l'authentification »).

**Prérequis**, tous obligatoires :

1. compte Instagram **professionnel** (Business ou Creator) ;
2. **une Page Facebook liée** — la recherche par hashtag n'existe que dans
   « Instagram API **with Facebook Login** » ;
3. une app Meta et un jeton d'un utilisateur ayant un rôle sur la Page ;
4. permission `instagram_basic` + la *feature* **`Instagram Public Content
   Access`**, qui exige **App Review ET Business Verification** — **2 à 4
   semaines** annoncées par soumission.

**Limites une fois obtenue :**

| Limite | Valeur |
| --- | --- |
| hashtags interrogeables | **30 sur 7 jours glissants** |
| `recent_media` | **médias des dernières 24 h seulement** |
| pagination | `after` uniquement, ordre chronologique **non garanti** |
| **champ `username`** | **INDISPONIBLE** sur les médias renvoyés |
| comptes privés, Stories | exclus |

Deux de ces limites font mal ici :

- **la fenêtre de 24 h** impose un cron toutes les 12 h *pendant toute la
  campagne* — une passe ratée, et les créations sont perdues **sans rattrapage
  possible** ;
- **l'absence de `username`** casse l'attribution : la galerie et le relais
  affichent « par @pseudo », et l'API ne le donne pas.

> **Calendrier :** entre le 13/08 et la clôture du 22/08/2026, il reste **9
> jours** contre 2 à 4 semaines de revue. **Ce n'est pas faisable à temps.**
> La chaîne Meta reste à lancer dès maintenant, pour Inatober en octobre.

## 4. Ce qu'on a bâti à la place : le dépôt manuel

Le participant colle son permalien et son image. C'est plus fiable qu'un
collecteur sur un point précis : **l'attribution est exacte**, puisque c'est
l'auteur qui se nomme — là où l'API officielle, elle, ne rend pas le pseudo.

### 4.1 La brique de vérification

`graph.facebook.com/v23.0/instagram_oembed` répond encore **200 sans jeton**,
mais il a été vidé : il ne rend plus que `version, provider_name, provider_url,
type, width, html`, et le `html` est un `<blockquote>` dont le seul texte
visible est « View this post on Instagram ». **Ni auteur, ni miniature, ni
légende.**

Il ne sert donc pas à récolter. Il répond à **une** question, et il y répond de
façon fiable et gratuite :

| Réponse | Verdict |
| --- | --- |
| **200** | la publication existe et est **publique** |
| **400**, `code: 24`, `error_subcode: 2207045` | « Media Not Found » : inexistante, supprimée, ou compte passé en privé |
| 5xx, réseau coupé | **`indeterminee` — le dépôt PASSE quand même** |

> ⚠ **Une panne de Meta n'est pas un refus.** Refuser la création d'un
> participant parce que *notre* vérification est en panne lui ferait payer une
> panne qui n'est pas la sienne. Le dépôt est accepté, et le staff tranche
> depuis son salon de suivi.

### 4.2 Le code

| Fichier | Rôle | Réseau ? |
| --- | --- | --- |
| `packages/types/src/instagram.ts` | analyse d'un permalien, pseudo, hashtag, **verdict**, appel oEmbed | l'appel seul |
| `apps/website/src/app/iergday/actions.ts` | server action `deposerCreationInstagram` | oui |
| `apps/website/src/app/iergday/DepotInstagram.tsx` | l'îlot client (formulaire replié) | non |
| `packages/cron/src/tasks/campagnes-instagram.ts` | revalidation périodique (`campagnes:instagram`) | oui |

> **Pourquoi ces règles vivent dans `@rosegriffon/types` et pas dans l'app.**
> Deux surfaces posent la MÊME question à Meta : le site quand un membre dépose,
> le cron quand il revérifie des heures plus tard. Deux lectures divergentes du
> verdict laisseraient un post supprimé affiché — ou, dans l'autre sens,
> masqueraient toute la galerie sur une panne. Le module est pur ou
> web-standard (`fetch`, `URL`, `AbortSignal`), donc importable des deux côtés,
> et le point d'entrée oEmbed est un **paramètre** plutôt qu'une lecture
> d'environnement : un module partagé ne devine pas dans quel processus il
> tourne. **33 tests** (`bun test packages/types/src/instagram.test.ts`), dont
> l'appel réseau lui-même, mesuré contre un `Bun.serve` local.

**Formes de permalien acceptées** — un participant colle ce que son appli lui
donne, et les formes diffèrent :

```
https://www.instagram.com/p/Db_AxXAlywQ/
https://www.instagram.com/rose_griffonfr/p/Db_AxXAlywQ/
https://instagram.com/p/Db_AxXAlywQ/?igsh=MzRlODBiNWFlZA==
https://www.instagram.com/reel/Db_AxXAlywQ/
instagram.com/p/Db_AxXAlywQ
```

Toutes rendent le même `shortcode` et le même permalien canonique. ⚠ **`igsh` est
un jeton de traçage** — il identifie le partageur, pas la publication : le garder
stockerait une donnée de pistage, et deux membres partageant le même post
créeraient deux lignes au lieu d'une. Il est retiré.

Sont **refusés** : un profil, un autre domaine (`instagram.com.pirate.example`),
un shortcode hors gabarit, du texte quelconque. On ne devine jamais : un
shortcode inventé passerait la validation de forme, échouerait chez Meta, puis
laisserait une carte vide dans la galerie.

### 4.3 La table

`public.campagne_creations_instagram` — migration
`apps/website/sql/migrations/20260813_campagne_creations_instagram.sql`,
**appliquée**, 0 ligne à ce jour.

```
campagne_slug   text     → x_campagnes(slug) on delete cascade
shortcode       text     → clé chez Instagram, CHECK ^[A-Za-z0-9_-]{5,30}$
permalink       text
auteur_pseudo   text     → saisi par le déposant (NULL pour l'API Graph)
legende         text
hashtag_trouve  text     → NULL = le dépôt n'en portait pas
a_media         boolean  → « au moins une image RÉ-HÉBERGÉE », pas « le post a une photo »
nb_images       smallint
images          jsonb    → [{chemin, nom, type_mime, largeur, hauteur, taille, url_origine}]
mis_en_avant    boolean
masque          boolean
motif_masquage  text
publie_le       timestamptz
collecte_le     timestamptz
origine         text     → CHECK in ('formulaire','graph_api','staff')
soumis_par      uuid     → qui a déposé (NULL pour graph_api)
PRIMARY KEY (campagne_slug, shortcode)
```

Quatre index (galerie partielle, vedette, masquées, déposant), `revoke all` **puis**
`grant select` à `anon`/`authenticated` — ⚠ un GRANT au niveau table masque
silencieusement tout REVOKE par colonne, l'ordre est impératif —, RLS en
intersection (`not masque` ET campagne `publiee`), et **aucun trigger
`rg_realtime_notify`** : il diffuserait `motif_masquage` et `soumis_par` sur un
flux SSE non authentifié.

⚠ `images[].chemin` pointe vers le bucket `assets`, **jamais** vers
`scontent.cdninstagram.com` : ces URL sont signées et expirent, exactement comme
celles de Discord.

### 4.4 Les cinq gardes du dépôt

1. **Session obligatoire** — un dépôt anonyme est un formulaire de spam ouvert
   sur une galerie publique ; `soumis_par` garde qui a déposé quoi.
2. **Lien vérifié** chez Meta avant l'entrée en base.
3. **Image ré-hébergée** dans notre Storage, chemin déterministe
   (`campagnes/<slug>/instagram/<shortcode>.<ext>`) : un second dépôt du même
   post écrase le même objet au lieu d'empiler une copie par tentative.
4. **Quota** de 10 dépôts par membre et par campagne, compté **avant** l'appel à
   Meta et l'envoi du fichier.
5. **Relais vers le staff** — chaque dépôt part dans le salon de suivi à la
   passe suivante : rien n'entre sans qu'un humain le voie.

Et la campagne est **relue en base** (ouverte, publiée, non close) plutôt que
crue sur parole : le champ caché du formulaire vient du navigateur, donc de
personne.

### 4.5 La revalidation — `campagnes:instagram`

`packages/cron/src/tasks/campagnes-instagram.ts`, **toutes les heures à la
minute 35**.

Les deux autres sources se corrigent seules : un tweet supprimé disparaît de
`tweets`, un message Discord effacé porte un `deleted_at` que la galerie filtre.
**Instagram ne nous dit rien.** Notre ligne est une photographie prise au moment
du dépôt ; l'auteur peut ensuite supprimer son post ou passer son compte en
privé, et la galerie continuerait d'afficher une carte qui mène à un 404.

| Verdict oEmbed | Ligne libre | Masquée par le cron | Masquée par un humain |
| --- | --- | --- | --- |
| **publique** | rien | **restaurée** | **rien** |
| **introuvable** | **masquée** | rien | rien |
| **indeterminee** | rien | rien | rien |

Trois règles, et chacune répare un dégât précis :

1. **Une panne de Meta n'est pas une suppression.** `indeterminee` ne masque
   rien **et n'écrit même pas `verifie_le`** : la ligne repasse à la passe
   suivante. Traiter une coupure comme un retrait viderait la galerie entière
   en une passe, sans qu'aucune interface ne dise pourquoi.
2. **On ne défait jamais une décision humaine.** Le masquage automatique porte
   un motif unique — `post retiré par son auteur, ou compte passé en privé` —
   qui sert de **signature** : lui seul est restaurable. ⚠ Le reformuler sans
   migrer les lignes existantes les rendrait définitivement non restaurables.
3. **`a_media` veut dire « image servable ».** Chaque `images[].chemin` est
   contrôlé en `HEAD` dans le bucket ; si l'objet a disparu, la ligne retombe à
   `a_media = false` plutôt que d'afficher une vignette cassée.

`verifie_le` (migration `20260814_campagne_creations_instagram_verifie_le.sql`)
donne l'ordre de passage : jamais vérifié d'abord, puis le plus ancien. Fraîcheur
de **12 h**, plafond de **60 lignes** par passe — une passe sans changement ne
coûte qu'une requête SQL. La minute 35 tombe **après** la récolte Discord (25) et
**avant** le relais de la minute 45 : une création masquée ici ne part donc jamais
dans le salon de suivi comme si elle était encore en ligne.

> **Elle ne ré-héberge rien, et c'est délibéré.** Pour une ligne d'origine
> `formulaire` — les seules qui existent — l'unique copie de l'image était
> l'envoi du membre : `images[].url_origine` porte le **permalien** (une page
> HTML), pas une URL de média. Il n'y a littéralement rien à retélécharger.
> Écrire un téléchargeur pour `origine = 'graph_api'` (zéro ligne, API non
> accordée) livrerait du code que rien n'a jamais exercé. La tâche constate,
> corrige le compteur, et le dit dans son journal.

⚠ `masque`, `motif_masquage` et `mis_en_avant` sont **absents** de la clause
`do update` de l'upsert — même règle que les deux autres sources. Sans ça, un
membre dont la création vient d'être retirée la ferait réapparaître en la
redéposant.

## 5. État d'avancement

| Pièce | État |
| --- | --- |
| Table + migration | **fait**, appliquée |
| Colonne `verifie_le` + index d'ordre de passage | **fait**, appliquée le 14/8/2026 |
| `@rosegriffon/types/instagram` (+ 33 tests) | **fait** |
| Server action `deposerCreationInstagram` | **fait** |
| Type `PostCampagneInstagram`, `clePost` | **fait** |
| Galerie : `SELECT_POSTS` union des 3 sources | **fait**, déployé |
| Cartes et visionneuse : branchement par source | **fait**, déployé |
| `x_campagne_relais.source = 'instagram'` | **accepté** par le schéma |
| Formulaire dans `/iergday` (`DepotInstagram.tsx`) | **fait**, déployé |
| `creationsInstagram()` dans le relais | **fait** |
| Tâche cron `campagnes:instagram` (+ 8 tests) | **fait** |

La chaîne est complète : un membre dépose → le lien est vérifié chez Meta →
l'image est ré-hébergée → le staff le voit dans son salon de suivi à la passe
suivante → la publication est recontrôlée toutes les 12 h tant qu'elle vit.

**Ce qui reste ouvert, et ne dépend pas de nous :** la chaîne Meta (compte pro +
Page Facebook + App Review) pour `ig_hashtag_search`, à lancer pour Inatober en
octobre. Le jour où elle est accordée, `origine = 'graph_api'` s'insère à côté de
`formulaire` sans toucher au reste — la clé primaire dédoublonne une publication
à la fois déposée et récoltée.

## 6. Ce que la page dit au visiteur, et pourquoi

Le bouton Instagram de `/iergday` est libellé **« Ouvrir Instagram »**, pas
« Poster sur Instagram », et une ligne sous les boutons précise que le hashtag
est à coller soi-même et que la publication n'arrive pas dans la galerie
automatiquement.

**Il n'existe aucune URL permettant de pré-remplir une publication Instagram** —
ni sur le web, ni par schéma d'application. Un bouton qui le promettrait
enverrait le participant sur un écran vide en lui laissant croire qu'il a raté
une étape.

## 7. Commandes

```bash
# Les règles partagées (33 tests) et la décision de modération (8 tests)
bun test packages/types/src/instagram.test.ts
bun test packages/cron/src/tasks/campagnes-instagram.test.ts

# Revalider à la main — `--dry` interroge Meta sans rien écrire
bun packages/cron/src/tasks/campagnes-instagram.ts --campagne iergday --dry
bun packages/cron/src/index.ts --run campagnes:instagram [slug]
#   --tout        ignore la fraîcheur de 12 h et revérifie toute la table
#   --limite <n>  plafond de lignes par passe (défaut 60)

# Vérifier un permalien à la main
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://graph.facebook.com/v23.0/instagram_oembed?url=https://www.instagram.com/p/<code>/&omitscript=true"

# Appliquer les migrations (rejouables)
psql "$DATABASE_URL" -f apps/website/sql/migrations/20260813_campagne_creations_instagram.sql
psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_campagne_creations_instagram_verifie_le.sql
```

## 8. Voir aussi

- [campagnes-hashtag.md](campagnes-hashtag.md) — les trois sources d'une
  campagne, la tolérance aux fautes de frappe sur le hashtag, le relais Discord.
- `apps/website/src/lib/x-campagnes/queries.ts` — l'union des trois sources de la
  galerie, et les gardes de publication recopiées dans chaque branche.
