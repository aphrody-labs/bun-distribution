# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique pour une faille de sécurité.

Privilégier le canal privé de GitHub :
**Security → Report a vulnerability** (Private Vulnerability Reporting) sur
`github.com/aphrody-labs/aphrody` (`apps/shenron`, `packages/shenron`).

À défaut, contact direct : **contact@aphrody-code.dev**.

Merci d'inclure si possible :

- une description de la faille et de son impact ;
- les étapes de reproduction (PoC) ;
- les versions / commits concernés.

## Délais indicatifs

- Accusé de réception : sous **72 h**.
- Évaluation initiale et plan de correction : sous **7 jours**.
- Les rapports valides sont traités en priorité ; un correctif est publié
  avant toute divulgation publique coordonnée.

## Périmètre

Ce dépôt contient un bot Discord (`apps/shenron/bot`) et un site compagnon
(`apps/shenron/site`). Sont particulièrement sensibles :

- l'API REST du bot et son dashboard admin (auth, tokens) ;
- l'authentification Discord OAuth (Better Auth, côté bot **et** site) ;
- l'exposition de données membres (les dumps SQLite et exports runtime sont
  **exclus du dépôt** — cf. `.gitignore`).

## Bonnes pratiques contributeurs

- Aucun secret dans le dépôt : `.env` est ignoré, la production utilise des
  variables d'environnement gérées côté `aphrody-infra` (systemd
  `EnvironmentFile`, plus de Vercel — cf. `docs/operations/shenron/INFRA-DELEGATION.md`).
  Voir `apps/shenron/bot/.env.example` pour la liste des variables attendues (valeurs
  factices uniquement).
- Ne jamais committer `apps/bot/data/*.db`, `guild-scan.json`, ni aucun export
  de données utilisateurs.
