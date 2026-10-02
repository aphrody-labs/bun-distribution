# Rose Griffon

Monorepo Bun de Rose Griffon. Il livre une seule application web responsive :
le portail de l'association, le wiki Azalée d'*Inazuma Eleven: Victory Road*
et l'espace compétitif Achilléa.

## Architecture

| Élément | Responsabilité |
| --- | --- |
| `apps/rg/website` | Application Next.js unique : portail, `/wiki`, `/achillea`, administration et authentification. |
| `apps/achillea-bot` (not in repo), `apps/rg/bot` | Automatisation Discord, API et temps réel. |
| `apps/rg/bot/src/api/services/cdn`, `apps/rg/bot/src/api/services/storage`, `apps/rg/bot/src/api/services/realtime` | Services Bun pour les assets, fichiers et notifications. |
| `packages/rg/azalee` (not in repo), `packages/rg/inagle` (not in repo) | Bibliothèque et pipeline de données Victory Road. |
| `packages/achillea-*` | Contrats, règles métier et client HTTP Achilléa. |
| `packages/rg/assets`, `packages/ui`, `packages/rg/app-shell` | Assets, design system et navigation communs. |
| `packages/rg/auth`, `packages/rg/db`, `packages/rg/cron` | Authentification, données et tâches récurrentes. |
| `../aphrody-infra` | Unités systemd, nginx, Docker et Cloud Run de RG (`systemd/rg-*`, `nginx/rg/`, `docker/rg-vps-replica/`, `cloud/rg-website/`). |

L’ancien frontend Angular Achilléa et le frontend Azalée autonome sont retirés.

## Développement

Prérequis : Bun 1.3.14 ou plus récent. Ne pas utiliser npm, pnpm ou yarn.

```bash
bun install
bun run website:dev
bun run type-check
bun run lint
bun test apps/rg/website
```

Utiliser `workspace:*` pour les paquets internes et le `catalog:` racine pour
toute version partagée.

## Assets et données

`packages/rg/assets/public` est la source unique des visuels partagés. La tâche
CDN les publie sous `https://cdn.rosegriffon.fr/static/rg/public/` ; les assets
extraits du jeu restent sous les surfaces Azalée dédiées et les fichiers des
utilisateurs restent dans Storage. Voir [assets-cdn.md](../../../operations/rg/assets-cdn.md).

Les données Victory Road viennent du pipeline `inagle` et du miroir SQLite ;
elles ne sont pas éditées directement dans un export généré.

## Vérifier et déployer

```bash
bun run type-check
bun run lint
bun run docs:check-links
bun run infra:check
sudo nginx -t
bun run deploy website
bun run deploy:status
```

Website est publié en bleu/vert : portail, wiki et Achilléa passent dans le
même build Next. Voir [deploy.md](../../../operations/rg/deploy.md),
[deploiement-sans-coupure.md](../../../operations/rg/deploiement-sans-coupure.md) et
[cloud-deployment.md](../../../operations/rg/cloud-deployment.md).

## Documentation

[README.md](../../../products/rg/README.md) est l’index de la documentation produit et
d’exploitation. Les secrets, journaux et notes locales restent hors Git.

## Licence

Privé — tous droits réservés Rose Griffon.

## Automatisation transversale

`bun run docs:check-links` délègue la vérification documentaire à `aphrody-ops docs-links`.
