# Format des scénarios

Un chapitre = un fichier `.json` dans ce dossier. Aucun code à écrire : le jeu lit
ces fichiers au démarrage et les propose dans « Choisir un chapitre ».

Tout champ de texte accepte soit une chaîne, soit un objet par langue :

```json
"texte": "Une réplique"
"texte": { "fr": "Une réplique", "en": "A line", "ja": "セリフ" }
```

Une langue absente retombe sur le français, puis sur la première disponible :
une réplique non traduite s'affiche quand même.

## Squelette d'un chapitre

```json
{
  "id": "ch01",
  "ordre": 1,
  "titre": { "fr": "…", "en": "…", "ja": "…" },
  "debut": "arrivee",
  "scenes": {
    "arrivee": {
      "fond": "vestiaire",
      "musique": 0,
      "lignes": [
        { "narration": { "fr": "…" } },
        { "qui": "attaquant", "humeur": "sourire", "texte": { "fr": "…" } },
        { "pensee": { "fr": "…" } }
      ],
      "choix": [
        {
          "texte": { "fr": "…" },
          "affection": { "attaquant": 2 },
          "aller": "suite_a"
        },
        {
          "texte": { "fr": "…" },
          "si": { "affection": { "gardien": 3 } },
          "variable": { "a_promis": true },
          "aller": "suite_b"
        }
      ]
    },
    "suite_a": {
      "fond": "terrain",
      "lignes": [ { "narration": { "fr": "…" } } ],
      "suite": "fin"
    },
    "suite_b": { "suite": "fin" },
    "fin": { "lignes": [ { "narration": { "fr": "…" } } ] }
  }
}
```

## Champs

### Chapitre

| Champ | Rôle |
|---|---|
| `id` | identifiant unique ; à défaut, le nom du fichier |
| `ordre` | position dans la liste des chapitres (entier). `00-gabarit.json` porte `9999` exprès : le modèle ne doit jamais passer avant un vrai chapitre dans « Choisir un chapitre » |
| `titre` | titre affiché, localisable |
| `debut` | identifiant de la première scène ; à défaut, la première déclarée |
| `scenes` | dictionnaire `identifiant → scène` |

### Scène

| Champ | Rôle |
|---|---|
| `fond` | nom de décor (`terrain`, `vestiaire`, …), `cdn:<chemin>`, ou `vfs:<chemin>`. Voir ci-dessous |
| `musique` | index de piste du catalogue local, ou `null` pour couper |
| `lignes` | liste de répliques, jouées dans l'ordre |
| `choix` | liste de choix proposés après les répliques |
| `suite` | scène suivante quand il n'y a pas de choix (ou choix sans `aller`) |
| `match` | joue un match ; voir plus bas |

Une scène sans `suite` ni `choix` termine le chapitre.

### Ligne

| Forme | Effet |
|---|---|
| `{ "qui": "<id de rôle>", "texte": … }` | le rôle parle : nom, couleur, voix et médaillon |
| `{ "qui": "<id de rôle>" }` (sans `texte`) | place réservée : le rôle dit une vraie réplique du jeu, tirée du catalogue local, en attendant que la ligne soit écrite |
| `{ "qui": "moi", "texte": … }` | le personnage joueur parle, sous le nom et la couleur choisis à la création. Pas de médaillon : le portrait affiché reste celui de son interlocuteur. `moi` est réservé, un rôle du casting ne peut pas porter cet identifiant |
| `{ "narration": … }` | narration : portée par le rôle `narrateur` du casting s'il est déclaré, sinon texte sans locuteur en italique |
| `{ "pensee": … }` | pensée du personnage joueur, entre parenthèses |

Une ligne sans `qui` ni `narration` ni `pensee` mais avec `texte` est traitée
comme une narration.

### Répliques non encore écrites

Omettre `texte` sur une ligne de personnage ne casse rien : le rôle prononce une
réplique réelle d'*Inazuma Eleven Victory Road*, relevée dans les scripts
d'événement du jeu par `niers vn export --dialogues-max`. Les répliques sortent
dans l'ordre du catalogue, donc deux lectures d'un même chapitre donnent le même
texte.

C'est le seul endroit du projet où du texte narratif ne vient pas de l'équipe.
Sans catalogue local, la ligne reste vide — le chapitre se joue quand même.

### Le personnage joueur

Le joueur crée son personnage avant le premier chapitre (écran « Ton personnage »,
consultable ensuite par « Mon personnage » dans le menu). Ses choix vivent dans
`game/creation.json` — ajouter un genre, une couleur de cheveux ou une origine se
fait là, sans toucher au code.

Ces choix s'écrivent directement dans n'importe quel champ de texte, comme
`[joueuse]` le faisait déjà :

| À écrire | Rend |
|---|---|
| `[joueuse]` | son nom |
| `[surnom]` | le surnom que l'équipe emploie (son nom, s'il n'en a pas donné) |
| `[genre]` | son genre, tel qu'il l'a choisi ou écrit |
| `[origine]`, `[age]`, `[taille]` | son origine, son âge, sa taille en cm |
| `[yeux]`, `[cheveux]`, `[coupe]`, `[teint]` | ses traits, en toutes lettres |
| `[poste]` | son poste sur le terrain |

**Accords.** Les pronoms posent aussi des mots courts, à coller au ras du texte :

| À écrire | `elle` | `il` | `iel` |
|---|---|---|---|
| `[iel]` | elle | il | iel |
| `[lui]` | elle | lui | iel |
| `[e]` | e | *(rien)* | ·e |
| `[un]` | une | un | un·e |
| `[ce]` | cette | ce | cette |

```json
"texte": { "fr": "Tu es sûr[e] de toi, [surnom] ? [iel] t'attend depuis ce matin." }
```

`[e]` couvre les adjectifs réguliers (`prêt[e]`, `content[e]`, `sûr[e]`). Il ne
sait rien faire des irréguliers — « nouveau / nouvelle » se contourne en
choisissant un autre mot, pas en espérant que `[e]` s'en charge.

La liste des mots vient de `creation.json` (section `pronoms`, clé `mots`, une
table par langue) : en ajouter un le rend aussitôt disponible dans les scénarios.
Un nom de mot réservé au moteur ou au jeu est refusé et signalé dans `log.txt` —
poser n'importe quel nom dans le store est exactement ce qui a déjà planté ce
projet une fois.

### Effets de texte

Tout champ de texte accepte les balises de Ren'Py (`{b}`, `{i}`, `{color=#…}`)
et, en plus, celles de la bibliothèque *Kinetic Text Tags* installée dans
`game/lib/` — elles s'écrivent directement dans le JSON, sans toucher au code :

```json
"texte": { "fr": "Il {shake=2}tremble{/shake} encore… {glitch}quoi ?{/glitch}" }
```

Principales : `{shake}`, `{bounce}`, `{rainbow}`, `{glitch}`, `{fade}`,
`{drop}`, `{sizebounce}`, `{grad}`. La liste complète et leurs paramètres sont
en tête de `game/lib/kinetic_text_tags/kinetic_text_tags.rpy`.

Options d'une ligne de personnage :

| Champ | Rôle |
|---|---|
| `humeur` | `neutre`, `ferme`, `surpris`, `crie`, `doux`, `sourire`, `agace`, `rire` — choisit le visage dans l'atlas d'expressions |
| `voix_categorie` | Restreint la réplique doublée jouée à un groupe de cues du même contexte (`bt`, `gl`, `fr`, `wa`, `kp`, `sp`, `pa`, `sh`, selon ce que la banque du personnage contient réellement — voir `categorie_voix` dans `nie_pont.rpy`). Ce sont des catégories réelles de la banque de voix du jeu, mais leur signification précise n'est **pas vérifiée** : à utiliser pour varier le contexte sonore d'une scène, pas pour prétendre choisir « la réplique de tir » ou « la réplique de passe ». Catégorie absente pour ce personnage → repli silencieux sur sa banque complète. |

### Choix

| Champ | Rôle |
|---|---|
| `texte` | libellé du choix |
| `affection` | points ajoutés par rôle : `{ "attaquant": 2 }` |
| `variable` | variables posées : `{ "a_promis": true }` |
| `si` | condition d'apparition : `{ "affection": { "gardien": 3 } }` ou `{ "variable": { "a_promis": true } }` |
| `aller` | scène suivante ; à défaut, la `suite` de la scène |

### Décors

`fond` est résolu dans cet ordre, et s'arrête au premier qui répond :

| Forme | Source |
|---|---|
| `"vfs:data/dx11/menu/…/img.g4tx"` | une texture de l'installation d'IEVR du joueur, transcodée à la volée |
| `"vestiaire"` | une clé connue de `DECORS_CDN` — cherchée d'abord dans le VFS, puis sur le CDN |
| `"cdn:dx11/menu/…/img.png"` | le CDN de l'association — également tenté dans le VFS d'abord |
| *(toujours)* | `game/nie/fonds/<nom>.png`, puis un dégradé procédural propre à la clé |

Le VFS passe avant le CDN partout où les deux portent la même image : il est
local, donc sans latence ni échec réseau, et il rend la source à sa résolution
native. Le VFS n'est présent que chez un joueur qui a le jeu installé ; **une
scène ne doit jamais supposer qu'un `vfs:` a été honoré** — sans lui, la
résolution continue et finit sur un dégradé, jamais sur une erreur.

### Match

```json
"match": { "adverse": "…", "tours": 10, "seed": 12345 }
```

Le mini-jeu de match est jouable au tour par tour. `seed` rend la partie
reproductible ; sans lui, chaque partie diffère.

Le personnage joueur est titulaire par défaut, au poste choisi à la création, et
son poste lui vaut le bonus de statistiques décrit dans `creation.json`. Les
rôles de `titulaires` — sinon les premiers du casting — occupent les postes
restants. `"avec_joueuse": false` le laisse sur le banc, pour un match qu'il
regarde depuis la touche.

#### Match tranché par le moteur natif

```json
"match": { "adverse": "…", "moteur": "natif", "seed": 12345 }
```

`"moteur": "natif"` remplace le tour par tour par la simulation 11 contre 11 du
dépôt `nie` : la rencontre est calculée d'un bloc, sans écran ni choix, puis
racontée but par but avec la minute de chaque réalisation. C'est ce qu'il faut
pour un match que le personnage joueur ne dispute pas — un match d'une autre
équipe, ou un match qu'il regarde.

Le résultat est posé comme celui du tour par tour (`resultat_match`,
`score_match`) : une scène qui les lit ne voit aucune différence entre les deux
moteurs.

La force des deux onze pèse sur l'issue, et `seed` la rend reproductible — sans
graine, elle est dérivée du nom des équipes, si bien qu'une même scène rejouée
donne toujours le même match.

Cette clé demande la bibliothèque native `nie_ffi`, qui n'est **pas** distribuée
avec le jeu (voir `game/niepy_pont.rpy`). Quand elle manque — le cas chez la
plupart des joueurs — la clé est ignorée et le match se joue au tour par tour.
Une scène ne doit donc jamais supposer qu'elle a été honorée.

## Rôles

Les identifiants utilisés dans `"qui"` viennent de `game/casting.json` — ou, en
son absence, des personnages présents dans le catalogue local. Voir l'en-tête de
`game/otome.rpy` pour le format exact du casting.

## Vérifier son chapitre

L'écran « Choisir un chapitre » affiche, sous chaque fichier, les renvois cassés
(une `suite` ou un `aller` vers une scène qui n'existe pas). Un chapitre sans
avertissement est structurellement jouable.
