# Orchestration infrastructure RG

`rg` ne possède aucun registre de services. Le catalogue unique (services, ports,
routes Nginx, units systemd, topologie, monitoring) vit dans le dépôt frère
`aphrody-infra` :

- `../aphrody-infra/config/service-catalog.json`, `nginx-routes.json`, `production-topology.json` ;
- `../aphrody-infra/inventory/` ;
- `../aphrody-infra/docs/INFRA-MONITORING.md` (commandes, timer, règles de déduplication).

Les scripts `infra:*`, `deploy:*`, `ops:*` et `cdn:*` de `package.json` délèguent
directement aux scripts de `aphrody-infra` ; ne pas réintroduire de manifeste local.
