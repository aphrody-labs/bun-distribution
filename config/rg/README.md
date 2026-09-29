# Rose Griffon

Monorepo Bun de Rose Griffon. Il livre une seule application web responsive :
le portail de l'association, le wiki Azalée d'*Inazuma Eleven: Victory Road*
et l'espace compétitif Achilléa.

## Architecture

| Élément | Responsabilité |
| --- | --- |
| `apps/website` | Application Next.js unique : portail, `/wiki`, `/achillea`, administration et authentification. |
| `apps/achillea-bot`, `apps/bot` | Automatisation Discord, API et temps réel. |
| `apps/cdn`, `apps/storage`, `apps/realtime` | Services Bun pour les assets, fichiers et notifications. |
| `packages/azalee`, `packages/inagle` | Bibliothèque et pipeline de données Victory Road. |
| `packages/achillea-*` | Contrats, règles métier et client HTTP Achilléa. |
| `packages/assets`, `packages/ui`, `packages/app-shell` | Assets, design system et navigation communs. |
| `packages/auth`, `packages/db`, `packages/cron` | Authentification, données et tâches récurrentes. |
| `../aphrody-infra` | Unités systemd, nginx, Docker et Cloud Run de RG (`systemd/rg-*`, `nginx/rg/`, `docker/rg-vps-replica/`, `cloud/rg-website/`). |

L’ancien frontend Angular Achilléa et le frontend Azalée autonome sont retirés.

## Développement

Prérequis : Bun 1.3.14 ou plus récent. Ne pas utiliser npm, pnpm ou yarn.

```bash
bun install
bun run website:dev
bun run type-check
bun run lint
bun test apps/website
```

Utiliser `workspace:*` pour les paquets internes et le `catalog:` racine pour
toute version partagée.

## Assets et données

`packages/assets/public` est la source unique des visuels partagés. La tâche
CDN les publie sous `https://cdn.rosegriffon.fr/static/rg/public/` ; les assets
extraits du jeu restent sous les surfaces Azalée dédiées et les fichiers des
utilisateurs restent dans Storage. Voir [docs/assets-cdn.md](docs/assets-cdn.md).

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
même build Next. Voir [docs/deploy.md](docs/deploy.md),
[docs/deploiement-sans-coupure.md](docs/deploiement-sans-coupure.md) et
[docs/cloud-deployment.md](docs/cloud-deployment.md).

## Documentation

[docs/README.md](docs/README.md) est l’index de la documentation produit et
d’exploitation. Les secrets, journaux et notes locales restent hors Git.

## Licence

Privé — tous droits réservés Rose Griffon.

## Automatisation transversale

`bun run docs:check-links` délègue la vérification documentaire à `aphrody-ops docs-links`.
