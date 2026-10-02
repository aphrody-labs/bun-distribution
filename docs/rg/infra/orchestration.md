# Orchestration infrastructure RG

`rg` ne possède aucun registre de services. Le catalogue unique (services, ports,
routes Nginx, unités systemd, topologie, monitoring) appartient à Infra dans ce
monorepo :

- `config/service-catalog.json`, `config/nginx-routes.json`, `config/production-topology.json` ;
- `inventory/` ;
- `docs/operations/infra/INFRA-MONITORING.md` (commandes, timer, règles de déduplication).

Les scripts `infra:*`, `deploy:*`, `ops:*` et `cdn:*` de `package.json` délèguent
directement aux adaptateurs Workspace/Rust de ce monorepo ; ne pas réintroduire de manifeste local.
