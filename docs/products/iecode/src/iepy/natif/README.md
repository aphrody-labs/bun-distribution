# `natif/` — compiler du Cython/C pour ce Ren'Py, sous Windows

Le CLAUDE.md a longtemps dit : *« Pas de build local du moteur sur cette machine »*.
C'était vrai de la chaîne amont — `setup.py` réclame `pkg-config`, MinGW et une
douzaine de bibliothèques système, `module/build_win32.sh` suppose un shell POSIX.
Ce dossier ouvre un autre chemin, mesuré et vérifié de bout en bout :

```
Cython (venv uv) → .c → clang-cl → .obj → lld-link → .pyd → python du SDK
```

Résultat : `renpy/display/matrix.pyx` a été recompilé depuis les sources de ce
dépôt, substitué à son built-in, et `renpy/display/render` — resté dans
`librenpython.dll` — s'en sert sans le savoir.

## Les trois faits qui rendent cela possible

**1. Il n'y a aucun `.pyd` à remplacer.** Les 63 modules natifs de Ren'Py
(`renpy.display.render`, `renpy.display.matrix`, `renpy.gl2.*`,
`renpy.audio.renpysound`…) sont liés dans `librenpython.dll` et enregistrés comme
modules *built-in*, sous leur nom pointé. `BuiltinImporter` passant avant
`PathFinder`, poser un fichier quelque part ne servirait à rien : il faut un
`MetaPathFinder` en tête de `sys.meta_path` (voir `surcharge.py`).

**2. Le python du SDK est un build MinGW/UCRT/LLVM**, sans en-têtes, sans
`sysconfig`, sans bibliothèque d'importation — son suffixe d'extension le dit :
`.cp312-mingw_x86_64_ucrt_llvm.pyd`. On génère donc la bibliothèque d'importation
depuis les **1 779 symboles** exportés par `libpython3.12.dll`, et on emprunte les
en-têtes à un CPython 3.12 installé par `uv` : l'ABI de CPython est stable au sein
d'une série mineure, des en-têtes 3.12.13 conviennent à un runtime 3.12.7.

**3. Un `.pyd` d'ABI MSVC se charge dans ce python MinGW.** Vérifié, allocateur
compris (`natif/test_abi.c` fait un `PyMem_Malloc`/`PyMem_Free` de part et d'autre
de la frontière). C'est ce qui autorise `clang-cl` plutôt qu'un MinGW complet
qu'il faudrait installer.

## Mise en place

Une seule fois :

```bash
uv venv --python 3.12 natif/.venv-build
uv pip install --python natif/.venv-build cython
natif/.venv-build/Scripts/python.exe natif/construire.py --verifier
```

`--verifier` affiche ce qu'il a trouvé et ce qui manque. Rien n'est écrit en dur :
le SDK vient de `RENPY_SDK` ou du voisinage, LLVM de `LLVM_BIN` ou du `PATH`, les
en-têtes de `PYTHON_INCLUDE` ou des CPython d'`uv`.

## Compiler

```bash
# un module Cython du moteur
natif/.venv-build/Scripts/python.exe natif/construire.py \
    renpy/display/matrix.pyx --nom renpy.display.matrix

# un module C à soi
natif/.venv-build/Scripts/python.exe natif/construire.py natif/test_abi.c
```

Le `.pyd` atterrit dans `natif/build/`. **Le nom de module compte** : CPython
cherche `PyInit_<dernier segment>`, donc un module destiné à
`renpy.display.matrix` doit être cythonisé sous ce nom complet et produire
`matrix.pyd`. `construire.py` s'en charge.

## Activer une surcharge

Copier `modules.exemple.json` en `modules.json` :

```json
{
  "renpy.display.matrix": "build/matrix.pyd"
}
```

`renpy.py` appelle `surcharge.installer()` juste avant `import renpy.bootstrap`.
**Sans `modules.json`, rien ne se passe** : le comportement amont est conservé à
l'octet près. Deux variables d'environnement :

| | |
|---|---|
| `RENPY_NATIF_VERBEUX=1` | dit ce qui est surchargé au démarrage |
| `RENPY_SANS_NATIF=1` | désactive tout, sans toucher au manifeste |

La seconde est l'outil de diagnostic : si un défaut disparaît avec, il vient d'un
module recompilé.

## Vérifier qu'une surcharge est bien en place

```python
import renpy.display.matrix as m
m.__file__          # un chemin .pyd → surchargé ; AttributeError → built-in
```

## Les bibliothèques système : SDL2, HarfBuzz, FFmpeg

`librenpython.dll` a absorbé SDL2, FFmpeg, HarfBuzz, fribidi et pygame_sdl2 — et,
c'est le point décisif, **elle en réexporte les symboles** : 2 020 pour SDL2, 457
pour HarfBuzz, 698 pour FFmpeg, 26 pour fribidi. Une seule bibliothèque
d'importation (`librenpython.lib`, **12 373 symboles**) suffit donc à lier du code
contre n'importe laquelle d'entre elles.

Il ne manquait que les en-têtes :

```bash
natif/.venv-build/Scripts/python.exe natif/construire.py --deps
```

Les versions ne sont pas au choix : ce sont celles que la DLL rapporte quand on
l'interroge (`SDL_GetVersion`, `hb_version_string`, `av_version_info`), soit
**SDL2 2.0.20, HarfBuzz 8.0.1, FFmpeg 4.3.1**. Des en-têtes plus récents
décriraient des fonctions absentes de ce binaire. Seuls les en-têtes servent :
le code objet est déjà dans la DLL, rien n'est compilé depuis ces sources.
`natif/deps/` pèse ~311 Mo et n'est pas versionné.

Ensuite, `--systeme` ajoute ces en-têtes et lie contre `librenpython.lib` :

```bash
natif/.venv-build/Scripts/python.exe natif/construire.py natif/test_systeme.c --systeme
```

`test_systeme.c` est la sonde qui l'établit : il rend les mêmes versions que la
DLL et crée un vrai `hb_buffer_t` — une version peut venir d'un bouchon, une
allocation non.

Deux détails :

- `libavutil/avconfig.h` est produit par `configure` et absent du tarball ;
  `--deps` l'écrit (deux `#define`, sans effet sur l'ABI).
- Le tarball HarfBuzz contient un lien symbolique que `tar` refuse de créer sous
  Windows : on n'extrait que `src/`.

## `sonde_nie_exe.py` — peut-on appeler `nie.exe` depuis CPython ?

Question posée, mesurée, tranchée. `LoadLibrary` **accepte** `nie.exe` : Windows
mappe l'image et résout ses imports (Steam, EOS, D3D11, libcurl), et les
relocations sont correctes — un accesseur `get_ptr_1422af9c0` rend exactement
l'adresse relogée attendue.

Mais le point d'entrée n'est **pas** exécuté : ni CRT, ni constructeurs statiques,
ni globales. Mesuré sur 300 fonctions feuilles, sans accès donnée, non virtuelles :

| taille de la fonction | appels revenus |
|---|---|
| 8 octets (accesseurs triviaux) | 100 % (233/233) |
| 9 – 32 octets | 12 % |
| 33 – 128 octets | 6 % |
| plus de 128 octets | **0 %** |

Les 233 succès ne calculent rien : ce sont des `lea rax, [X] ; ret`. Dès qu'une
fonction fait un travail réel, elle touche l'état non initialisé et lève une
violation d'accès — rattrapée par ctypes en `OSError`, donc la sonde ne tue pas
son processus, mais rien d'utile n'en sort.

**Conclusion : le chargement direct n'est pas une voie de portage.** Il reste un
bon outil d'inspection (l'image est valide et relogée), pas d'exécution.

    python natif/sonde_nie_exe.py --preparer
    python natif/sonde_nie_exe.py

## Ce qui reste hors de portée

**FreeType.** Aucun symbole `FT_` n'est exporté par `librenpython.dll` : un module
qui en dépend ne peut pas être lié, quels que soient les en-têtes dont on dispose.
C'est la seule des bibliothèques d'origine à rester fermée.

Ce qui est atteignable : tout module Cython **autonome**, tout module qui s'appuie
sur **SDL2, HarfBuzz ou FFmpeg**, et tout module C ou Cython **nouveau** écrit pour
ce fork.

## Pièges rencontrés

- **Git Bash convertit les arguments en `/`** (`/DLL` devient un chemin). Poser
  `MSYS_NO_PATHCONV=1`, ou utiliser les formes en tiret (`-dll`, `-out:`).
- **`sys.modules[nom] = module` ne suffit pas.** L'attribut n'est pas posé sur le
  paquet parent, et Ren'Py meurt plus loin sur
  `AttributeError: module 'renpy.display' has no attribute 'matrix'`, depuis
  `render.pyx` qui lit `renpy.display.matrix.IDENTITY`. D'où le `MetaPathFinder`.
- **`pyconfig.h` contient `#pragma comment(lib, "python312.lib")`** : la
  bibliothèque d'importation doit porter exactement ce nom, même si la DLL visée
  s'appelle `libpython3.12.dll`.
