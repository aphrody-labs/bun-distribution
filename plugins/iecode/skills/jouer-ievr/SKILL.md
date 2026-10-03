---
name: jouer-ievr
description: "Run and play Inazuma Eleven Victory Road from the IECODE workspace: launch nie.exe (game_launch), simulate a match (aphrody-nie-headless/-runtime/-play), render assets (aphrody-nie-game), inspect memory (nie mem). Use to run or reproduce IEVR behaviour."
---

# Jouer à IEVR depuis IECODE

> **S'applique quand :** le dépôt IECODE (sa racine contient un dossier `iecode:crates/nie`) est le répertoire de travail et que l'installation du jeu est accessible (`NIE_GAME_DIR`) ; les chemins préfixés `iecode:` sont relatifs à cette racine.
> **Sinon :** ne pas simuler ni prétendre avoir lancé le jeu ; dire ce qui manque (dépôt, installation, `nie.exe`) et proposer la commande à lancer là où ils existent.

Il y a **deux jeux** à distinguer, et il faut choisir lequel on veut faire tourner.

1. **`nie.exe`** — le vrai jeu Level-5, non versionné : `game_launch` le cherche via `NIE_GAME_EXE`
   sinon `nie.exe` à la racine du dépôt (`NIE_REPO`). On peut le **lancer** et l'**observer**.
2. **Le moteur nie** — une simulation Rust déterministe et scriptable, jouable de bout en bout
   sans le jeu original. C'est là qu'on « joue » de façon reproductible.

## Ce qui est possible aujourd'hui, et ce qui ne l'est pas

| Action | Disponible | Comment |
|---|---|---|
| Lancer le vrai jeu | oui | outil MCP `game_launch` du serveur `aphrody-nie-mcp` (process détaché, rend le PID) |
| Observer le jeu qui tourne | oui | `nie mem` (s'attache à un process existant, ne le lance ni ne le stoppe) ; binaire `nie-mem` : régions, lecture, scan |
| Écrire dans la mémoire du jeu | **seulement par les outils d'édition dédiés** | `nie-mem`/`nie-edit` (`iecode:crates/nie/aphrody-nie-trace`) savent écrire ; ne le faire que sur demande explicite, jamais par défaut |
| Envoyer des entrées clavier/manette à `nie.exe` | **non, pas dans les crates NIE** | `aphrody-nie-computer-use` ne fait que sonder ; la mutation d'UI passe par l'hôte WinClean/Computer Use (skill `winclean`, Windows) |
| Simuler un match complet | oui | `aphrody-nie-headless match`, `aphrody-nie-runtime`, `aphrody-nie-play` |
| Rendre les vrais assets | oui | `aphrody-nie-game` (wgpu, fenêtre ou capture PNG) |
| Piloter l'explorateur | si un client Inacord est connecté au pont | outils MCP `explorer_navigate`, `explorer_open`, `explorer_tab`, `explorer_toast` |

**Ne pas prétendre piloter `nie.exe`.** Une demande de « jouer comme un humain » au vrai binaire
supposerait capture d'écran plus entrées synthétiques : aucune chaîne de ce type n'est dans les
crates NIE. Le dire, puis proposer la voie moteur, qui est reproductible et scriptable.

## Simuler un match

Binaires construits depuis les packages `aphrody-nie-*` (`target/<profil>/<binaire>` ou
`cargo run -p <package> -- …`) ; `--help` de chacun fait foi.

```bash
# Résumé JSON déterministe, sans rendu
aphrody-nie-headless match

# Match simulé + rendu vidéo (headless)
aphrody-nie-runtime --frames 600 --fps 60 --out match.mp4
aphrody-nie-runtime --no-video --out frame.png     # dernière frame seulement

# Match avec de vraies données de personnages et la police du jeu
aphrody-nie-play \
  --font-cfg <font.cfg.bin> --font-g4tx <font.g4tx> \
  --seed 12345 --chara-param <chara_param_*.cfg.bin.json>
```

Le moteur est **déterministe** : même graine, même résultat. C'est ce qui rend une régression
détectable — comparer deux exécutions, pas deux impressions.

## Rendre les vrais assets

```bash
aphrody-nie-game --window                    # fenêtre wgpu
aphrody-nie-game --capture out.png           # rendu hors-écran
aphrody-nie-game --g4tx <chemin VFS .g4tx>   # texture précise
```

Le dossier du jeu se résout avec `--game-dir`, sinon `NIE_GAME_DIR`, sinon le répertoire courant
ou l'un de ses ancêtres portant `data/cpk_list.cfg.bin` : c'est la racine du jeu, pas `data/`.

## Observer le vrai jeu

`nie mem` (lecture) et les binaires `nie-mem` / `nie-edit` de `aphrody-nie-trace` s'attachent à un
`nie.exe` en cours : recherche du process, régions du module, lecture d'octets, scan, dump. Le
backend dépend de la plateforme (Windows natif ou Linux/Wine). Enchaînement utile :
`game_launch` pour démarrer, puis `nie mem --help` pour s'y raccrocher et lire les régions.

## Piloter l'explorateur pendant une session

Le serveur MCP `aphrody-nie-mcp` (aussi `nie mcp`) expose `explorer_navigate` (dossier VFS),
`explorer_open` (fichier), `explorer_tab`, `explorer_toast`, qui passent par un pont loopback vers
une page Inacord. Cette page n'est pas dans l'arbre IECODE actuel : `explorer_status` dit si un
client est connecté — l'appeler avant de conclure qu'une commande a échoué.

## Honnêteté sur les résultats

Un match simulé n'est pas une partie du vrai jeu : la physique PhysX exacte et la résolution de
but event-driven de IEVR sont des pistes séparées. Dire « le moteur nie donne X » et non « le
jeu donne X », sauf si l'écart a été mesuré contre le binaire.
