# Monitoring infrastructure

Le contrôle RG importé depuis le commit `ebe47f58` est piloté par le script
unique `aphrody-infra/scripts/infra-status.ts`. Aucun autre dépôt ne duplique cette
implémentation : ses scripts Bun transmettent les commandes au dépôt Aphrody.

```bash
bun run infra:status
bun run infra:status:json
bun run infra:inventory
aphrody-infra validate
```

`infra:inventory` active l'inventaire profond borné par le script. Le timer
`rg-infra-monitor.timer` reste une unité déclarative dans `systemd/` ; il a été
retiré du VPS lors de la remise à zéro du 2026-09-22 et n'y revient que via le
catalogue et `aphrody-infra deploy`. Pour l'état des hôtes sans dépendre du
monitor : `aphrody-infra status` et `aphrody-infra dev-env --target <id>`.

## Règles de déduplication du catalogue

Reprises de l'ancien `rg/docs/infra/orchestration.md` (le manifeste `rg/infra/stack.json`
a été absorbé par `config/service-catalog.json` et `inventory/`) :

- un composant possède un `id` unique et un propriétaire explicite ;
- un port ne peut pas être partagé par deux composants actifs ;
- les slots standby et services retired sont déclarés mais exclus du contrôle de
  collision et ne doivent pas être démarrés ;
- les fichiers effectifs systemd/Nginx/sysctl/logrotate sont comparés à leurs
  sources versionnées dans ce dépôt ;
- les sauvegardes Nginx `.bak*` ne sont pas chargées et ne comptent pas comme vhosts actifs.
