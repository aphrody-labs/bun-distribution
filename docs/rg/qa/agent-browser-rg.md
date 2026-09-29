# Workflow `agent-browser` de RG

Version du workflow : `1.0.0` — schéma des rapports : `1`.

Ce workflow vérifie le site Rose Griffon en conditions réelles, sans écrire dans
PostgreSQL et sans réactiver le crawler IE historique. Il regroupe crawl des
robots/sitemaps, découverte de liens, scrape léger du DOM rendu, navigation,
tests de layout mobile, routes API, redirections protégées, axe, vitals,
console et erreurs runtime.

## Flux

```text
robots.txt + sitemaps
        ↓
URLs internes dédupliquées et plafonnées
        ↓
curl (HTTP/redirect) → agent-browser (DOM/JS/navigation)
        ↓
layout mobile + a11y + vitals + console/errors + API
        ↓
JSONL + screenshots + report.json + report.md
```

Le script est idempotent, verrouillé par passe et compatible avec une exécution
ponctuelle ou une boucle. Il ne suit que `rosegriffon.fr` et limite le nombre de
pages pour empêcher une erreur de sitemap de produire une charge illimitée.

## Commandes

Depuis la racine du dépôt :

```bash
# Une passe, utilisée en CI ou avant une livraison
bun --filter @rosegriffon/website qa:browser

# Boucle locale/monitoring (arrêt avec Ctrl-C)
RG_BROWSER_MODE=loop RG_BROWSER_INTERVAL_SECONDS=900 \
  bun --filter @rosegriffon/website qa:browser

# Même workflow via rg-cron, sans démarrer la passerelle Discord
RG_BROWSER_MAX_PAGES=40 bun packages/cron/src/index.ts --run website:qa
```

La tâche cron est `admin-strict`, manuelle et read-only. Elle est volontairement
absente des planifications automatiques de production : le monitoring continu
doit être explicitement lancé avec `RG_BROWSER_MODE=loop` ou par un ordonnanceur
externe maîtrisé.

## Variables utiles

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `RG_BROWSER_BASE_URL` | `https://rosegriffon.fr` | Origine à tester |
| `RG_BROWSER_API_BASE_URL` | `https://api.rosegriffon.fr` | Origine des probes API |
| `RG_BROWSER_MODE` | `once` | `once` ou `loop` |
| `RG_BROWSER_INTERVAL_SECONDS` | `900` | Pause entre passes en boucle |
| `RG_BROWSER_MAX_PAGES` | `40` | Plafond de pages par passe |
| `RG_BROWSER_OUT_DIR` | `.agent-browser/rg-qa` | Racine des rapports |
| `AGENT_BROWSER_SESSION` | session worktree | Session persistée/restaurée |
| `RG_BROWSER_FAIL_ON_ERRORS` | `0` | Échouer sur console/runtime |
| `RG_BROWSER_FAIL_ON_A11Y` | `0` | Échouer sur violations axe |

Les violations a11y et avertissements de console sont toujours enregistrés,
mais ne rendent pas la passe rouge par défaut : le site peut avoir des warnings
tiers connus. Les statuts HTTP, ouvertures impossibles, erreurs API et
débordements horizontaux rendent la passe rouge.

## Artefacts et codes de sortie

Chaque passe est écrite dans `$RG_BROWSER_OUT_DIR/<UTC>-<pid>/`, avec le lien
`latest` :

- `report.json` : contrat versionné et résumé machine ;
- `report.md` : résumé humain ;
- `pages.jsonl`, `api.jsonl` : résultats par route ;
- `urls.unique` : périmètre exact testé ;
- screenshots PNG et fichiers stderr par route.

Codes : `0` passe OK, `1` contrôle en échec, `2` dépendance/configuration
manquante, `75` verrou déjà pris.

## Auth, admin et données sensibles

La passe standard est anonyme. `/admin` et les routes admin sont donc attendues
comme des redirections vers `/login`; cela teste le garde d'accès, pas le contenu
du tableau de bord. Pour une passe authentifiée, fournir une session
`agent-browser` déjà sauvegardée via `AGENT_BROWSER_SESSION` et restaurable dans
le profil de travail. Ne jamais committer les fichiers de session, cookies,
tokens ou screenshots contenant des données privées.

Le script ne soumet aucun formulaire et n'utilise pas `execute_sql`. Les probes
API sont des GET, et l'exécution via cron garde le workflow en mode `once`.
