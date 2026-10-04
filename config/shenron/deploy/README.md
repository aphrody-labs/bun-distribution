# deploy/ — délégué à `aphrody-infra`

L'exploitation de Shenron (unités systemd, vhosts Nginx, releases, bascule,
backups, timers, rétention) est portée par le dépôt frère `aphrody-infra` :

- catalogue des services et unités : `aphrody-infra/config/service-catalog.json`,
  `aphrody-infra/systemd/shenron-*.{service,timer}` ;
- routes publiques : `aphrody-infra/config/nginx-routes.json`,
  gabarits `aphrody-infra/nginx/*dragonballfr.com.conf.example` ;
- backups : `aphrody-infra/scripts/ops/backup-shenron-{pg,sqlite}.sh` ;
- topologie et hôtes : `aphrody-infra/docs/SHENRON-MIGRATION.md`,
  `aphrody-infra/docs/PRODUCTION-ALLOCATION.md`.

Aucune adresse, aucun hôte ni port de production n'est décrit ici : les lire
dans le catalogue `aphrody-infra`. Frontière et historique des suppressions :
[`../docs/INFRA-DELEGATION.md`](../docs/INFRA-DELEGATION.md).

## Contenu restant

| Chemin | Rôle | Statut |
| --- | --- | --- |
| `deploy/privoxy/shenron-media.conf` | Configuration Privoxy installée en `/etc/privoxy/config`. | Idem. |
| `deploy/privoxy/shenron-media-proxy.env` | URL locale du pont média lue par le bot (`SHENRON_MEDIA_PROXIES`), sans secret. | Idem. |
