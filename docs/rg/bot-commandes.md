# Catalogue définitif des slash commandes — bot Discord

Ce document fixe l'arbre **définitif** des commandes du bot communautaire
(`apps/bot`, profil `rg`) et le plan de bascule pour y arriver. C'est un document de **planification** : il ne
modifie aucun fichier `.ts`, il prépare la mise en œuvre à venir.

État relevé le **14/8/2026**, sources vérifiées listées en fin de document
(§6). Le code a bougé pendant la rédaction (ajout de `/profil`, `/classement`,
`/kizuna`, `/collection`, `/personnaliser`, `/ticket`, `/gestion niveaux`,
`/gestion ticket`, `/gestion sondage`) — l'inventaire ci-dessous reflète l'état
**après** ces ajouts, relu à la source une fois les commits en place.

---

## 1. Inventaire actuel

### 1.1 Répartition par bot (confirmée par les journaux)

```
journalctl -u rg-bot.service --since "-2 hours" | grep -i "adding\|updating"
```

- **`rg-bot` (profil `rg`)** — 17 racines : `profil`, `classement`,
  `administration`, `gestion`, `moderation`, `ticket`, `agenda`, `staff`,
  `boutique`, `campagne`, `equipe`, `membre`, `patreon`, `sondage`, `kizuna`,
  `collection`, `personnaliser`.
Les commandes de données Azalée sont désormais exposées par l'API unifiée et
ne sont plus chargées par une seconde identité Discord.

### 1.2 Arbre complet — bot Rose Griffon (`MODULES_RG`)

#### `/administration` — écrit, réservé au staff (`ManageGuild` + `requireRgAdmin`)

*Description racine : « Administration Rose Griffon — écrit vraiment (réservé au staff) »*

| Groupe | Sous-commande | Description | Options principales |
| --- | --- | --- | --- |
| `cron` | `lancer` | Déclenche une tâche du démon (le niveau requis dépend de la tâche) | `tache` (autocomplete) |
| `cron` | `annonce` | Publie l'annonce d'un article publié dans le salon dédié (rôle admin) | `article`, `salon`, `forcer` |
| `equipe` | `ajouter` | Ajoute un membre dans une équipe | `equipe`, `nom`, `role`, `discord`, `image`, `lien`, `ordre` |
| `equipe` | `modifier` | Modifie un membre — les champs laissés vides ne bougent pas | mêmes champs, tous optionnels |
| `equipe` | `activer` | Affiche ou retire un membre du site, sans rien supprimer | `membre`, `actif` |
| `equipe` | `supprimer` | SUPPRIME définitivement un membre (confirmation, journalisé) | `membre` |
| `equipe` | `photos` | Reprend les avatars Discord des membres actifs qui en ont un | — |
| `journal` | `salon` | Choisir le salon du journal de modération (vide = ne rien publier) | `salon` |
| `reglages` | `liste` | Toutes les clés de réglage, avec leur rôle | — |
| `reglages` | `lire` | Valeur exacte d'une clé, telle qu'elle est stockée | `clef` |
| `reglages` | `ecrire` | Remplace la valeur d'une clé (rôle admin, destructif, tracé) | `clef`, `valeur`, `description`, `creer` |
| `synchroniser` | `membres` | Balaie tout le serveur : arrivées, mises à jour, retours, départs | `departs`, `forcer` |
| `synchroniser` | `membre` | Resynchronise une seule personne, sans balayer tout le serveur | `utilisateur` |
| `utilisateur` | `liste` | Cherche des profils (pseudo, nom, identifiant) et filtre par rôle | `recherche`, `role` |
| `utilisateur` | `info` | Fiche d'un profil — sans e-mail ni adresse, jamais | `membre`, `identifiant` |
| `utilisateur` | `role` | Change le rôle d'un profil (confirmation, journalisé) | `role`, `membre`, `identifiant` |
| `utilisateur` | `bannir` | Passe un profil en « banned » (confirmation, journalisé) | `membre`, `identifiant`, `raison` |
| `utilisateur` | `debannir` | Rend un profil banni à « member », le rôle par défaut réel | `membre`, `identifiant` |
| `veille` | `regler` | Change la notification des posts X : salon, comptes, filtre, curseur | `actif`, `salon`, `max`, `ajouter`, `retirer`, `exclure`, `inclure`, `curseur` |

Poids mesuré le 29/8/2026 : **4 647 / 8 000** (58 %).

#### `/gestion` — contenu éditorial, réservé au staff

*Description racine : « Contenu Rose Griffon — articles, événements, planning (réservé au staff) »*

| Groupe | Sous-commande | Description | Options principales |
| --- | --- | --- | --- |
| `article` | `liste` | Les articles des deux sites, brouillons et archives compris | `statut`, `site`, `nombre` |
| `article` | `publier` | Rendre un article visible du public | `article` |
| `article` | `depublier` | Repasser un article en brouillon | `article` |
| `article` | `archiver` | Retirer un article du public sans le détruire | `article` |
| `evenement` | `liste` | Les événements enregistrés dans la table `events` | `portee`, `nombre` |
| `evenement` | `creer` | Ajouter un événement à l'agenda public | `titre`, `debut`, `fin`, `lieu`, `description`, `image` |
| `evenement` | `modifier` | Changer un événement — les champs omis restent inchangés | `identifiant` + mêmes champs optionnels |
| `evenement` | `supprimer` | Retirer définitivement un événement de l'agenda | `identifiant`, `confirmation` |
| `niveaux` | `reglages` | La configuration actuelle de la progression | — |
| `niveaux` | `recompense` | Attribuer un rôle à un palier de niveau | `niveau`, `role`, `cumulable` |
| `niveaux` | `retirer` | Retirer la récompense d'un palier | `niveau` |
| `niveaux` | `annonce` | Où et à quelle fréquence annoncer les montées | `lieu`, `salon`, `palier` |
| `niveaux` | `salon` | Exclure (ou réinclure) un salon du gain d'XP | `salon`, `action` |
| `sondage` | `creer` | Publier un sondage natif Discord (archivé ensuite sur le site) | `question`, `choix`, `duree`, `multiple`, `salon` |
| `sondage` | `cloturer` | Arrêter un sondage avant sa fin et publier ses résultats | `message`, `salon` |
| `stream` | `liste` | Le planning complet, du lundi au dimanche | `statut` |
| `stream` | `ajouter` | Ajouter un créneau au planning | `jour`, `streamer`, `debut`, `fin`, `categorie`, `notes`, `statut` |
| `stream` | `modifier` | Changer un créneau — les champs omis restent inchangés | `identifiant` + champs optionnels |
| `stream` | `supprimer` | Retirer définitivement un créneau du planning | `identifiant`, `confirmation` |
| `ticket` | `reglages` | Voir la configuration actuelle des tickets | — |
| `ticket` | `poser` | Poser un salon ou un rôle du système de tickets | `reglage`, `salon` |
| `ticket` | `role` | Ajouter ou retirer un rôle de prise en charge | `liste`, `role`, `action` |
| `ticket` | `diagnostic` | Vérifier que les tickets fonctionneront VRAIMENT | — |
| `ticket` | `panneau` | Publier le panneau d'ouverture de tickets | `salon` |
| `ticket` | `encours` | Les tickets encore ouverts, avec leur âge | — |

Poids **mesuré le 29/8/2026 sur l'arbre construit** : **7 798 / 8 000** (97 %) — **la racine la plus chargée du bot, et elle est à 202 caractères de la rupture**. Le prochain groupe ou la prochaine option ajoutée ici fera échouer l'enregistrement de TOUTES les commandes du bot (`50035 APPLICATION_COMMAND_TOO_LARGE`), pas seulement la sienne. L'estimation précédente (≈ 5 364) sous-évaluait de 45 % : elle ne comptait pas les valeurs des choix. À dégonfler avant tout ajout.

#### `/moderation` — pouvoirs Discord, réservé au staff

*Description racine : « Modération Discord — bannir, expulser, rôles, salons (réservé au staff) »*

| Groupe | Sous-commande | Description | Options principales |
| --- | --- | --- | --- |
| `moderation` | `bannir` | Bannir du SERVEUR DISCORD (≠ bannir le compte du site) | `membre`, `motif`, `jours-messages`, `aussi-le-compte` |
| `moderation` | `debannir` | Lever un bannissement du SERVEUR DISCORD | `identifiant`, `motif` |
| `moderation` | `expulser` | Expulser du SERVEUR DISCORD | `membre`, `motif` |
| `moderation` | `exclure` | Exclure temporairement : le membre reste, mais ne peut plus écrire ni parler | `membre`, `duree`, `motif` |
| `moderation` | `leverexclusion` | Lever une exclusion temporaire avant son terme | `membre`, `motif` |
| `moderation` | `avertir` | Avertir en privé : aucune sanction Discord, mais une trace dans le journal | `membre`, `motif` |
| `role` | `donner` | Donne un rôle à un membre du serveur | `membre`, `role`, `motif` |
| `role` | `retirer` | Retire un rôle à un membre du serveur | `membre`, `role`, `motif` |
| `role` | `creer` | Crée un rôle aux couleurs de la charte Rose Griffon | `nom`, `couleur` (14 choix), `mentionnable`, `affiche-separement` |
| `role` | `supprimer` | Supprime définitivement un rôle du serveur | `role`, `motif` |
| `role` | `renommer` | Change le nom d'un rôle | `role`, `nom` |
| `role` | `masse` | Donne un rôle à tous les porteurs d'un autre rôle (simulation par défaut) | `role-source`, `role-a-donner`, `simulation` |
| `salon` | `creer` | Crée un salon textuel, vocal ou d'annonces dans une catégorie | `nom`, `type`, `categorie`, `sujet` |
| `salon` | `renommer` | Change le nom d'un salon ou d'une catégorie | `salon`, `nom` |
| `salon` | `verrouiller` | Retire « Envoyer des messages » à @everyone, archive l'état d'avant | `salon`, `motif` |
| `salon` | `deverrouiller` | Rend à @everyone exactement l'état d'avant le verrouillage | `salon`, `motif` |
| `salon` | `lent` | Pose le mode lent d'un salon, de 0 à 6 heures | `salon`, `secondes`, `motif` |
| `salon` | `purger` | Supprime en masse les derniers messages (jamais au-delà de 14 jours) | `salon`, `nombre`, `auteur`, `motif` |
| `salon` | `annoncer` | Publie un embed signé Rose Griffon dans un salon | `salon`, `titre`, `texte`, `image` |
| `salon` | `supprimer` | Supprime définitivement un salon ou une catégorie | `salon`, `motif` |
| `historique` | `membre` | Le dossier de modération d'un membre : décompte, gravité, journal | `membre`, `nombre` |
| `historique` | `recentes` | Les dernières actions de modération du serveur | `nombre` |
| `multicomptes` | `membre` | Les comptes qui ressemblent à un membre, avec le détail des indices | `membre`, `niveau` |
| `multicomptes` | `balayage` | Tous les rapprochements du serveur, du plus fort au plus faible | `niveau`, `jours` |
| `multicomptes` | `verdict` | Trancher une paire : même personne, ou faux positif | `compte`, `autre-compte`, `decision`, `motif` |
| `multicomptes` | `tranchees` | Les paires déjà tranchées par le staff | — |

Poids mesuré le 29/8/2026 : **7 086 / 8 000** (89 %), dont 892 pour `multicomptes`. Marge : 914 caractères.

#### `/staff` — consultation d'exploitation, ne modifie jamais rien

*Description racine : « Consultation de l'exploitation Rose Griffon (staff) — ne modifie jamais rien »*

| Groupe | Sous-commande | Description | Options principales |
| --- | --- | --- | --- |
| `cron` | `taches` | Catalogue des tâches, leur planification et le niveau requis pour les lancer | — |
| `cron` | `metriques` | Compteurs d'exécution du démon depuis son démarrage | — |
| `cron` | `statut` | Dernière exécution d'une tâche : succès, durée, erreur | `tache` |
| `cron` | `telemetrie` | Télémétrie Discord tenue par le démon | — |
| `discord` | `serveur` | Fiche du serveur : membres, salons, rôles, boosts, fonctionnalités, création | — |
| `discord` | `roles` | Les rôles, leur rang, leur effectif et ce qu'ils permettent | `page` |
| `discord` | `salons` | L'arborescence des salons, catégorie par catégorie | `categorie` |
| `discord` | `bannissements` | La liste des membres bannis, avec le motif enregistré | `page` |
| `discord` | `invitations` | Les invitations actives : auteur, salon, usage, expiration | `page` |
| `discord` | `journal` | Les dernières entrées du journal d'audit Discord (25 max) | — |
| `discord` | `permissions` | DIAGNOSTIC : ce que le bot peut réellement faire ici, action par action | — |
| `services` | `etat` | Sonde les dix services internes en parallèle : vert/rouge, latence, unité | — |
| `services` | `detail` | Fiche d'un service : rôle, adresses, sonde brute | `service` |
| `services` | `deploiement` | Version réellement servie par le wiki et le site, slot par slot | — |
| `stats` | `site` | Profils, articles, événements et équipe de rosegriffon.fr | — |
| `stats` | `discord` | Membres, salons, messages et sondages du serveur | — |
| `veille` | `suivi` | État de la notification des nouveaux posts : filtre, curseur, salon | — |
| `veille` | `profil` | Fiche d'un compte X, lue chez X à l'instant | `pseudo` |
| `veille` | `posts` | Derniers posts d'un compte X, lus chez X à l'instant | `pseudo`, `limite` |
| `veille` | `recherche` | Posts X correspondant à une requête, lus chez X à l'instant | `requete`, `limite` |
| `web` | `page` | Rend une page publique en markdown lisible | `url`, `profil` (static/http) |
| `web` | `google` | Recherche web, avec le moteur qui a réellement répondu | `requete`, `limite` |
| `web` | `recon` | Diagnostic d'une page : en-têtes, technologies détectées, liens | `url` |

Poids mesuré le 29/8/2026 : **2 743 / 8 000** (34 %).

#### Racines publiques (communauté, aucune écriture)

| Racine | Sous-commande | Description | Options |
| --- | --- | --- | --- |
| `profil` *(commande plate, sans groupe)* | — | Ta carte de progression, ou celle d'un autre membre | `membre`, `partager` |
| `classement` *(commande plate)* | — | Le classement du serveur, en niveaux ou en jetons Kizuna | `critere`, `page`, `partager` |
| `agenda` | `evenements` | Les rendez-vous Rose Griffon (conventions, meet-ups) | `periode`, `nombre` |
| `agenda` | `streams` | Le planning hebdomadaire de Rose Griffon TV | `jour` |
| `boutique` | `catalogue` | Le catalogue de la boutique, avec les prix et les liens vers les fiches | `categorie` |
| `boutique` | `produit` | La fiche d'un produit : prix, variantes, contenu et lien de commande | `produit` |
| `campagne` | `liste` | Liste les campagnes publiées et leur volume de participation | `en-cours`, `page` |
| `campagne` | `voir` | Affiche une campagne : participations, métriques, créations récoltées | `campagne` |
| `collection` | `voir` | Les joueurs que tu as recrutés | `membre`, `partager` |
| `collection` | `recruter` | Recruter un joueur au hasard (200 jetons Kizuna) | `partager` |
| `collection` | `plaques` | Les plaques de nom en vente | `page` |
| `collection` | `acheter` | Acheter une plaque de nom | `plaque` |
| `personnaliser` | `favori` | Le joueur affiché sur ta carte de profil | `joueur` |
| `personnaliser` | `plaque` | La plaque de nom en fond de ta carte | `plaque` |
| `equipe` | `carte` | La carte illustrée des membres d'une équipe | `nom`, `role` |
| `kizuna` | `solde` | Ton solde de jetons Kizuna | `membre`, `partager` |
| `kizuna` | `quotidien` | Ton passage du jour (50 jetons, plus la prime de série) | — |
| `kizuna` | `donner` | Offrir des jetons Kizuna à un membre | `membre`, `montant` |
| `kizuna` | `journal` | Tes derniers mouvements de jetons (privé) | — |
| `membre` | `profil` | Le compte d'un membre sur rosegriffon.fr | `qui` |
| `membre` | `discord` | La fiche d'un membre du serveur Discord | `qui` |
| `membre` | `recherche` | Chercher un membre par pseudo ou nom affiché | `texte` |
| `patreon` | `etat` | Combien de soutiens par palier, agrégé | — |
| `patreon` | `moi` | Ton propre statut de soutien — visible de toi seul | — |
| `sondage` | `liste` | Parcourt les sondages du serveur, filtrables par état et par période | `etat`, `periode`, `recherche`, `page` |
| `sondage` | `voir` | Affiche un sondage : question, choix, barres de résultat et total | `sondage` |
| `ticket` | `ouvrir` | Ouvrir un ticket auprès du staff | `categorie`, `sujet` |
| `ticket` | `fermer` | Fermer le ticket de ce fil, avec son motif | `motif` |
| `ticket` | `prendre` | Prendre en charge le ticket de ce fil (staff) | — |
| `ticket` | `rendre` | Rendre le ticket de ce fil au staff (staff) | — |
| `ticket` | `info` | L'état du ticket de ce fil | — |
| `ticket` | `liste` | Les tickets encore ouverts (staff) | — |

#### `/achillea` — lecture des serveurs scannés par le bot Achillea (14/8/2026)

*Description racine : « Les serveurs scannés par le bot Achillea : métadonnées, rôles, salons »*

| Sous-commande | Description | Options |
| --- | --- | --- |
| `serveur` | Fiche d'un serveur scanné : membres, rôles, salons, date du dernier scan | `identifiant` (optionnel) |
| `roles` | Les rôles du serveur, du plus haut au plus bas | `identifiant` (optionnel) |
| `salons` | Les salons rangés sous leurs catégories | `identifiant` (optionnel) |
| `scan` | État global : serveurs relevés, membres cumulés, dernier passage | — |

Lecture seule, publique : elle n'expose que ce que l'API d'Achillea publie déjà, sans
aucune donnée de membre. Sans `identifiant`, elle vise le serveur courant, et Achillea
par défaut. Les données viennent de `GET /guilds/:id` du bot Achillea, validées à
l'exécution par des schémas Zod (`services/achillea.ts`) : les deux dépôts sont séparés,
aucun type ne traverse, donc la vérification remplace la garantie du compilateur. Voir
[`achillea.md`](achillea.md).

Poids par racine : toutes **< 620 / 8 000** (< 8 %). `validation-annonce.ts` ne déclare aucune commande (boutons seuls).

### 1.3 Arbre complet — bot Azalée (`MODULES_AZALEE`)

*Registre actuel : `article`, `azalee-jeu`, `cpk`, `rag`, `cdn`, `x`,
`validation-annonce` (boutons seuls).*

| Racine | Sous-commande | Description | Options | Poids racine |
| --- | --- | --- | --- | --- |
| `article` | `derniers` | Les articles les plus récents des deux sites | `site`, `categorie`, `nombre` | ≈ 617 (8 %) |
| `article` | `lire` | Ouvrir un article précis | `article` | |
| `article` | `recherche` | Chercher un article par mot-clé, titre ou contenu | `texte`, `site`, `categorie` | |
| `azalee` | `perso`, `technique`, `objet`, `equipe`, `recherche`, `aura`, `tactique`, `passif`, `quete`, `entraineur`, `stade`, `succes`, `capsule`, `costume`, `invocation`, `drops`, `magasin`, `galerie`, `coordinateur` | Encyclopédie du jeu (19 sous-commandes à plat, aucun sous-groupe) | 1 option `String` requise + 0-2 optionnelles par sous-commande | ≈ 2 368 (30 %) |
| `cpk` | `parcourir`, `chercher`, `fichier` | Les 250 800 fichiers extraits des archives, décodés en direct | `chemin`/`motif`/`page` | ≈ 480 (6 %) |
| `cdn` | `image`, `modele`, `galerie`, `etat` | Les assets du CDN : images, modèles 3D, galerie | `chemin`, `largeur`, `code`, `categorie`, `recherche` | ≈ 852 (11 %) |
| `rag` | `question`, `texte`, `corpus` | Recherche sémantique du corpus indexé | `question`/`recherche`, `type`/`langue`, `nombre` | ≈ 919 (11 %) |
| `x` | `liste`, `voir`, `annoncer` | Archive des posts X récoltés par la veille | `compte`, `categorie`, `recherche`, `page`, `post` | ≈ 554 (7 %) |

`azalee` (19/25 sous-commandes) est la racine la plus proche du **plafond des
25 sous-commandes par groupe** — pas du plafond de caractères (30 % à peine).
C'est l'inverse du profil `rg`, où c'est le budget de 8 000 caractères qui
serre (`/gestion`, `/moderation`), jamais le nombre de sous-commandes.

⚠ **`/article` est enregistré sur le bot Azalée, pas sur le bot Rose
Griffon** — vérifié par `journalctl` et par `MODULES_AZALEE`. C'est une
décision explicite (commit `08f96dda`, « /staff revient au bot Rose Griffon et
/article passe au bot Azalée »), mais **deux sources documentaires
existantes la contredisent** :
- le commentaire d'en-tête de `MODULES_AZALEE` dans `profil.ts` lui-même,
  resté au libellé d'avant ce commit (il dit que le profil Azalée sert
  « `/azalee`, `/cpk`, `/rag`, `/cdn` » + « `/x` » + « toute la racine
  `/staff` » — sans un mot sur `/article`, et en listant `/staff` qui n'y est
  plus) ;
- `docs/bot-azalee.md` §7 (« Il ne fait pas : […] aucune commande
  communautaire de Rose Griffon : ni `/agenda`, ni `/membre`, […] ni
  `/article` »).

Traité au §4.2 comme un **déplacement** (`/article` → `MODULES_RG`), pour
recoller la racine à son domaine (les deux sites, pas le seul jeu) et à ces
deux textes. Ce document ne corrige pas ces deux fichiers (hors mandat de
cette mission, qui ne touche aucun `.ts` et ne livre que `docs/bot-commandes.md`) —
la mise en œuvre qui appliquera §4.2 devra aussi rafraîchir ce commentaire et
ce paragraphe.

### 1.4 Récapitulatif des poids (plafond Discord = 8 000 caractères/racine)

Les quatre racines du bot Rose Griffon ont été **mesurées** le 31/8/2026 sur
l'arbre réellement construit par discordx (somme des `name`, `description` et
valeurs de choix, la métrique que Discord applique) ; les autres restent des
estimations. L'écart est important — les estimations ne comptaient pas les
valeurs des choix et sous-évaluaient `/gestion` de 45 %.

| Racine | Bot | Poids | % du plafond |
| --- | --- | ---: | ---: |
| `gestion` | rg | **7 798** (mesuré) | **97 % — à 202 caractères de la rupture** |
| `moderation` | rg | **7 086** (mesuré) | **89 %** |
| `administration` | rg | **4 839** (mesuré) | 60 % |
| `staff` | rg | **2 743** (mesuré) | 34 % |

Pour remesurer avant d'ajouter quoi que ce soit (depuis `apps/bot`) :

```ts
// bun -e '...' — construit l'arbre réel et applique la métrique de Discord
import "reflect-metadata";
const { PROFILS } = await import("./src/lib/profil.ts");
for (const m of PROFILS.rg.modules) await import(`./src/${m}`);
const { MetadataStorage } = await import("@rpbey/discordx");
await MetadataStorage.instance.build();
function poids(n) {
  if (!n || typeof n !== "object") return 0;
  let t = 0;
  for (const [k, v] of Object.entries(n)) {
    if ((k === "name" || k === "description" || k === "value") && typeof v === "string") t += v.length;
    else if (k.endsWith("_localizations")) continue;
    else if (Array.isArray(v)) for (const e of v) t += poids(e);
    else if (v && typeof v === "object") t += poids(v);
  }
  return t;
}
for (const c of MetadataStorage.instance.applicationCommands) {
  const t = poids(c.toJSON());
  if (t > 3000) console.log(String(t).padStart(5), "/" + c.name, t > 8000 ? "⚠" : "");
}
```

⚠ Ne PAS mesurer `JSON.stringify(c.toJSON()).length` : le JSON brut compte les
clés et la structure, et rend 26 672 pour `/gestion` — trois fois la vraie
valeur. Discord ne compte que les `name`, `description` et valeurs de choix.
| `azalee` | azalee | ≈ 2 368 | 30 % (mais 76 % du plafond de 25 sous-commandes) |
| `rag` | azalee | ≈ 919 | 11 % |
| `cdn` | azalee | ≈ 852 | 11 % |
| `article` (public) | azalee | ≈ 617 | 8 % |
| `x` | azalee | ≈ 554 | 7 % |
| `ticket` (public) | rg | ≈ 500 | 6 % |
| `cpk` | azalee | ≈ 480 | 6 % |
| `sondage` (public) | rg | ≈ 445 | 6 % |
| `collection` | rg | ≈ 469 | 6 % |
| toutes les autres racines publiques | rg | 174–401 | < 5 % |

**Méthode** : somme de `longueur(nom) + longueur(description)` pour chaque
nœud de l'arbre (racine, groupes, sous-commandes, options, libellés de
`@SlashChoice`) — c'est la définition donnée par la documentation Discord
elle-même (« *combined name, description, and value properties* »).
Estimation, pas une valeur renvoyée par l'API ; marge de quelques dizaines de
caractères possible (localisations non utilisées ici, donc pas de charge
supplémentaire de ce côté).

**`/gestion` (97 %) n'a plus que 202 caractères de marge** : c'est la racine
à neuf groupes, et le moindre ajout — un groupe, une option, une description
reformulée — y ferait échouer l'enregistrement de TOUTES les commandes du bot
(`50035`), pas seulement le sien. Rien ne doit plus y entrer sans l'avoir
dégonflée d'abord (sortir `stream`, 1 535, ou `evenement`, 1 176, vers une
racine dédiée). Les ajouts vont donc sous `/administration` (3 161 de marge),
comme `journal` le 31/8/2026 — et `/moderation`, malgré ses 914 caractères
libres, refuse un second groupe nommé `moderation` : ce serait un doublon de
nom, pas un dépassement, donc invisible dans un calcul de budget.

---

## 2. Bots tiers du serveur

### 2.1 Méthode

Guilde `1072991720268111892`, jeton `DISCORD_BOT_TOKEN`. Deux appels de
lecture, cumulés pour la liste complète (`/members` plafonne à 1 000 par
page, la guilde compte 1 902 membres) :

- `GET /guilds/{id}/integrations` → 19 intégrations, dont 16 bots tiers, les
  deux bots du dépôt (« RG », « 𝓐𝔃𝓪𝓵𝓮́𝓮 🌸 ») et « Server Subscriptions Group »
  (l'intégration native des boosts Discord, pas un bot).
- `GET /guilds/{id}/members?limit=1000` + `after=<dernier id>` → 18 comptes
  `bot:true` au total, confirmant la liste ci-dessus.

Aucun jeton utilisateur n'a été utilisé (interdit par les CGU Discord).
Aucun endpoint ne liste les commandes d'une application tierce avec un jeton
de bot — la surface de chaque bot tiers ci-dessous vient de sa documentation
publique (recherche web) et de sa description d'intégration Discord, jamais
d'une introspection de leurs commandes réelles sur ce serveur précis.

### 2.2 Tableau des bots tiers

| Bot | ID application | Rôle | Commandes/fonctions principales (doc publique) | Remplacement par notre catalogue |
| --- | --- | --- | --- | --- |
| **Noctaly** | `875811233616519219` | Tout-en-un : niveaux, économie, rôles à réaction, message de bienvenue, modération auto, appels de bannissement, journaux | XP texte/vocal/réactions, classement auto-publié, réglages de rôles à réaction, auto-modération anti-spam/invites | **Partiel.** Niveaux repris avec la vraie courbe du jeu (`/profil`, `/classement`, `/gestion niveaux`) — cf. `docs/bot-communaute.md` §1. **Non repris** : rôles à réaction, message de bienvenue, modération auto, appels de bannissement, journal de suppression de message. |
| **UnbelievaBoat** | `292953664492929025` | Économie/jeu générique : solde, banque, boutique, jobs, casino, classement | `balance`, `bank`, `shop`, `jobs`, jeux de hasard, classement d'argent | **Partiel.** Solde/don/classement repris en version thématique (`/kizuna`, `/classement`), sans casino ni jobs virtuels (choix délibéré, cf. `docs/bot-communaute.md` : « aucun gain par message », pas de jeu de hasard). |
| **EasyPoll** | `437618149505105920` | Sondages avec options multiples, durée, anonymat | `/poll`, `/timepoll`, `/schedulepoll`, `/listpolls` | **Remplacé** pour l'usage courant : `/gestion sondage creer` publie un **sondage natif Discord** (post-EasyPoll, la fonctionnalité native n'existait pas à l'installation d'EasyPoll) archivé sur le site. Écart résiduel : pas de sondage **programmé** (`/schedulepoll`). |
| **Tickets** (ticketsbot.net) | `508391840525975553` | Tickets d'assistance | Panneaux, fils privés, transcriptions | **Remplacé.** Bot **discontinué** depuis le 5/3/2025 (sunset officiel) ; notre `/ticket` + `/gestion ticket` reprend la numérotation à 86 (cf. `docs/bot-communaute.md` §1). Présence résiduelle sur le serveur = résidu d'un bot mort, à retirer. |
| **Ticket Tool** (tt.bot) | `557628352828014614` | Tickets d'assistance (alternative) | `/panel`, `/close`, `/reopen`, `/delete` | **Remplacé** par le même `/ticket` + `/gestion ticket` — probablement le bot de secours utilisé après le sunset de Tickets. Redondant une fois `/ticket` validé en production. |
| **Patreon** (officiel) | `216303189073461248` | Synchronisation des rôles Discord avec les paliers Patreon | attribution automatique de rôle par palier | **Non remplacé, complémentaire.** `/patreon etat`/`moi` ne fait que **lire** le statut ; l'attribution de rôle reste gérée par ce bot officiel (aucune raison de la dupliquer). |
| **Wiki-Bot** | `461189216198590464` | Recherche/lien vers un wiki MediaWiki (Wikipedia, Fandom) configuré par `!wiki settings` | `!wiki <terme>`, `!wiki random`, `!wiki verify` | **Probablement remplacé pour Inazuma Eleven** par `/azalee` (fiches plus complètes, données du jeu réel plutôt qu'un wiki communautaire) — mais **surface exacte non déterminée** : impossible de savoir sans accès au tableau de bord quel(s) wiki(s) sont réglés sur ce serveur. |
| **RaidProtect** | `466578580449525760` | Anti-raid, captcha de vérification, anti-spam | mode raid, captcha à l'arrivée, verrouillage DM, signalement | **Non remplacé, hors périmètre volontaire.** Aucune commande de nos deux bots ne fait de la détection automatique de menace ; ce n'est pas un manque, c'est un domaine dédié qu'on ne duplique pas. |
| **Mudae** | `432610292342587392` | Jeu de collection de personnages (waifu/husbando), multi-thème | `/mx`, `/ma`, `/mg`, `/hx`… (tirages), mariage, harem | **Non remplacé, hors périmètre.** Thème générique (tout anime/jeu), pas Inazuma Eleven spécifiquement — pas de recouvrement direct avec `/collection`. |
| **Inazuma Adventure** | `694558148194730005` | Bot thématique Inazuma Eleven : invocation de joueurs, classement | `/summon`, `/inadex`, `/leaderboard` | **Concurrent direct non remplacé** (bot public générique, hors de notre contrôle). `/collection` couvre le même besoin avec les **vraies données du jeu** (6 090 joueurs nommés, taux vérifiables sur le wiki) plutôt qu'un système générique — présence redondante sur le serveur, à évaluer par le staff une fois `/collection` éprouvé. |
| **DISBOARD.org** | `302050872383242240` | Référencement du serveur (bump toutes les 2 h) | `/bump` | **Non remplacé, hors périmètre.** Outil de croissance externe, aucun rapport avec une commande de contenu ou de communauté. |
| **Discohook Utils** | `792842038332358656` | Éditeur d'embeds (aperçu avant publication par webhook) | pas de commande slash utilisateur — outil web + bot d'assistance | **Non remplacé, complémentaire.** `/gestion salon annoncer` publie un embed déjà formaté ; Discohook sert à en **concevoir** un avant de le coller ailleurs (webhook), usage différent. |
| **Virtual Farmer** | `631216892606152714` | Jeu de simulation agricole (clicker), sans lien avec Inazuma Eleven | `/play`, `/profile`, `/coinflip` | **Non remplacé, hors périmètre.** |
| **eara** | `472714545723342848` | Bot de musique (lecture YouTube/Spotify/SoundCloud) | lecture, file d'attente, effets audio | **Non remplacé, hors périmètre.** Aucune de nos commandes ne touche à l'audio. |
| **Log bot** | `922263994474045540` | Fonction imprécise (documentation publique absente) — description Discord : « View commands in slash commands » | inconnu | **Non déterminé.** Aucune doc publique trouvée ; recoupement possible mais non confirmé avec `/staff discord journal` (journal d'audit). À vérifier directement sur le serveur plutôt qu'en supposer la fonction. |
| **Secrétaire RG** | `1226107197973467197` | Origine **non documentée** — ni dans ce dépôt (`grep` + `git log`), ni sur le web public. Description Discord : « Pour tout problème, signalez aux modérateurs de Rose Griffon » | inconnu | **Probablement recouvert** par `/ticket ouvrir categorie:signalement` (qui route explicitement « qu'à la direction », cf. `docs/bot-communaute.md` §6) — présomption raisonnable au vu de la description, **pas une certitude vérifiée**. À confirmer avec le staff avant toute décision. |

### 2.3 Ce qui n'a pas pu être établi

- La configuration exacte de **Wiki-Bot** (quel wiki `!wiki settings` cible
  sur ce serveur).
- La fonction réelle de **Log bot** et de **Secrétaire RG** : aucune
  documentation publique, aucune trace dans ce dépôt ; seule la description
  d'intégration Discord (courte, parfois vide) a pu être lue. Écrit ici tel
  quel plutôt qu'inventé.
- Les commandes **réellement utilisées** de chaque bot tiers sur *ce* serveur
  précis (l'API ne donne accès qu'à leur documentation publique générale, pas
  à leur configuration ici).

---

## 3. Convention de nommage

### 3.1 Contraintes dures (vérifiées, `docs.discord.com/developers/interactions/application-commands`)

| Contrainte | Valeur exacte |
| --- | --- |
| Longueur d'un nom (commande/groupe/sous-commande/option) | 1–32 caractères |
| Format du nom | `^[-_\p{L}\p{N}]{1,32}$` (Unicode, variante **minuscule** obligatoire quand elle existe — donc pas de majuscule latine) |
| Longueur d'une description | 1–100 caractères |
| Options par commande (ou sous-commande) | 25 maximum |
| Choix par option | 25 maximum |
| Sous-commandes par groupe | 25 maximum |
| Groupes par racine | 25 maximum |
| Poids total d'une racine (nom+description+valeurs cumulés) | **8 000 caractères** |
| Commandes `CHAT_INPUT` globales par application | 100 |
| Créations/modifications de commande | 200 par jour et par guilde |

C'est cette limite de 8 000 caractères qui a fait éclater l'ancien
`/administration` (13 groupes réunis) en trois racines
(`/administration`, `/gestion`, `/moderation`) — `APPLICATION_COMMAND_TOO_LARGE`
(code 50035) refuse l'enregistrement **de bloc**, pas seulement des groupes en
trop : un dépassement bloque **toutes** les commandes du bot, pas seulement la
racine fautive (cf. en-tête de `apps/bot/src/commands/administration/racine-moderation.ts`).

### 3.2 Règles de la maison

| Règle retenue | Alternative écartée, et pourquoi |
| --- | --- |
| **Racine = nom singulier** (`/agenda`, `/boutique`, `/membre`, `/azalee`) | Pluriel (`/agendas`) écarté : la racine désigne la **fonctionnalité**, pas une liste d'objets — c'est déjà l'usage constant dans les 23 racines existantes. |
| **Sous-commande qui modifie une ressource précise = verbe à l'infinitif** (`creer`, `modifier`, `supprimer`, `publier`, `verrouiller`, `bannir`) | Un nom d'action (`creation`, `suppression`) écarté : plus long pour rien, et Discord affiche déjà `/racine groupe verbe` comme une phrase lisible — un nom casserait cette lecture. |
| **Sous-commande qui consulte = nom** (`liste`, `voir`, `info`, `fiche`, `etat`, `reglages`) | Un verbe (`voir`, `lister`) reste acceptable **seulement** pour l'action « regarder un élément précis » (`voir`, déjà utilisé) — la différence lecture/écriture doit rester perceptible d'un coup d'œil dans l'autocomplétion, pas cachée dans la conjugaison. |
| **Sous-commande qui règle un comportement global (pas une ressource identifiée) reste un nom**, même si elle modifie un état (`niveaux annonce`, `role masse`, `niveaux salon`) | Forcer un verbe partout (`regler-annonce`) écarté : ces sous-commandes sont des **panneaux de réglages**, pas des créations ponctuelles — le nom dit ce qu'on règle, pas l'action de régler. |
| **Mot composé = kebab-case avec tiret** (`jours-messages`, `role-source`, `aussi-le-compte` — déjà la norme sur les options) | Concaténation collée (`joursmessages`) écartée : illisible dans l'autocomplétion, et `\p{L}` autorise le tiret — aucune raison technique de s'en priver. `moderation leverexclusion` (seul nom collé du dépôt) est un oubli de cette règle, pas une exception voulue. |
| **Pas d'accent dans les noms de commande**, bien que `\p{L}` les autorise | Accents autorisés mais écartés : la frappe doit rester identique quel que soit le clavier (QWERTY US très présent chez les développeurs et une partie des membres), et évite une hésitation d'autocomplétion entre `créer`/`creer`. Corrige au passage `docs/bot-format.md`, qui affirme à tort que les tirets sont interdits par l'API — ils ne le sont pas, seuls les accents sont un choix de style, pas une contrainte. |
| **Lecture vs écriture : racine dédiée par domaine, pas une option** — `/staff` = tout ce qui consulte l'exploitation, `/administration`+`/gestion`+`/moderation` = tout ce qui écrit, chaque ressource éditoriale a sa paire publique/staff (`/article` ↔ `/gestion article`, `/agenda` ↔ `/gestion evenement`+`/gestion stream`, `/sondage` ↔ `/gestion sondage`) | Un drapeau `--staff`/option caché sur une commande unique écarté : c'était exactement le risque nommé dans `apps/bot/src/commands/staff/racine.ts` (`/rg-user ban` et `/rg-user info` à une lettre l'une de l'autre) — deux racines séparées rendent une commande destructrice injoignable par erreur de frappe. |
| **Nouvelle ressource écrite → groupe sous une racine existante**, jamais une 4ᵉ racine d'écriture | Une nouvelle racine à chaque nouvelle ressource écartée : elle exploserait vite le compteur de 100 commandes globales pour un gain nul — le vrai plafond qui compte est le groupe (25 sous-commandes, 25 groupes), largement disponible sur les trois racines d'écriture actuelles (3 à 6 groupes sur 25). Le choix de la racine suit le domaine : contenu éditorial → `/gestion`, pouvoir Discord (rôle/salon/bannissement) → `/moderation`, tout le reste (comptes, réglages, synchronisation) → `/administration`. |
| **Nouvelle surface publique autonome → racine plate si une seule opération, groupe si ≥ 2** (`/profil` reste plat ; `/kizuna` a 4 sous-commandes) | Forcer un sous-groupe même pour une commande à une seule action (`/profil voir`) écarté : ça rallonge la commande la plus tapée du bot sans bénéfice — le plafond de 100 commandes globales est à 23/100 sur `rg`, aucune urgence à économiser des racines. |
| **Deux bots, deux listes de modules strictement disjointes** (déjà en place, `MODULES_RG` ∩ `MODULES_AZALEE` = ∅) | Un préfixe distinctif par bot (`/rg-agenda`, `/az-cpk`) écarté : alourdit **chaque** commande pour résoudre un problème qui n'existe déjà plus — la disjonction des modules le résout sans toucher un seul nom. |

---

## 4. Plan de bascule

### 4.1 Résumé des changements

- **6 renommages** (tous des sous-commandes, aucune racine ne change de nom).
- **1 déplacement** (`/article`, racine complète, Azalée → Rose Griffon).
- **0 fusion** — les deux paires citées en exemple par la commande
  (`/boutique` vs `/collection`, `/staff veille` vs `/administration veille`)
  ne sont **pas** des doublons (cf. §4.3).
- **0 suppression** côté code — les seules suppressions concernent des **bots
  tiers** (`Tickets`, `Ticket Tool`, redondants une fois `/ticket` validé),
  décision d'exploitation hors du périmètre `.ts` de cette mission.
- Le reste du catalogue (**≈ 145 sous-commandes** sur les deux bots) est
  **conforme** à la convention du §3 et ne bouge pas.

### 4.2 Tableau de correspondance (une ligne par commande)

Colonnes : commande actuelle → commande définitive, action, pourquoi. Les
lignes sans changement notent la conformité en une phrase courte plutôt que
de se répéter.

#### `/administration` (rg — inchangé de racine)

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/administration cron lancer` | `/administration cron lancer` | garder | verbe, conforme |
| `/administration cron annonce` | `/administration cron annoncer` | **renommer** | action ponctuelle (publie *maintenant*), pas un réglage — suit la règle verbe du §3.2 |
| `/administration equipe ajouter` | *(inchangé)* | garder | conforme |
| `/administration equipe modifier` | *(inchangé)* | garder | conforme |
| `/administration equipe activer` | *(inchangé)* | garder | conforme |
| `/administration equipe supprimer` | *(inchangé)* | garder | conforme |
| `/administration equipe photos` | `/administration equipe actualiser-photos` | **renommer** | action ponctuelle nommée comme une ressource ; kebab-case pour le mot composé |
| `/administration reglages liste` | *(inchangé)* | garder | conforme |
| `/administration reglages lire` | *(inchangé)* | garder | conforme |
| `/administration reglages ecrire` | *(inchangé)* | garder | conforme |
| `/administration synchroniser membres` | *(inchangé)* | garder | conforme |
| `/administration synchroniser membre` | *(inchangé)* | garder | conforme |
| `/administration utilisateur liste` | *(inchangé)* | garder | conforme |
| `/administration utilisateur info` | *(inchangé)* | garder | conforme |
| `/administration utilisateur role` | *(inchangé)* | garder | conforme (verbe implicite porté par le contexte d'écriture, comme `role donner`/`role retirer` sous `/moderation`) |
| `/administration utilisateur bannir` | *(inchangé)* | garder | conforme |
| `/administration utilisateur debannir` | *(inchangé)* | garder | conforme |
| `/administration veille regler` | *(inchangé)* | garder | conforme |

#### `/gestion` (rg — inchangé de racine)

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/gestion article liste` | *(inchangé)* | garder | conforme |
| `/gestion article publier` | *(inchangé)* | garder | conforme |
| `/gestion article depublier` | *(inchangé)* | garder | conforme |
| `/gestion article archiver` | *(inchangé)* | garder | conforme |
| `/gestion evenement liste` | *(inchangé)* | garder | conforme |
| `/gestion evenement creer` | *(inchangé)* | garder | conforme |
| `/gestion evenement modifier` | *(inchangé)* | garder | conforme |
| `/gestion evenement supprimer` | *(inchangé)* | garder | conforme |
| `/gestion niveaux reglages` | *(inchangé)* | garder | conforme |
| `/gestion niveaux recompense` | *(inchangé)* | garder | conforme |
| `/gestion niveaux retirer` | *(inchangé)* | garder | conforme |
| `/gestion niveaux annonce` | *(inchangé)* | garder | panneau de réglages (canal + fréquence), pas une action ponctuelle — cf. règle §3.2, à ne pas confondre avec `cron annonce` |
| `/gestion niveaux salon` | *(inchangé)* | garder | bascule de réglage via l'option `action` (exclure/réinclure), même famille que `role masse` — exception documentée du §3.2 |
| `/gestion sondage creer` | *(inchangé)* | garder | conforme |
| `/gestion sondage cloturer` | *(inchangé)* | garder | conforme |
| `/gestion stream liste` | *(inchangé)* | garder | conforme |
| `/gestion stream ajouter` | *(inchangé)* | garder | conforme |
| `/gestion stream modifier` | *(inchangé)* | garder | conforme |
| `/gestion stream supprimer` | *(inchangé)* | garder | conforme |
| `/gestion ticket reglages` | *(inchangé)* | garder | conforme |
| `/gestion ticket poser` | *(inchangé)* | garder | conforme |
| `/gestion ticket role` | *(inchangé)* | garder | conforme |
| `/gestion ticket diagnostic` | *(inchangé)* | garder | conforme |
| `/gestion ticket panneau` | *(inchangé)* | garder | conforme |
| `/gestion ticket encours` | *(inchangé)* | garder | conforme |

#### `/moderation` (rg — inchangé de racine)

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/moderation moderation bannir` | *(inchangé)* | garder | conforme |
| `/moderation moderation debannir` | *(inchangé)* | garder | conforme |
| `/moderation moderation expulser` | *(inchangé)* | garder | conforme |
| `/moderation moderation exclure` | *(inchangé)* | garder | conforme |
| `/moderation moderation leverexclusion` | `/moderation moderation lever-exclusion` | **renommer** | seul nom de sous-commande **collé** du dépôt — la norme kebab-case des mots composés (déjà appliquée aux options) doit s'appliquer aussi aux sous-commandes |
| `/moderation moderation avertir` | *(inchangé)* | garder | conforme |
| `/moderation role donner` | *(inchangé)* | garder | conforme |
| `/moderation role retirer` | *(inchangé)* | garder | conforme |
| `/moderation role creer` | *(inchangé)* | garder | conforme |
| `/moderation role supprimer` | *(inchangé)* | garder | conforme |
| `/moderation role renommer` | *(inchangé)* | garder | conforme |
| `/moderation role masse` | *(inchangé)* | garder | opération de masse avec option `simulation` — exception documentée du §3.2 |
| `/moderation salon creer` | *(inchangé)* | garder | conforme |
| `/moderation salon renommer` | *(inchangé)* | garder | conforme |
| `/moderation salon verrouiller` | *(inchangé)* | garder | conforme |
| `/moderation salon deverrouiller` | *(inchangé)* | garder | conforme |
| `/moderation salon lent` | *(inchangé)* | garder | conforme (ajuste un réglage, famille `niveaux salon`) |
| `/moderation salon purger` | *(inchangé)* | garder | conforme |
| `/moderation salon annoncer` | *(inchangé)* | garder | conforme |
| `/moderation salon supprimer` | *(inchangé)* | garder | conforme |

#### `/staff` (rg — inchangé de racine)

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/staff cron taches` | *(inchangé)* | garder | conforme |
| `/staff cron metriques` | *(inchangé)* | garder | conforme |
| `/staff cron statut` | *(inchangé)* | garder | conforme |
| `/staff cron telemetrie` | *(inchangé)* | garder | conforme |
| `/staff discord serveur` | *(inchangé)* | garder | conforme |
| `/staff discord roles` | *(inchangé)* | garder | conforme |
| `/staff discord salons` | *(inchangé)* | garder | conforme |
| `/staff discord bannissements` | *(inchangé)* | garder | conforme |
| `/staff discord invitations` | *(inchangé)* | garder | conforme |
| `/staff discord journal` | *(inchangé)* | garder | conforme |
| `/staff discord permissions` | *(inchangé)* | garder | conforme |
| `/staff services etat` | *(inchangé)* | garder | conforme |
| `/staff services detail` | *(inchangé)* | garder | conforme |
| `/staff services deploiement` | *(inchangé)* | garder | conforme |
| `/staff stats site` | *(inchangé)* | garder | conforme |
| `/staff stats discord` | *(inchangé)* | garder | conforme |
| `/staff veille suivi` | *(inchangé)* | garder | conforme |
| `/staff veille profil` | `/staff veille compte` | **renommer** | même collision que `/membre profil` (§4.3) : « profil » doit désigner exclusivement la carte de progression jeu (`/profil`), jamais un compte externe (ici, un compte X) |
| `/staff veille posts` | *(inchangé)* | garder | conforme |
| `/staff veille recherche` | *(inchangé)* | garder | conforme |
| `/staff web page` | *(inchangé)* | garder | conforme |
| `/staff web google` | *(inchangé)* | garder | conforme |
| `/staff web recon` | *(inchangé)* | garder | conforme |

#### Racines publiques (rg)

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/profil` | *(inchangé)* | garder | conforme, commande plate justifiée (§3.2) |
| `/classement` | *(inchangé)* | garder | conforme |
| `/agenda evenements` | *(inchangé)* | garder | conforme |
| `/agenda streams` | *(inchangé)* | garder | conforme |
| `/boutique catalogue` | *(inchangé)* | garder | conforme |
| `/boutique produit` | *(inchangé)* | garder | conforme |
| `/campagne liste` | *(inchangé)* | garder | conforme |
| `/campagne voir` | *(inchangé)* | garder | conforme |
| `/collection voir` | *(inchangé)* | garder | conforme |
| `/collection recruter` | *(inchangé)* | garder | conforme |
| `/collection plaques` | *(inchangé)* | garder | conforme |
| `/collection acheter` | *(inchangé)* | garder | conforme |
| `/personnaliser favori` | *(inchangé)* | garder | conforme |
| `/personnaliser plaque` | *(inchangé)* | garder | conforme |
| `/equipe carte` | *(inchangé)* | garder | conforme |
| `/kizuna solde` | *(inchangé)* | garder | conforme |
| `/kizuna quotidien` | *(inchangé)* | garder | conforme |
| `/kizuna donner` | *(inchangé)* | garder | conforme |
| `/kizuna journal` | *(inchangé)* | garder | conforme |
| `/membre profil` | `/membre compte` | **renommer** | lève la collision de nom avec `/profil` (carte de progression jeu) — cf. §4.3 |
| `/membre discord` | *(inchangé)* | garder | conforme |
| `/membre recherche` | *(inchangé)* | garder | conforme |
| `/patreon etat` | *(inchangé)* | garder | conforme |
| `/patreon moi` | *(inchangé)* | garder | conforme |
| `/sondage liste` | *(inchangé)* | garder | conforme |
| `/sondage voir` | *(inchangé)* | garder | conforme |
| `/ticket ouvrir` | *(inchangé)* | garder | conforme |
| `/ticket fermer` | *(inchangé)* | garder | conforme |
| `/ticket prendre` | *(inchangé)* | garder | conforme |
| `/ticket rendre` | *(inchangé)* | garder | conforme |
| `/ticket info` | *(inchangé)* | garder | conforme |
| `/ticket liste` | *(inchangé)* | garder | conforme |

#### Bot Azalée

| Actuelle | Définitive | Action | Pourquoi |
| --- | --- | --- | --- |
| `/article derniers` (bot Azalée) | `/article derniers` (bot **Rose Griffon**) | **déplacer** | `/article` couvre les deux sites, pas que le jeu — cf. §1.3 et la contradiction avec `profil.ts` (commentaire) et `docs/bot-azalee.md` §7 |
| `/article lire` | idem, bot RG | **déplacer** | idem |
| `/article recherche` | idem, bot RG | **déplacer** | idem |
| `/azalee <19 sous-commandes>` | *(inchangé)* | garder | conforme ; 19/25 sous-commandes, à surveiller avant d'en ajouter une 6ᵉ famille |
| `/cpk parcourir\|chercher\|fichier` | *(inchangé)* | garder | conforme |
| `/cdn image\|modele\|galerie\|etat` | *(inchangé)* | garder | conforme |
| `/rag question\|texte\|corpus` | *(inchangé)* | garder | conforme |
| `/x liste\|voir\|annoncer` | *(inchangé)* | garder | conforme |

### 4.3 Doublons et quasi-doublons examinés

| Paire | Verdict | Pourquoi |
| --- | --- | --- |
| `/membre profil` vs `/profil` | Collision de nom, pas un doublon de données | Le premier lit le **compte site** (pseudo, bio…), le second la **carte de progression jeu** (XP, niveau, jetons). Fusion écartée : ce sont deux domaines différents, personne ne veut voir l'un remplacer l'autre. Renommage retenu (§4.2) : `/membre profil` → `/membre compte`. |
| `/staff veille profil` vs `/profil` | Même collision, un niveau plus bas | Même traitement : renommé en `/staff veille compte` (§4.2). |
| `/boutique` vs `/collection` | Pas un doublon | `/boutique` = catalogue de produits **réels** du site (impression, t-shirt, sticker — argent réel, Stripe) ; `/collection` = cosmétiques et joueurs **virtuels** du jeu (jetons Kizuna, monnaie interne). Fusionner mélangerait un achat réel et une dépense de monnaie de jeu sous la même commande — risque de confusion sur ce qui coûte de l'argent, écarté sans hésitation. Les deux descriptions actuelles (« La boutique Rose Griffon : catalogue et fiches produit » / « Recruter des joueurs d'Inazuma Eleven avec tes jetons Kizuna ») sont déjà suffisamment distinctes ; aucune action. |
| `/article` (public) vs `/gestion article` | Pas un doublon : le patron lecture/écriture voulu du dépôt | `/article` lit ce qui est publié, `/gestion article` publie/dépublie/archive. C'est exactement la paire que suivent aussi `/agenda` face à `/gestion evenement` et `/gestion stream`, et `/sondage` face à `/gestion sondage`. Seul changement : le **déplacement** de racine du §4.2, pas une fusion. |
| `/gestion niveaux annonce` vs `/gestion niveaux salon` | Pas un doublon | Deux réglages différents (canal d'annonce des montées vs exclusion de salon du gain d'XP). Cités ensemble ici seulement parce que les deux ont été discutés au §3.2 comme exceptions à la règle du verbe. |

### 4.4 Trous de couverture face aux bots tiers, par valeur

1. **Rôles à réaction / auto-attribution par centre d'intérêt** (couvert par
   Noctaly, aucun équivalent chez nous). Plus haute valeur : sur un serveur
   de 1 902 membres, c'est la fonctionnalité self-service la plus demandée
   d'un bot communautaire, et elle réduirait la charge de `/moderation role
   donner` pour tout ce qui n'est pas sensible.
2. **Message de bienvenue personnalisé** (Noctaly « Welcomer »). Vitrine
   immédiate de la marque Rose Griffon à l'arrivée d'un membre ; absent de
   nos deux bots aujourd'hui (`intents` du profil `rg` reçoit déjà
   `GuildMembers`, donc l'événement d'arrivée est disponible sans intent
   supplémentaire).
3. **Auto-modération de base** (filtre de liens d'invitation Discord,
   anti-spam simple — Noctaly et RaidProtect le font). Volontairement hors
   périmètre pour la partie **anti-raid poussée** (RaidProtect le fait déjà
   bien, ne pas dupliquer un domaine de sécurité dédié), mais un filtre
   minimal (invites, mots interdits) pourrait raisonnablement vivre sous
   `/administration`.
4. **Workflow d'appel de bannissement** (Noctaly « Ban Appeals »). Un membre
   banni n'a aujourd'hui aucun canal formel pour contester — seul un contact
   humain hors-bot. Faible complexité (un formulaire + un salon), valeur
   correcte pour l'équité perçue du processus.
5. **Sondage programmé** (`/schedulepoll` d'EasyPoll). `/gestion sondage
   creer` couvre déjà la durée (`duree`) mais pas la **publication différée**
   (créer maintenant, publier plus tard) — écart mineur, cité en dernier
   parce que la fonctionnalité de base est déjà largement couverte.

### 4.5 Répartition rg / azalee — vérification de la disjonction

Après application du §4.2 (déplacement de `/article`), les deux listes de
modules restent strictement **disjointes** :

- `MODULES_RG` gagne `commands/article.ts` (déjà présent nulle part ailleurs
  dans `MODULES_RG`) → 35 modules.
- `MODULES_AZALEE` perd `commands/article.ts` → 6 modules :
  `azalee-jeu.ts`, `cpk.ts`, `rag.ts`, `cdn.ts`, `x.ts`,
  `validation-annonce.ts`.

Aucun nom de racine n'apparaît dans les deux listes après ce déplacement — la
propriété qui rend possible la coexistence des deux bots sur la même guilde
(`apps/bot/src/lib/profil.ts`, commentaire de `SALON_ANNONCE_AZALEE`) reste
vraie.

---

## 5. Vérification de cohérence

- **`docs/bot-azalee.md` §7** contredit désormais le code sur `/article` (cf.
  §1.3) — à rafraîchir par la mise en œuvre qui appliquera ce plan, en même
  temps que le commentaire d'en-tête de `MODULES_AZALEE` dans `profil.ts`.
- **`docs/bot-format.md`** affirme que les noms de commande sont « sans
  accent ni tiret » — seule la partie « sans accent » est un choix de style
  du dépôt (retenu au §3.2) ; « sans tiret » est **factuellement faux** (huit
  options existantes en portent déjà : `jours-messages`, `aussi-le-compte`,
  `role-source`, `role-a-donner`, `en-cours`…). À corriger dans une prochaine
  passe sur ce fichier, hors mandat de cette mission.
- **`docs/bot-communaute.md` §7** liste déjà `/profil`, `/classement`,
  `/kizuna`, `/collection`, `/personnaliser`, `/ticket`, `/gestion
  niveaux`, `/gestion ticket`, `/gestion sondage` — cohérent avec
  l'inventaire du §1.2 de ce document, aucune contradiction relevée.

---

## 6. Sources

- Code : `apps/bot/src/commands/**/*.ts` (lecture intégrale des 49 fichiers de
  commandes), `apps/bot/src/lib/profil.ts`.
- Journaux : `journalctl -u rg-bot.service -u azalee-bot.service --since "-2
  hours"`, relevé le 14/8/2026 ~08 h 21 UTC (derniers enregistrements après
  les commits `3ccd1774`, `694bb438`, `6dedfa27`).
- Historique : `git log` sur `apps/bot/src/lib/profil.ts` et
  `apps/bot/src/commands/article.ts` (commit `08f96dda` pour le déplacement
  de `/article` vers Azalée).
- API Discord (jeton `DISCORD_BOT_TOKEN`, lecture seule) : `GET
  /guilds/1072991720268111892/integrations`, `GET
  /guilds/1072991720268111892/members` (paginé), `GET
  /guilds/1072991720268111892?with_counts=true` — relevé le 14/8/2026.
- Documentation Discord officielle :
  `https://docs.discord.com/developers/interactions/application-commands`
  (limites du §3.1).
- Documentation publique de chaque bot tiers (recherche web, §2.2) — pas
  d'introspection de leur configuration réelle sur ce serveur, cf. §2.3.
