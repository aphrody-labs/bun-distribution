# Site participatif — socle social, fil unifié, kit d'interface et API agents

Ce document décrit les quatre sous-systèmes ajoutés pour faire du site un CMS et
un wiki participatif ouvert aux humains **comme aux agents**. Il dit surtout
*pourquoi* chaque choix a été fait : c'est ce qui évite de le défaire par erreur.

## 1. Socle social — `lib/social.ts`, `lib/social-shared.ts`

Une cible = `(kind, id)` avec `kind ∈ post | wiki | databook | tierlist | comment`.

- **Pourquoi polymorphe** : la table historique `Comment` était liée par clé
  étrangère à `Post`. Les commentaires ne pouvaient donc exister que sous un
  article, alors que le wiki, les databooks et les tier lists ont le même besoin.
  Quatre tables quasi identiques auraient signifié quatre jeux de bugs.
- **Contrepartie assumée** : `kind` n'est pas une clé étrangère (une fiche wiki
  vit dans le schéma `bot.*`). L'existence de la cible est donc vérifiée **à
  l'écriture** par `resolveTarget()`, jamais déléguée à une contrainte. Toute
  nouvelle surface commentable s'ajoute là, et nulle part ailleurs.
- **Cible wiki** = `<table>#<rowId>`, jamais le slug : un renommage de fiche ne
  doit pas effacer sa conversation (`wikiTargetId()`).
- **Deux niveaux de fil, pas N.** Un commentaire, ses réponses. Le serveur refuse
  `depth_exceeded` ; l'interface ne propose donc rien d'impossible.
- **Rien n'est effacé par la modération.** `hidden` conserve la ligne et la trace
  du modérateur ; `deleted` est réservé à l'auteur qui retire son message. Un fil
  amputé devient incompréhensible pour ceux qui y avaient répondu.

Tables : `ContentComment`, `ContentReaction` (migration
`apps/shenron/site/src/db/migrations/0015_social_agents.sql`, idempotente). La migration
reprend les anciens `Comment` et les `TierlistVote` — ids réutilisés, donc
rejouable sans doublon.

### Règle de cache à ne pas casser

Les compteurs publics (nombre de messages, de « j'aime ») sont rendus **côté
serveur** ; l'état personnel (« est-ce que JE l'ai aimé ») est résolu par les
îlots clients via `/api/social/*`. Lire la session dans une page la rendrait
dynamique et lui ferait perdre son cache CDN.

## 2. Fil d'actualité unifié — `lib/feed.ts`

Quatre sources : articles (`Post`), révisions wiki (`wiki_revisions` via
`lib/wiki-modifications`), contributions acceptées (`wiki_contributions`),
discussions (`ContentComment`).

- `/news` = articles en tête (ce qui se lit) + aperçu du fil.
- `/news/fil[/<onglet>][/page/<n>]` = le fil complet, **une URL par onglet et par
  page** (catch-all). Un `?filter=` rendrait la page dynamique sous Next 16.
- `/wiki/modifications` redirige en permanent vers `/news/fil/wiki`.
- La pagination tire chaque source jusqu'à `page × parPage` puis fusionne :
  l'ordre final n'existe qu'après fusion, un `OFFSET` SQL serait faux. D'où
  `FEED_MAX_PAGES` — au-delà, c'est une archive, pas un fil.

## 3. Kit d'interface — `components/kit/`

`PageShell`, `Stack`, `SectionHeading`, `TabNav`, `LinkPager`, `MangaCard`,
`CardGrid`, `EmptyState`, `StatTiles`, `Chip`, `DomainBar`, `PublicViewLink`.

- **Une page ne redéfinit plus une largeur, un cadre, une carte, une pagination
  ni un état vide.** Le site en avait cinq variantes divergentes ; si une
  variante manque, on l'ajoute ICI, avec son nom et sa raison.
- Vocabulaire Toriyama : cadre d'encre 2 px, ombre portée franche, badge incliné,
  pas de dégradé. Les classes existent déjà en CSS (`toriyama-card`,
  `toriyama-btn`, `toriyama-badge`, `onomatopee`).
- `LinkPager` (liens, pages prérendables) ≠ `components/ui/Pagination`
  (pagination client d'une liste déjà chargée).
- `DomainBar` relie la page publique à son back-office (`lib/domains.ts`). C'est
  un îlot client : afficher le lien n'accorde rien, l'écran d'administration
  reste protégé par `requireAdmin()`.

## 4. Carte du site — `lib/site-map.ts`

Dérivée de `lib/wiki-launch.ts` (le registre d'accès, seule source de vérité des
rubriques) + les pages non *gatables* (légal, espace membre, documentation d'API).

Consommateurs : `app/sitemap.ts`, `components/SiteFooter.tsx`,
`lib/site-menu.ts` (menu mobile), `/plan-du-site`, `/llms.txt`.

> Avant, ces listes existaient en cinq exemplaires divergents : ouvrir une
> rubrique depuis `/admin/lancement` la faisait apparaître dans la nav mais pas
> au sitemap ni au pied de page, et le pied de page annonçait des rubriques
> refermées (307 en bas de chaque page).

## 5. API agents — `/api/agent/v1/*`

Authentification : `Authorization: Bearer dbfr_agent_…`. Clés créées depuis
`/admin/agents`, **hachées en base** (SHA-256), jetons affichés une seule fois.

Portées : `read`, `contribute`, `comment`, `write:articles`,
`publish:articles`, `moderate` (`lib/agent-scopes.ts`).

| Route | Portée | Effet |
| --- | --- | --- |
| `GET /whoami` | `read` | Portées et quota restant. |
| `GET /feed` | `read` | Fil unifié, mêmes règles de visibilité que le public. |
| `GET /articles` | `read` | Liste ; brouillons seulement sur demande explicite. |
| `POST /articles` | `write:articles` | Crée un article **en brouillon** (markdown). |
| `GET /comments` | `read` | Fil d'une cible. |
| `POST /comments` | `comment` | Message signé du nom de l'agent. |
| `PATCH /comments` | `moderate` | Masquer / rétablir / épingler. |
| `GET /wiki/contributions` | `moderate` | File de modération. |
| `POST /wiki/contributions` | `contribute` | Proposition — **n'écrit rien** dans le wiki. |

Invariants :

1. **Un seul chemin d'écriture.** Les articles passent par `lib/cms-posts.ts`,
   la fonction utilisée par `/admin/posts`. Les commentaires par `lib/social.ts`.
   Les corrections par `lib/wiki-contributions.ts`. Aucune route d'agent ne
   réécrit une règle métier.
2. **L'agent envoie du markdown, jamais du HTML.** Converti en document Tiptap
   puis re-rendu côté serveur : aucun balisage client n'atteint une page
   publique.
3. **Rédiger ≠ publier.** Sans `publish:articles`, un `status: "published"`
   retombe en brouillon — l'agent alimente la rédaction, il ne publie pas.
4. **Tout est journalisé** dans `AgentAudit` (y compris les refus), et le quota
   horaire ne compte que les écritures.

Découverte : `/api/agent/v1/openapi.json` (OpenAPI 3.1) et `/admin/api-docs`, **tous
deux réservés** — clé d'agent valide ou session d'administration. Ils ont été
publics une demi-journée le 2026-09-12 puis refermés : le contrat d'écriture, les
portées et les routes du bot décrivent le fonctionnement interne du site, et
`/llms.txt` est revenu à ce qu'il doit être, une carte des pages publiques.

Ce qui n'est plus exposé côté lecteur, et pourquoi :

| Retiré | Raison |
| --- | --- |
| Flux public des révisions wiki (`/wiki/modifications`, onglets `wiki` et `communaute` du fil) | Il racontait la fabrication du site — qui écrit quoi, sur quel champ — au lieu de Dragon Ball. L'historique reste dans `wiki_revisions` et `/admin/wiki/history`. |
| `/api-docs` public, `llms.txt` documentant l'API d'écriture | Carte de la salle des machines. Les intégrations se demandent par contact. La page vit désormais sous `/admin/api-docs` : un `notFound()` sur la route publique rendait la page not-found avec un **200** (coquille du layout déjà envoyée), donc un lien toujours vivant pour les robots. |
| Mentions d'agents / d'IA dans les pages publiques | Un lecteur vient pour le contenu ; le marqueur « auto » sur un message automatique reste, lui, parce qu'il protège le lecteur. |
| Assistant flottant (bouton rond, anneau dégradé, emoji) | Contraire à DESIGN.md sur trois points, et il annonçait l'IA sur chaque page. L'assistant garde sa page `/ask`. |

Le contrat est testé : `apps/shenron/site/tests/agent-api.test.ts` vérifie que chaque
chemin déclaré existe comme `route.ts`, que les portées sont toutes décrites et
que publier reste une portée distincte.

## Écrans d'administration

- `/admin/agents` — clés, portées, quotas, journal des appels.
- `/admin/moderation/commentaires` — file unique des commentaires, toutes
  surfaces confondues, avec lien de retour vers le contexte public.

## Pièges

- **Ne pas réintroduire `Comment`** comme table d'écriture : elle est conservée
  en lecture de repli uniquement. Tout passe par `ContentComment`.
- **Ne pas lire la session** dans une page publique pour afficher un état social :
  utiliser les îlots (`LikeButton`, `CommentThread`, `DomainBar`).
- **Ne pas ajouter un `?filter=`** au fil ni au journal : cela casse le cache CDN
  (cf. `app/news/fil/[[...path]]`).
- **Ne pas donner `SHENRON_ADMIN_TOKEN` à un agent** : créer une clé d'agent avec
  les seules portées nécessaires.
- La migration `0015` s'applique **directement en SQL** (`psql -f`) :
  `drizzle-kit migrate` plante sous Bun (cf. en-tête de `0014`).

## 6. Les mots de Toriyama — `/wiki/toriyama`

Les déclarations de l'auteur vivaient à trois endroits : le corpus canon
(`canon_references`), les interviews rangées parmi les 451 ouvrages de
`/wiki/databooks`, et les introductions de tankōbon dans un troisième jeu de
documents. Personne ne pouvait répondre à « qu'a-t-il dit sur Vegeta ? » sans
ouvrir trois écrans.

`lib/toriyama-words.ts` les réunit en une liste groupée par ouvrage, du plus
ancien au plus récent. Deux règles :

1. **Seule la parole d'auteur entre.** `isAuthorVoice()` exige un marqueur de
   prise de parole (interview, entretien, *Shenlong Times*, *Hetappi Manga
   Kenkyūjo*, introduction de tome, *Toriyama THE WORLD*). Un guide d'animation
   qui le cite reste dehors : « Toriyama a dit » et « un guide affirme » ne sont
   pas la même chose.
2. **Rien n'est reformulé.** Le texte est celui de la source (en japonais quand
   le corpus l'a en japonais), la traduction celle du corpus, et la référence
   accompagne chaque citation. Sur un auteur disparu, reformuler c'est lui faire
   dire.

La page est déclarée dans `lib/wiki-launch.ts` (`toriyama-paroles`), donc
présente d'un coup dans la nav, le pied de page, le menu mobile, le plan du site
et le sitemap. Elle est liée depuis `/wiki/canon`, `/wiki/databooks` et, côté
équipe, depuis `/admin/canon` (les citations s'y éditent).
