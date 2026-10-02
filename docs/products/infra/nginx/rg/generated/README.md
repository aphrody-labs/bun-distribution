# Fragments Nginx générés

Ces fragments sont les modèles des upstreams bleu/vert. `scripts/ops/deploy.ts` (not in repo)
écrit les copies actives dans `/etc/nginx/rg-upstreams/` au moment d'une bascule.
Ils sont versionnés ici pour rendre la topologie auditable, mais ne doivent pas
être copiés manuellement : le slot actif est un état de déploiement, pas une
configuration statique.
