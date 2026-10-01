---
name: aphrody-cmd-re-forensics
description: "Commandes reverse engineering, forensics et analyse repo de la CLI aphrody (re triage/strings/sections/disasm/go/auto/yara, forensics, scan, texte libre auto) : sous-commandes, features, sécurité. Utiliser pour trier un binaire ou cartographier une base."
version: "1.1.0"
metadata:
  source: aphrody native — apps/cli/src/lib.rs (ReAction, ScanAction), apps/cli/src/{re_auto,forensics_cmd,auto_command}.rs, crates/os/re
  since: "2026-05-23"
---

# aphrody — commandes reverse engineering / forensics / analyse

> **S'applique quand :** le binaire `aphrody` est installé (`aphrody --version`), idéalement depuis le monorepo Aphrody (`apps/cli`, moteur `crates/os/re`) ; les commandes marquées *(feature)* n'existent que dans un build compilé avec cette feature. **Sinon :** utiliser les outils MCP `re_triage`, `re_strings`, `re_sections`, `re_disasm` si le serveur `aphrody-kernel` est connecté, à défaut `objdump`/`readelf`/`strings`/`rizin`, et dire quelle passe Aphrody n'a pas été exécutée.

Cross-platform (Linux #1, Windows, macOS) ; pur Rust, aucune dépendance GPL côté passes natives. Vérité de référence : `aphrody <cmd> --help`.

## Reverse engineering

- **`aphrody re triage <bin> [--pretty]`** — format (PE32/PE64/ELF32/ELF64), arch, sections + entropie Shannon par section, imports/exports, échantillon strings ASCII/UTF-16LE, empreinte SHA-256. Détection via magic bytes (goblin).
- **`aphrody re strings <bin> [--min-len N] [--limit N] [--pretty]`** — extraction strings ASCII/UTF-16LE (défauts : longueur 6, 64 résultats).
- **`aphrody re sections <bin> [--pretty]`** — table des sections + entropie.
- **`aphrody re disasm <bin> [--rip ADDR] [--limit N] [--pretty]`** — désassemblage x86-64 (iced-x86) depuis l'offset 0, `--rip` fixe l'adresse virtuelle affichée.
- **`aphrody re go <bin> [--deep] [--pretty]`** — binaire Go : version, table des fonctions, packages. `--deep` délègue aussi à `redress` (résolu via `$REDRESS_BIN` > PATH > `$GOPATH/bin` > `~/go/bin`).
- **`aphrody re auto <bin|dir> [--deep] [--json] [--limit N]`** — orchestre les passes en un appel : triage + strings + extraction endpoints Google + détection Go + désassemblage entrypoint ; sur un dossier, analyse récursive des exécutables PE/ELF avec concurrence 4. `--deep` appelle aussi Ghidra headless (`$GHIDRA_INSTALL_DIR` ou `$GHIDRA_HOME`, opt-in, lent). Ex. : `aphrody re auto language_server.exe --json | jq '.go.func_count'`. Gotcha : sur des builds Go 1.27 google3/blaze, `func_count = 0` en natif ⇒ relancer avec `--deep`.
- **`aphrody re yara --rules <fichier.yar> <bin>`** *(feature `yara`)* — règles YARA-X en pur Rust ; sans la feature, la commande échoue avec l'instruction de recompilation.
- **`aphrody re classify <path>`** *(feature `magika`)* — classification de type de fichier par Google Magika (lie ONNX Runtime).
- `aphrody re google <bin>` analyse un binaire Google (Electron / Chromium / Go / Node / V8 snapshot).

Pour la décompilation (Ghidra), enchaîner avec le skill `deep-analysis`.

## Forensics

- **`aphrody forensics <map|sqlite>`** *(feature `forensics`)* — extraction forensique reproductible. `map --target <dir> --out <dir>` écrit `map.json` (chemin, taille, extension : les contenus ne sont jamais ouverts). `sqlite --db <fichier>` dump le schéma. **SÉCURITÉ** : mappe/classe/dump le schéma UNIQUEMENT — ne lit ni n'imprime JAMAIS de valeurs secrètes (tokens, cookies, lignes `secret://`) ; les bases s'ouvrent en lecture seule et seul `sqlite_master` (noms + CREATE) est lu. Ex. : `… sqlite --db state.vscdb | jq '.tables[].name'`.

## Analyse repo

- **`aphrody scan tree [--root D] [--groups a,b] [-o fichier|-] [--top-ext N]`** — taille et nombre de fichiers par groupe de dossiers de premier niveau.
- **`aphrody scan manifests [--root D] [-o fichier]`** — parcourt `Cargo.toml` / `package.json` / `pyproject.toml` et émet nom, version, nombre de dépendances, membres de workspace.
- **`aphrody <texte libre ou commande inconnue>`** — fallback implicite (`Commands::Auto`, pas une sous-commande `auto`) : un prompt en langage naturel part vers le client A2A JSON-RPC (`$APHRODY_A2A_ENDPOINT`, défaut `http://localhost:8788`) ; un jeton qui ressemble à une commande (nom de moteur connu, sous-commande standard, fichier script) part au dispatcher bun/uv/cargo. Une commande réservée à une feature absente répond « requires --features <feature> ».

## Garde-fous

- Forensics : jamais d'exfiltration de valeurs secrètes ; lecture seule stricte.
- Features `forensics`, `yara`, `magika` host-only (absentes du build par défaut et du wasm).
