# CLI Rust canonique

Le catalogue [`tools/config/cli-catalog.json`](../../../../tools/aphrody/config/cli-catalog.json) définit
un seul outil par capacité. Les commandes sont consommées depuis
`aphrody-shell` et, pour les capacités OS autoritaires, enregistrées par
`aphrody-kernel`.

Sélection par défaut : `rg` recherche, `fd` découverte, `eza` listing, `bat`
aperçu, `sd` réécriture, `dust` stockage, `procs` processus, `bottom`
ressources, `gh` GitHub, `curl` transfert et `aphrody` orchestration agent/OS.
`gitui` reste optionnel pour l’interface Git.

Les outils historiques (`grep`, `find`, `cat`, `du`, `ps`, `top`, `npm`, `npx`,
`node`) ne doivent pas être introduits dans les scripts applicatifs. `systemctl`
reste réservé au superviseur hôte, `ssh` au transport et PowerShell au
bootstrap Windows.
