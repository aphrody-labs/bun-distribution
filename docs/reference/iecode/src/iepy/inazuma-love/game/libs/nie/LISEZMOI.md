# `nie` — le greffon IEVR pour Ren'Py

Une **bibliothèque Ren'Py** qui donne à n'importe quel projet de ce fork tout ce que
le dépôt *nie* sait faire d'*Inazuma Eleven: Victory Road* : le VFS du jeu et ses
255 308 entrées, ses décodeurs de formats, ses textures, le catalogue d'assets
exportés, et la simulation de match.

```renpy
image portrait = "nie:data/dx11/menu/200_icon/10_icon_chr/face/c01000010_l.g4tx"
image visage   = "nie:c01000010"                      # raccourci : l'icône de menu

$ score, buts = nie.simuler(nie.equipe("Raimon", 220), nie.equipe("Zeus", 90))
```

## Installer

Déposer ce dossier dans `game/libs/` d'un projet, et s'assurer que
`game/libs/libs.txt` existe. C'est tout.

```
<projet>/game/libs/libs.txt        ← sa présence suffit ; le moteur ne lit pas son contenu
<projet>/game/libs/nie/            ← ce dossier
```

Le chemin de `libs.txt` ne se devine pas : `renpy/script.py:397` teste littéralement
`loadable("libs/libs.txt")`. Un cran plus bas, il ne serait jamais vu et les
bibliothèques perdraient leur priorité — silencieusement.

Rien d'autre n'est requis : `niepy` est vendorisé ici et le greffon met son dossier
au `sys.path` lui-même (`renpy.add_python_directory`).

## Ce qu'il coûte à un projet qui ne s'en sert pas

Rien qu'on puisse mesurer. La détection coûte ~11 µs ; le montage du VFS (0,6 à
1,0 s) n'a lieu qu'au **premier accès réel**, et le catalogue de même. Un projet qui
n'affiche aucune image `nie:` ne paie que la lecture de ces fichiers.

## Les deux niveaux de disponibilité

| | ce que c'est | présent chez un joueur ? |
|---|---|---|
| `nie.disponible` | le paquet Python `niepy` | oui — versionné avec le projet |
| `nie.natif` | la bibliothèque `nie_ffi` | non — elle vient d'un `cargo build` du dépôt *nie* |

Tout ce qui touche au VFS, aux formats ou au match teste `nie.natif` d'abord. Sans
elle, chaque appel rend `None` ou une liste vide, et **rien ne lève** : l'absence
d'un média dégrade, elle n'interrompt pas une scène.

Déposer la bibliothèque native :

```bash
python outils/synchroniser_niepy.py --ffi     # depuis le dépôt nie
```

## L'API

### Médias

| | |
|---|---|
| `"nie:<chemin VFS>"` | displayable, partout où Ren'Py en attend un écrit |
| `"nie:<code perso>"` | l'icône de menu du personnage |
| `nie.nom(chemin)` | le même, sous forme de nom — ou `None` s'il n'y est pas |
| `nie.image(chemin)` | le displayable directement, ou `None` |
| `nie.icone(code)` / `nie.nom_icone(code)` | l'icône de menu d'un personnage |
| `nie.illustration(chemin_cdn)` / `nie.nom_illustration(…)` | par un chemin de style CDN |
| `nie.existe(chemin)` | présence, **sans lire le contenu** |
| `nie.lire(chemin)` | octets bruts |
| `nie.charger(chemin)` | fichier décodé en objet Python (~89 % des entrées) |
| `nie.chercher(motif)` | exploration de l'index |
| `nie.entrees()` | nombre d'entrées adressables |

Les fonctions en `nom_*` rendent `None` quand l'asset manque : un appelant n'a jamais
à distinguer « absent du VFS » de « VFS indisponible ».

### Catalogue exporté

`nie.catalogue.{personnages, musique, repliques, replique, dialogues, atlas, icone,
planches, piste, chemin, est_charge}` — voir `20_catalogue.rpy`. C'est **la seule
source de voix** : le VFS porte l'audio en ACB/AWB, et `nie_ffi` n'expose aucun
décodeur audio.

### Match

| | |
|---|---|
| `nie.equipe(nom, note)` | un onze, depuis une note ou des statistiques détaillées |
| `nie.simuler(nous, eux, seed)` | tranche la rencontre → `(score, buts datés)` |
| `nie.graine(*parts)` | graine stable dérivée d'un contenu, jamais de l'horloge |
| `nie.arene()` | le monde 11 v 11 jouable, à avancer pas à pas |

`simuler` et `arene` ne répondent pas au même besoin. `arene` fait TOURNER un match
jouable, mais n'accepte aucune graine et son onze est le sien. `simuler` tranche une
rencontre à partir des statistiques et d'une graine — c'est celui d'un récit.

### État

`nie.etat()` rend `[(titre, [(clé, valeur), …]), …]` en **clés machine** : un greffon
ne connaît pas la langue de son hôte. `nie.libelle(clé)` donne un repli français.

## Réglages

Un projet les surcharge par un `define`, qui s'exécute à l'init 0 — donc après les
défauts (init -999) et avant le préchargement (init 999).

```renpy
define nie.precharger = True                 # monter au démarrage plutôt qu'à l'usage
define nie.budget_cache = 192 * 1024 * 1024  # plafond mémoire du cache CPK
define nie.racine = "D:/…/Inazuma Eleven"    # installation, si la détection échoue
define nie.cache = None                      # où sont mis les PNG (défaut : config.savedir)
define nie.dossier_catalogue = "nie"         # dossier d'export, relatif à game/
```

Ce ne sont pas des `config.*`, et ce n'est pas un choix de style :
`_Config.__setattr__` (`renpy/defaultstore.py:99`) refuse tout nom absent de
`renpy/config.py`, et `define config.x` passe par le même chemin
(`000namespaces.rpy:172`). Inventer un `config.nie_*` demanderait de modifier le
moteur — la divergence que ce greffon refuse.

## Vérifier

```bash
renpy.py <projet> nie-verifier
```

Dix contrôles exercés dans un vrai Ren'Py, sans écran, avec un **vrai code de sortie**.
Chaque contrôle rend `OK`, `ABSENT` (état normal — pas de `nie_ffi`, pas
d'installation, pas d'export) ou `CASSÉ` (fait échouer).

Cette commande existe parce que **`lint` n'est pas une barrière** : il rend 0 même
quand un `init python:` lève. Un pont cassé passerait donc un lint « propre ».

## Trois décisions, et ce qui les a tranchées

**Le cache ne s'écrit jamais sous `game/`.** Le motif final de `00build.rpy` est
`("**", "all")` : tout ce qu'un projet écrit sous `game/` part dans son zip. L'en
exclure demande un `build.classify(…, None)` que `build.clear()` efface à n'importe
quelle priorité. Le cache vit donc sous `config.savedir`, et `_dossier_cache()` **lève**
si le chemin résolu tombe sous `config.gamedir` : distribuer un asset d'IEVR cesse
d'être interdit pour devenir impossible.

**Le plafond mémoire est obligatoire.** Le défaut de la bibliothèque native est de
**16 Gio**, dimensionné pour un traitement par lots. Mesuré sous ce défaut : soixante
lectures de textures dispersées retiennent **4 941 351 152 octets** sur 39 paquets.
Avec 128 Mio, les mêmes lectures retiennent 408 Mo et une entrée.

**On ne confisque aucun crochet.** `config.file_open_callback` et
`config.loadable_callback` sont mono-valeur ; les prendre interdirait au projet
d'accueil d'avoir les siens. Le greffon s'ajoute à `renpy.loader.file_open_callbacks`
(une liste, `loader.py:521`) et chaîne `loadable_callback`.

## Pièges vérifiés

- **`dict` n'est pas `dict` dans un store.** `renpy/minstore.py:45` fait
  `dict = RevertableDict`, y compris dans un store nommé. Un `isinstance(x, dict)` sur
  une donnée venue du dehors — du JSON rendu par la couche native, par exemple — est
  **faux**. Employer `collections.abc.Mapping`.
- **Un store nommé n'hérite que de `minstore`.** Ni `config`, ni `Image`, ni `Null` n'y
  sont. L'idiome amont est `from store import config, renpy, …`
  (`renpy/common/00achievement.rpy:28`).
- **`_constant = True` est obligatoire.** Le montage porte un pointeur natif. Sérialisé
  puis rechargé dans un autre processus, il désigne n'importe quoi : le processus
  avorte (exit 127) au premier accès. `_constant` retire le store des sauvegardes
  (`renpy/python.py:288`), et `niepy.Vfs` refuse désormais de se sérialiser.
- **Un `.rpyc` orphelin continue de s'exécuter.** Retirer un `.rpy` ne suffit pas ;
  seul `renpy.py <projet> compile` nettoie (`renpy/script.py:174`).
- **Ren'Py choisit son décodeur d'image sur l'extension du NOM.** Un nom finissant par
  `.g4tx` serait écarté avant d'être lu — d'où le `.png` des noms internes. Ce détail
  ne sort jamais de `10_medias.rpy`.

## Les fichiers

| | |
|---|---|
| `00_socle.rpy` | détection de `niepy` et `nie_ffi`, réglages |
| `10_medias.rpy` | VFS, transcodage, préfixe `nie:`, branchement sur le loader |
| `20_catalogue.rpy` | catalogue produit par `niers vn export` |
| `30_match.rpy` | simulation à graine, et arène jouable |
| `40_etat.rpy` | diagnostic, en clés machine |
| `50_verifier.rpy` | la commande `nie-verifier` |
| `python-packages/niepy/` | vendorisé depuis le dépôt *nie* — **ne jamais corriger ici** |

Corriger un défaut de `niepy` se fait dans le dépôt *nie*, puis
`python outils/synchroniser_niepy.py`. Sinon la prochaine synchronisation l'efface.
