---
title: Outils et routage
---

- Lire les instructions du dépôt courant avant toute édition.
- Utiliser `rg`, `fd`, `git`, `cargo`, `bun`, `uv`, `pwsh`, `ssh` selon la
  surface réelle ; préférer l'outil dédié à une commande générique.
- Utiliser le MCP `aphrody-mcp` pour les outils Aphrody OS.
- Exécuter les commandes lentes en parallèle quand les familles sont étanches.
- Nettoyer les artefacts temporaires ; ne jamais versionner `target/`, caches,
  secrets ou journaux de session.
- Vérifier les chemins et les binaires avec `Get-Command`, `git status` et les
  commandes `--version`/`--help` avant de conclure.
