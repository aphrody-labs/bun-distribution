# Intégration Aphrody Discord

## Décision

`aphrody-discord` est la couche partagée pour les protocoles Discord et le
cycle de vie runtime. Shenron reste la couche produit : canon Dragon Ball,
commandes, permissions métier, PostgreSQL, réplica SQLite, API et site.

| Couche | Propriétaire | Contrat |
| --- | --- | --- |
| Transport Discord | `aphrody-discord` | REST, limites/retry, Gateway, interactions signées, health/readiness |
| Adaptateurs framework | `aphrody-discord` | Discord.js/DiscordX, exports et versions publiables |
| Domaine Shenron | `shenron` | commandes, events, guards, canon, données, API |
| Orchestration AI/MCP | `aphrody-ai` | agents, outils `dragonball.*`, appels API autorisés |
| Déploiement | `aphrody-infra` | releases, systemd, Nginx, secrets externes, rollback |

## État vérifié

- `aphrody-discord` fournit déjà `@aphrody/messaging`, un contrat de canaux et
  un adaptateur REST Bun sans dépendance runtime directe.
- Shenron utilise encore les workspaces DiscordX du monorepo pour son bot Bun.
  C'est une compatibilité transitoire documentée, pas une seconde connexion
  Gateway ou un second transport REST.
- Le service de production Shenron reste `shenron-bot.service`; la topologie,
  le vhost et la release sont exclusivement ceux d'`aphrody-infra`.

## Ordre de migration

1. Stabiliser les exports et tests mockés de `@aphrody/messaging`.
2. Introduire les interfaces de transport dans Shenron sans déplacer ses
   commandes, ses guards ou ses accès aux données.
3. Remplacer les workspaces externes par une version publiée ou un SHA
   verrouillé d'`aphrody-discord`; supprimer le couplage frère implicite.
4. Vérifier une seule connexion Gateway par application, les interactions
   Gateway/HTTP mutuellement exclusives, puis lancer les gates Shenron.
5. Faire qualifier la release par `aphrody-infra` avant toute bascule de
   production. Une documentation ou un commit ne prouvent pas un déploiement.

## Invariants

- Aucun secret, token Discord, URL OAuth réelle ou DSN n'entre dans ce dépôt.
- Les commandes, données, migrations et règles d'autorisation restent dans
  Shenron.
- Les clients Aphrody passent par l'API/MCP autorisée ; ils n'ouvrent jamais
  PostgreSQL directement.
- Une façade temporaire doit avoir un consommateur mesuré et une échéance de
  retrait ; aucune duplication de client Discord n'est admise.
