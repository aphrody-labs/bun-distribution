# Intégration continue — retirée le 12/8/2026

Les trois workflows GitHub Actions ont été supprimés parce qu'aucun ne pouvait
plus rendre de service.

## `ci.yml` — installation impossible

Chaque exécution mourait à la première étape, `bun install --frozen-lockfile` :

```
error: GET https://npm.pkg.github.com/@aphrody-code%2fbxc    - 403
error: GET https://npm.pkg.github.com/@aphrody-code%2fzukan  - 403
error: GET https://npm.pkg.github.com/@rpbey%2fdiscordx      - 403
error: @aphrody-code/bxc@catalog: failed to resolve
```

`apps/bot`, `packages/cron` et `packages/inagle` dépendent de paquets privés
publiés sous **d'autres comptes** (`@aphrody-code`, `@rpbey`). Le `GITHUB_TOKEN`
d'un workflow est limité à SON dépôt : il ne peut pas lire les paquets d'un
autre propriétaire, quelles que soient les permissions demandées. Aucune
correction dans le dépôt ne pouvait donc réparer la CI — ni build, ni test, ni
lint n'ont jamais tourné, seule la croix rouge arrivait.

**Pour la rétablir**, il faut un jeton d'accès personnel disposant de
`read:packages` sur les organisations `aphrody-code` et `rpbey`, enregistré en
secret de dépôt (par exemple `PACKAGES_TOKEN`) et utilisé à la place de
`GITHUB_TOKEN` dans `NODE_AUTH_TOKEN`. C'est une action de compte, hors du
dépôt.

## `publish.yml` — publiait dans le vide

Il poussait tous les `packages/*` vers GitHub Packages à chaque publication de
version. Trois exécutions, trois échecs. Deux raisons de fond :

- les paquets se référencent entre eux en `workspace:*` et déclarent leurs
  versions partagées en `catalog:` ; il faut résoudre ces deux notations en
  versions réelles **avant** `bun publish`, ce que le workflow ne faisait pas ;
- rien ne consomme ces paquets depuis le registre — apps et paquets se lient par
  le workspace Bun.

## `auto-merge-dependabot.yml` — dangereux sans CI

Il approuvait et fusionnait automatiquement les montées de version mineures et
correctives. Le garde-fou était `gh pr merge --auto`, qui attend le succès des
contrôles requis : sans CI, il ne reste aucun contrôle à attendre, et la fusion
devient inconditionnelle.

`dependabot.yml` est **conservé** : les montées de version continuent d'être
proposées en pull request, à relire et fusionner à la main.

## Ce qui tient lieu de garde-fou aujourd'hui

Le déploiement ne passe pas par GitHub : `scripts/ops/deploy.ts` construit et
bascule le Website unifié sur le VPS,
avec un contrôle de santé HTTP avant de rendre la main. Les vérifications se
font donc localement, avant de pousser :

```sh
bun run build          # construit tout le monorepo
bun test               # suite Bun native
bun --filter @rosegriffon/<app> type-check
```
