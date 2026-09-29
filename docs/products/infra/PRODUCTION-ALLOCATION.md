# Allocation production

## Décision

Le gros VPS est le seul runtime public. Il porte RG, Shenron, Nginx, les
releases actives et, après le redéploiement par le bundle tout-en-un, la pile
Aphrody à cinq services (retirée le 2026-09-25). NIE n'y tourne plus depuis le
2026-09-25 et ne publie pas de release VPS. DBFR est un nœud de données secondaire :
PostgreSQL, Redis, CDN d’assets, backups et un seul slot de rollback. Il ne
sert ni site, ni bot, ni Next, ni crawler.

IECode quitte les VPS : le checkout, les assets lourds et les outils desktop
restent dans Windows et WSL. Le VPS ne reçoit que les artefacts explicitement
nécessaires au runtime.

## Ports et sous-domaines

Seuls `80/443` sont publics via Nginx. Les ports applicatifs restent en loopback
ou réseau privé : site Aphrody `8083`, Web API `3007`, A2A `8788`, IA HTTP et
MCP (`dragonball.*`) `8789`, embeddings E5 `8794`, RG web `3004`, RG API `8800`
(CDN, Storage et Realtime y sont montés en processus ; `8801`/`8810`/`8812`
sont retirés), Shenron site `5011`, Shenron bot/API `5006`, tunnel PostgreSQL
Shenron `15433`. `5010` (`shenron-mcp`) et NIE `8085`/`8790` sont retirés.
PostgreSQL `5432` et Redis `6379` écoutent uniquement en loopback sur le VPS
(bases `aphrody` et `aphrody_web`) ; DBFR reste un nœud de données secondaire
avec ses propres services internes. La référence est
`config/service-catalog.json` et `docs/PORTS-AND-DOMAINS.md`.

## Priorités

1. Nginx, API, sites et CDN.
2. PostgreSQL, Redis, backups et rollback.
3. Workers métier nécessaires (bots, cron).
4. IA (A2A, MCP, E5), indexations et tâches différées.
5. Crawlers, mirrors complets et jobs exploratoires : désactivés par défaut.

Les limites CPU/RAM sont appliquées par unités systemd à partir de cette
priorité ; aucune application ne peut créer son propre superviseur, timer,
proxy ou mirror.

## Timers unifiés

La politique `config/scheduler-policy.json` remplace les familles de timers
RG/Shenron redondantes. Un seul timer backup vit sur DBFR, un timer sync est
différé, et un cleanup quotidien vit sur le VPS principal. Il n’existe aucun
crawler 24/24 ni double sens de réplication actif par défaut.
