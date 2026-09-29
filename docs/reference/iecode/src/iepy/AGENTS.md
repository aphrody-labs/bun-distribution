# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Nature du dépôt

`iepy` est un **fork de Ren'Py 8.6.0** dont l'apport propre tient dans un seul dossier :
`inazuma-love/`, un visual novel otome piloté par des données. Tout le reste
(`renpy/`, `src/`, `module/`, `launcher/`, `gui/`, `sphinx/`, `scripts/`, `tutorial/`,
`the_question/`, `testcases/`) est du Ren'Py amont non modifié.

Conséquence pratique : sauf demande explicite portant sur le moteur, **le travail se fait
dans `inazuma-love/`**. Avant de toucher à `renpy/`, vérifier avec `git log` que le fichier
n'est pas purement amont — une modification y crée une divergence à maintenir lors des merges
depuis `fix`/`master`.

Les commits du fork sont en français, préfixés `feat(portée):`.

## Lancer et vérifier

Les modules Cython/C compilés viennent d'un SDK Ren'Py 8.6.0 installé à part, et le code
Python du moteur vient du dépôt. Le python du SDK exécute le `renpy.py` du dépôt :

```bash
SDK=/c/Users/aphro/renpy-sdk/renpy-8.6.0-sdk

# lancer le jeu (code moteur = celui du dépôt)
"$SDK/lib/py3-windows-x86_64/python.exe" renpy.py inazuma-love

# vérification statique — le réflexe après toute modification de .rpy
"$SDK/lib/py3-windows-x86_64/python.exe" renpy.py inazuma-love lint
```

La bannière de version distingue les deux runtimes : `8.6.0.0+unofficial` = code du dépôt,
`8.6.0.25112108` = code du SDK. Si la bannière affiche la version datée, c'est le `renpy.py`
du SDK qui a été lancé et les modifications du dépôt sont ignorées.

Diagnostic après un plantage : `inazuma-love/errors.txt` (erreurs de parsing `.rpy`),
`traceback.txt`, `log.txt` — tous gitignorés, tous réécrits à chaque lancement.

`lint` ne lit pas les JSON : valider les données (casting, catalogue, locales, `creation.json`)
avec un script jetable lancé par le python du SDK — c'est ainsi qu'ont été vérifiés les 30 rôles
et la complétude des trois locales.

Ren'Py charge le `.rpyc` compilé même quand le `.rpy` a disparu : déplacer un fichier source ne
le retire pas du jeu tant que son `.rpyc` reste dans `game/`.

Ne pas piloter le jeu par automatisation de fenêtres : Windows refuse `SetForegroundWindow` à un
processus sans focus, et les clics partent dans les autres applications de l'utilisateur. Tout ce
qui demande de VOIR l'écran se délègue à l'utilisateur.

### Compiler du Cython/C — voir `natif/README.md`

Il existe **une** chaîne de compilation utilisable sur cette machine, montée dans `natif/` :
`Cython → clang-cl → lld-link → .pyd`, chargé par le python du SDK. Elle a servi à recompiler
`renpy/display/matrix.pyx` depuis les sources du dépôt et à le substituer à son built-in ;
`renpy/display/render`, resté dans `librenpython.dll`, s'en sert sans le savoir.

Trois choses à savoir avant d'y toucher :

- **Les modules natifs de Ren'Py ne sont pas des fichiers.** Les 63 (`renpy.display.render`,
  `renpy.gl2.*`, `renpy.audio.renpysound`…) sont liés dans `librenpython.dll` et enregistrés
  comme built-in. On ne les remplace qu'avec un `MetaPathFinder` posé avant le bootstrap —
  `sys.modules[nom] = module` ne suffit pas, l'attribut du paquet parent manquerait.
- **`renpy.py` porte la seule divergence du fork dans le moteur** : cinq lignes appelant
  `natif/surcharge.py` juste avant `import renpy.bootstrap`. Sans `natif/modules.json`, elles
  ne font rien. `RENPY_SANS_NATIF=1` désactive tout — premier réflexe de diagnostic.
- **SDL2, HarfBuzz et FFmpeg sont accessibles.** `librenpython.dll` réexporte leurs symboles
  (2 020 / 457 / 698) ; `librenpython.lib`, générée depuis sa table d'exports, en compte
  12 373. Les en-têtes s'installent par `construire.py --deps`, aux versions exactes que la
  DLL rapporte (SDL2 2.0.20, HarfBuzz 8.0.1, FFmpeg 4.3.1) — jamais plus récentes, sans quoi
  on référencerait des fonctions absentes du binaire. Compiler avec `--systeme`.
- **Seul FreeType reste fermé** : aucun symbole `FT_` n'est exporté, donc rien ne peut s'y
  lier. Le reconstruire supposerait de refaire l'écosystème, ce qui est le rôle du dépôt
  amont `renpy-build`.

### La chaîne amont (POSIX seulement)

`./run.sh` compile les modules Cython/C puis lance Ren'Py ; `./run.sh --build` compile
seulement. Ces scripts supposent Linux/macOS et un venv `uv sync` (Python 3.12 strict) —
ils ne tournent pas tels quels sous Windows. `unittests/teststyles.py` référence
`renpy.styleaccel`, module disparu : c'est un vestige amont mort, pas une suite de tests
à faire passer. Le test d'intégration amont est le projet `testcases/`, joué en automatique
via la commande `auto` qu'il enregistre lui-même.

Formatage : ruff, `line-length = 120`, `format.preview = true` (voir `pyproject.toml`).

### Construire un paquet distribuable

`renpy.py <sdk>/launcher distribute <projet> --package pc --format zip` (exécuté avec le
`renpy.py` **du SDK**, pas celui du dépôt — `config.renpy_base` doit pointer vers une
installation qui a les libs de toutes les plateformes). `build.classify` dans `options.rpy`
doit exclure `game/nie/**` et `casting.json` : le `.gitignore` ne protège pas un paquet, sans
ces règles ils s'y retrouvent en clair.

Un `.bat` Windows en LF seul fait planter `cmd.exe` (commandes tronquées) — toujours vérifier
les fins de ligne CRLF.

## Architecture de `inazuma-love/`

Principe directeur, respecté partout : **aucune histoire ni aucun asset dans le code**.
Le narratif vit dans des JSON versionnés, les médias viennent d'ailleurs (CDN ou installation
locale du joueur), et l'absence de média dégrade proprement au lieu de planter.

### Ordre d'initialisation

Ren'Py exécute les blocs `init` par priorité croissante ; ici la chaîne est délibérée et
un module lit les données du précédent :

| Priorité | Fichier | Rôle |
|---|---|---|
| `-30` | `theme.rpy` | dict `AZ` (palette bleu/blanc/or), typographie Geist |
| `-25` | `reglages.rpy` | lit `game/reglages.json` **en accès disque direct**, pas `renpy.file` — le fichier est édité entre deux lancements et ne doit pas être servi depuis un cache d'archive |
| `-20` | `i18n.rpy` | `L()` libellés d'interface, `T()` résolution par hash, `texte_localise()` |
| `-15` | `cdn.rpy` | téléchargement + cache des illustrations |
| `-9` | `personnage.rpy` | profil du personnage joueur : accords, avatar, poste, porte d'âge |
| `-8/-7` | `otome.rpy` | casting, affection, médaillons |
| `-6` | `core.rpy` | chargement des scénarios, `label jouer_scenario` |
| `-5` | `nie_pont.rpy` | ce que le JEU fait des assets : médaillon, voix, musique, état |
| `-4` | `match.rpy` | mini-jeu de match |
| `-2/-1` | `gui.rpy`, `screens.rpy` | `init offset`, écrans standards Ren'Py adaptés |

Le greffon `game/libs/nie/` s'installe **avant** tout cela, de `-999` à `-996` : `game/libs/`
passe en priorité 0 au parsing (`renpy/script.py:397-419`), donc avant les fichiers du jeu.
Voir « Le greffon `nie` » plus bas.

Déplacer une priorité casse silencieusement une dépendance (p. ex. `cdn.rpy` lit
`reglages["largeur_illustrations"]` au moment de son `init`). À priorité égale, Ren'Py suit
l'ordre alphabétique des fichiers.

### Le contenu est de la donnée

- `game/scenario/*.json` — un fichier = un chapitre. Format documenté dans
  `game/scenario/SCHEMA.md`, gabarit vide dans `00-gabarit.json`. `core.rpy` les charge tous
  au démarrage (`charger_scenarios()` balaie `renpy.list_files()`), les trie par `ordre`, et
  `Scenario.valide()` signale les renvois cassés — affichés sous chaque chapitre dans l'écran
  « Choisir un chapitre ». C'est le seul mécanisme de validation du contenu : `lint` ne lit
  pas les JSON.
- `game/locales/{fr,en,ja}.json` — libellés d'interface, versionnés.
- `game/creation.json` — options de création du personnage joueur (genres, pronoms et mots
  d'accord, traits, origines, postes). `AGE_MINIMUM = 21` vit dans `personnage.rpy`, **pas
  ici** : le curseur ne descend jamais sous ce plancher, quoi que propose le JSON.
- `game/reglages.json` — les quelques choix d'équipe (illustration de titre sur le CDN,
  largeur, langue par défaut). Ne contient que des références, jamais de média.

Tout champ de texte accepte une chaîne **ou** un objet `{"fr":…, "en":…, "ja":…}` ;
`texte_localise()` retombe sur le français puis sur la première langue présente. Une réplique
non traduite s'affiche, elle ne bloque jamais.

`label jouer_scenario` interprète les scènes dans une boucle `while` : décor → musique →
lignes → match optionnel → choix ou `suite`. Ajouter une capacité au format de scénario se
fait dans cette boucle et dans `SCHEMA.md`, pas en écrivant des `label` Ren'Py.

**Piège vérifié** : `renpy.show(chemin)` sur un fichier tout juste téléchargé (CDN) ne
l'affiche pas — Ren'Py ne résout les noms d'image auto-déclarés qu'au scan de démarrage,
`renpy.loader.index_archives()` rend le fichier trouvable mais ne le déclare pas comme image.
Toujours passer par `Image(chemin)` explicite (voir `nom_de_fond` dans `core.rpy`).

**Piège vérifié** : le canal `voice` appartient au moteur. `voice_interact()`
(`renpy/common/00voice.rpy`, sur `config.start_interact_callbacks`) le coupe au démarrage de
chaque interaction si le système n'a pas été armé — un `renpy.sound.play(channel="voice")`
posé juste avant `renpy.say` est inaudible. Faire parler un rôle passe par `voice()` (voir
`parler` dans `otome.rpy`), un écran par `PlayCharacterVoice`.

**Piège vérifié** : les paramètres d'un `label` sont posés dans le store. `label
jouer_match(config)` y écrasait le `config` du moteur — le jeu mourait au premier match sur
`'dict' object has no attribute 'window_auto_hide'`. Ne jamais donner à un paramètre de label,
ni à une variable injectée dans le store depuis un JSON, un nom du moteur.

### Quatre sources de médias, toutes optionnelles

1. **VFS d'IEVR** (greffon `libs/nie/`) — l'installation du joueur, lue telle quelle : 255 308
   entrées adressables, textures transcodées à la volée. La plus riche et la plus rapide, et
   celle qui ne demande **aucune préparation**. Voir la section qui suit.
2. **CDN de l'association** (`cdn.rpy`) — un `"fond": "cdn:<chemin>"` est téléchargé une fois
   dans `game/nie/cdn/` puis relu depuis ce cache. Le CDN redimensionne et convertit à la
   volée (`?w=…&format=webp`) : on demande la largeur utile, jamais l'original.
3. **Catalogue local** (greffon `libs/nie/`) — voix, atlas d'expressions, musique, décors,
   produits sur la machine du joueur par `niers vn export --out <projet>/game/nie`
   (outil du dépôt *niers*, hors de ce dépôt). Le décodage de `catalogue.json` appartient à
   `niepy.Catalogue` (voir plus bas), pas au jeu. **Il reste la seule source de voix** :
   le VFS porte l'audio en ACB/AWB, que `nie_ffi` n'expose pas.
4. **Rien** — décors procéduraux, aucune voix, aucun médaillon. Le jeu doit rester jouable
   dans cet état ; c'est un invariant, pas une dégradation acceptée par défaut.

L'écran « Assets du jeu » (`screen assets_du_jeu`, dans `screens.rpy`) montre l'état des
sources en une page. Il n'affiche rien qu'il connaisse : il rend ce que lui donne
`etat_des_assets()` — ajouter une source l'y fait apparaître sans toucher aux écrans.

`niers vn export --casting <codes>` **écrase** `game/nie/catalogue.json`, il ne fusionne pas
avec un export précédent — toujours repasser la liste complète des codes déjà exportés, pas
seulement les nouveaux.

`game/.gitignore` interdit `nie/`, `casting.json`, `images/vfs/`, `audio/vfs/` : rien issu
d'une installation du jeu n'entre dans le dépôt. **`casting.json` existe donc en local mais
n'est pas versionné** — ne pas s'appuyer sur son contenu pour raisonner sur le code, et ne
jamais le committer. Son format de référence est documenté en tête de `otome.rpy`.

### Le greffon `nie` — IEVR dans le moteur, pour tout projet du fork

`game/libs/nie/` est une **bibliothèque Ren'Py** au sens que le moteur définit lui-même
(`sphinx/source/lifecycle.rst:26`, `renpy/script.py:397`, `renpy/main.py:353`). Elle donne à
n'importe quel projet de ce fork le VFS d'IEVR et ses 255 308 entrées, ses décodeurs, ses
textures, le catalogue d'assets exportés et la simulation de match. Son propre `LISEZMOI.md`
documente l'API complète ; ce qui suit est ce qu'il faut savoir avant d'y toucher.

**Pourquoi `game/libs/` et pas `renpy/`.** La demande initiale était « un greffon dans le
moteur ». Deux faits de code ont désigné un autre endroit :

1. **Ce qui est sous `renpy/` n'arrive pas chez le joueur.** `distribute.rpy:694` empaquette
   l'arbre moteur de `config.renpy_base`, celui du `renpy.py` qui a lancé la construction —
   et ce dépôt n'ayant pas de `lib/`, la construction se fait avec le `renpy.py` du SDK. Un
   `00nie.rpy` dans `renpy/common/` serait une divergence permanente ET invisible au joueur.
   `game/libs/**` part, lui, sous le motif final `("**", "all")` de `00build.rpy`.
2. **Ce qui est sous `renpy/` se paie à chaque merge.** Entre `HEAD` et `origin/master`,
   l'arbre `renpy/` bouge de 351 fichiers ; un merge à trois branches de `renpy.py` rend
   aujourd'hui UN conflit couvrant tout le fichier, amont l'ayant reformaté.

Le greffon n'a donc **aucune divergence amont**. Il reste déposable dans `game/libs/` d'un
autre projet, sur `RENPY_SEARCHPATH`, ou dans `renpy/common/` d'un fork qui accepte le coût.

**`game/libs/libs.txt` doit exister, et à CE chemin exact** : `renpy/script.py:397` teste
littéralement `loadable("libs/libs.txt")`. Un cran plus bas — dans `libs/nie/` — il ne serait
jamais vu, et les bibliothèques perdraient leur priorité 0 sans un mot d'avertissement.

**Ce que le greffon coûte à un projet qui ne s'en sert pas** : rien de mesurable. La détection
coûte ~11 µs ; le montage du VFS (0,6 à 1,0 s) et le chargement du catalogue n'ont lieu qu'au
**premier accès réel**. Le préchargement au démarrage est un choix de projet
(`define nie.precharger = True`, posé ici depuis `reglages.json`).

Les réglages sont dans le store `nie`, pas sur `config` : `_Config.__setattr__`
(`renpy/defaultstore.py:99`) refuse tout nom absent de `renpy/config.py`, et
`define config.x` passe par le même chemin (`000namespaces.rpy:172`). Un `config.nie_*`
exigerait de modifier le moteur.

#### `niepy`, vendorisé dans le greffon

`niepy` est la porte d'entrée Python du dépôt *nie* (`python/niepy`). Il n'utilise que la
bibliothèque standard — Ren'Py embarque son propre Python, où installer des roues tierces est
une source d'ennuis sans fin. Il vit dans `game/libs/nie/python-packages/`, et le greffon met
ce dossier au `sys.path` lui-même (`renpy.add_python_directory`, `renpy/importer.py:340`) :
la bibliothèque se déplace d'un bloc, sans que le projet d'accueil sache qu'elle contient du
Python.

```bash
python outils/synchroniser_niepy.py            # recopie depuis le dépôt nie
python outils/synchroniser_niepy.py --verifier # avant de committer : dit ce qui diverge
python outils/synchroniser_niepy.py --ffi      # dépose aussi nie_ffi.dll dans le greffon
```

Le dépôt *nie* est trouvé à l'exécution (`--depot`, `NIE_DEPOT`, sinon dépôt voisin) — aucun
chemin de machine n'est écrit nulle part. **Corriger un défaut de `niepy` se fait dans le
dépôt *nie*, jamais dans la copie**, sinon la prochaine synchronisation l'efface.

Deux niveaux de disponibilité, à ne pas confondre :

| | ce que c'est | présent chez le joueur ? |
|---|---|---|
| `nie.disponible` | le paquet Python | oui — versionné avec le jeu |
| `nie.natif` | la bibliothèque `nie_ffi` | non — elle vient d'un `cargo build` du dépôt *nie* |

Tout ce qui touche au VFS, aux formats ou au match teste `nie.natif` d'abord. Sans elle le jeu
tourne : le match retombe sur son tour par tour, et rien ne lève.

#### Vérifier le greffon — `lint` n'est PAS une barrière

```bash
"$SDK/lib/py3-windows-x86_64/python.exe" renpy.py inazuma-love nie-verifier
```

Dix contrôles exercés dans un vrai Ren'Py, sans écran, avec un **vrai code de sortie** (1 sur
échec — vérifié). Chaque contrôle rend `OK`, `ABSENT` (état normal : pas de `nie_ffi`, pas
d'installation, pas d'export — n'échoue pas) ou `CASSÉ`.

Cette commande existe parce que **`lint` rend 0 même quand un `init python:` lève**. Le lint
reste utile — il exécute les blocs d'init, donc il montre la trace — mais son code de sortie
ne dit rien. Et il n'a pas de profil joueur : ce qui lit `store.joueuse` (donc `equipe_joueur`)
n'y est pas exerçable.

#### Le VFS, servi comme un displayable et non comme un fichier

```renpy
image portrait = "nie:data/dx11/menu/200_icon/10_icon_chr/face/c01000010_l.g4tx"
image visage   = "nie:c01000010"          # raccourci : l'icône de menu du personnage
```

`config.displayable_prefix` (`renpy/config.py:960`) est consulté par `renpy.easy.displayable`
(`easy.py:119`) **avant** le repli sur `Image`, et par `dynamic_image` (`:167`). Une texture
n'est pas un fichier, c'est un displayable : c'est le bon registre, et il est documenté.

Le greffon **ne confisque aucun crochet**. `config.file_open_callback` et
`config.loadable_callback` sont mono-valeur (`config.py:389`, `:888`) ; les prendre
interdirait au projet d'accueil d'avoir les siens. On s'ajoute donc à
`renpy.loader.file_open_callbacks`, qui est une **liste** (`loader.py:521`) dont le crochet
mono-valeur n'est que la première entrée (`:550`), et on chaîne `loadable_callback`.

Chiffres mesurés sur l'installation de référence, à refaire avant de toucher au module :

| | |
|---|---|
| montage + index complet | 0,56 à 1,1 s pour 255 308 entrées |
| test de présence | `nie_vfs_is_readable` — sans lire le contenu |
| transcodage d'une icône | ~17 à 26 ms ; d'une grande texture, jusqu'à 2 s |
| icônes de personnage | **5 685**, contre une trentaine dans un export |

**Le plafond mémoire n'est pas une option.** Le défaut de la bibliothèque native est de
**16 Gio**, dimensionné pour un traitement par lots. Mesuré sous ce défaut : soixante lectures
de textures dispersées retiennent **4 941 351 152 octets** (4,9 Go) sur 39 paquets gardés.
Avec 128 Mio, les mêmes lectures retiennent 408 Mo et une entrée. `nie.budget_cache` vaut
192 Mio par défaut et `monter()` l'applique systématiquement.

**Le cache ne s'écrit jamais sous `game/`.** Le motif final de `00build.rpy` est
`("**", "all")` : tout ce qu'un projet écrit sous `game/` part dans son zip, et l'en exclure
demande un `build.classify(…, None)` que `build.clear()` efface à n'importe quelle priorité.
Le cache vit sous `config.savedir`, et `_dossier_cache()` **lève** si le chemin résolu tombe
sous `config.gamedir` : distribuer un asset d'IEVR cesse d'être interdit pour devenir
impossible. Le nom du cache porte le CRC du chemin complet — dans ce VFS, deux textures de
même nom dans deux dossiers différents sont la règle.

**Emplacements mesurés, pas devinés.** Les icônes de menu vivent sous
`data/dx11/menu/200_icon/10_icon_chr/face/<code>_l.g4tx` — *pas* sous `chr/_face/`, qui ne
porte que des textures de modèle et aucun `_l.g4tx`. Une illustration servie par le CDN sous
`dx11/menu/…/img.png` a sa source dans le VFS sous `data/dx11/menu/…/img.g4tx`
(`nie.nom_illustration()` fait la transposition).

**Ce que le greffon ne sait pas faire** : l'audio. Le VFS porte les voix et la musique en
ACB/AWB, et `nie_ffi` n'expose aucun décodeur audio. Le code existe pourtant côté Rust
(`nie_formats::cri_audio::decode_to_wav`, HCA chiffré IEVR / ADX / AWB / ACB) : il ne manque
qu'une feature et un symbole — avec la réserve que les ACB de voix d'IEVR n'ont pas d'AWB
embarqué et exigent la résolution du frère `.awb` dans le VFS. Les voix restent donc servies
par le catalogue exporté, qui les convertit en WAV en amont.

### Le match tranché par le moteur natif

Une scène demande `"moteur": "natif"` dans son bloc `match` : la rencontre est calculée d'un
bloc, sans écran ni choix, puis racontée but par but. C'est fait pour les matchs que le
personnage joueur ne dispute pas. Le tour par tour reste le mini-jeu jouable ; les deux posent
`resultat_match` et `score_match` à l'identique.

**Deux moteurs, deux besoins — ne pas les confondre.**

`nie.arene()` (`niepy.Match`, `nie_world_*`) fait TOURNER un match jouable, avancé pas à pas.
Il n'accepte **aucune graine** et son onze est le sien : rien n'y distingue nos joueurs des
siens. Il est inutilisable pour la narration, et c'est mesuré, pas supposé.

`nie.simuler()` (`nie_core::match_sim::simulate_match`) tranche une rencontre à partir des
**statistiques** et d'une **graine** : un modèle minute par minute où la probabilité de but de
chaque camp sort du rapport entre son `kc` (tir) et le `ps` (pressing) de l'autre. Mesuré :

| | |
|---|---|
| fort contre faible | **+1,30** de différentiel moyen |
| forces égales | **−0,22** |
| même graine, deux appels | résultat identique |
| variété | 15 scores distincts sur 20 graines (l'ancien moteur : un seul) |

Ce moteur n'avait **aucun symbole C** : il a été exposé pour ce greffon
(`nie_match_simulate_json_out` dans `crates/engine/nie-ffi`), et `niepy.simuler_match`
l'emballe. La version précédente pilotait `nie_world_*` en lui injectant un contrôleur
aléatoire pendant une part du temps calibrée sur l'écart de force — cela marchait, mais la
force ne touchait jamais la simulation, elle réglait la quantité de bruit qu'on lui envoyait.

`match.rpy` ne fait plus que traduire un onze du jeu en statistiques IEVR (`ECHELLE_STATS`) ;
tout le calcul appartient au greffon. Le handle natif ne sort jamais de `niepy`, et le store
`nie` est `_constant` : rien de non-picklable n'atteint une sauvegarde.

**Pièges du greffon, tous vérifiés en exécution** :

- **`dict` n'est pas `dict` dans un store.** `renpy/minstore.py:45` fait
  `dict = RevertableDict`, y compris dans un store nommé. Un `isinstance(x, dict)` sur une
  donnée venue du dehors — du JSON rendu par la couche native — est **faux**, et le filtre
  ne garde rien, en silence. Employer `collections.abc.Mapping` (le projet le faisait déjà
  dans `core.rpy`).
- **Un store nommé n'hérite que de `minstore`.** Ni `config`, ni `Image`, ni `Null` n'y sont ;
  `renpy` y vaut `renpy.exports`, donc `renpy.config` et `renpy.windows` n'existent pas.
  L'idiome amont est `from store import config, renpy, …` (`renpy/common/00achievement.rpy:28`).
- **Un `.rpyc` orphelin continue de s'exécuter.** Retirer un `.rpy` ne suffit pas ; seul
  `renpy.py <projet> compile` nettoie (`renpy/script.py:174`).
- **`niepy._ffi` déclare tous les symboles d'un bloc.** Une DLL en retard d'un commit fait
  donc tomber tout le pont, pas seulement la capacité manquante — c'est arrivé : la DLL
  déployée avait 41 exports contre 44 aux sources. Le contrôle « symboles requis » de
  `nie-verifier` nomme ce dont le greffon dépend pour que le message accuse le bon fichier.

### Casting et rôles

Les scénarios désignent les personnages par un `id` de rôle abstrait (`"qui": "attaquant"`),
jamais par un nom. La résolution suit trois niveaux : `casting.json` → personnages du
catalogue local → rien. Le `code` d'un rôle (p. ex. `c01000010`) est le code interne IEVR
qui porte la voix et l'atlas d'expressions ; il peut manquer, le rôle est alors muet et
sans visage.

## Terminologie

Le fork touche à Inazuma Eleven Victory Road : codes de personnages, chemins CDN, noms de
formats. Ces identifiants sont vérifiables et ne doivent pas être devinés — les skills
`niers:ievr-terminologie` et `niers:formats-level5` sont là pour ça.
