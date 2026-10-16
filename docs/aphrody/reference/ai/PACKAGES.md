# Gestionnaire des CLI Aphrody

Il n'y a qu'un binaire : `aphrody`. `bxc` (Bun x Chrome), `bxc-mcp`, `n2b` (Node 2 Bun) et chaque
ancien binaire (`aphrody-infra`, `aphrody-kernel`, ...) sont des noms de ce binaire : des liens créés par
`aphrody self install-path` et résolus à l'invocation (multi-call, `crates/infra/aphrody-command/src/multicall.rs`).
`aphrody package` ne clone, ne construit et ne met rien à jour : il rapporte et répare ces liens.
Décisions et table de parité de `bxc` :
bxc-n2b-unification-2026-10-05.

```bash
aphrody package catalog
aphrody package status --json
aphrody package doctor
aphrody package install --dry-run
aphrody package install
aphrody package uninstall --dry-run
aphrody package uninstall --yes
```

| Sous-commande | Effet |
|---|---|
| `catalog` | le binaire unique, les noms qu'il remplace (`compat` : `bxc`, `bxc-mcp`, `n2b` ; `alias` : les autres) et les outils gérés ailleurs |
| `status` | le binaire en cours et l'état de chaque lien : `ok` (même fichier), `absent`, `pendant` (cible disparue), `étranger` (autre fichier, par exemple l'ancien script `bxc`) |
| `doctor` | binaire, répertoire des liens (`.local/bin` sur Unix, dossier du binaire sur Windows), PATH, état hérité `~/.bxc` ; code 1 si un lien n'est pas sain |
| `install` | lie `aphrody` et chaque ancien nom au binaire en cours (`--bin` pour un autre) : équivalent de `aphrody self install-path` |
| `uninstall` | retire les liens qui pointent vers le binaire (ou pendants vers un `aphrody` disparu) ; un fichier étranger n'est jamais retiré, le binaire non plus ; `--dry-run` d'abord, `--yes` pour appliquer |

Anciennes formes acceptées : `aphrody package install|status|uninstall bxc|n2b|aphrody|all` désignent des liens
(`bxc` : `bxc` et `bxc-mcp` ; `n2b` : `n2b` ; `aphrody` et `all` : tous). `update` est retiré : installer
le nouveau binaire (fabrique : `bun scripts/build/rust/build-factory.ts run --install`) puis
`aphrody package install` re-pointe les liens. `nie` n'est pas un paquet d'Aphrody : le CLI `niers` d'IECODE est
géré dans son dépôt, `aphrody nie` le relaie et `status` le signale ; il n'est jamais installé ni retiré ici.

Les sources gérées de l'ancien gestionnaire (`.local/share/aphrody/sources` sur Unix,
`LocalAppData/Aphrody/sources` sur Windows) ne sont plus créées ni lues ; s'il en reste, les sauvegarder avant de
les supprimer à la main.
