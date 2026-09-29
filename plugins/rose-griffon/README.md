# Plugin Claude `rose-griffon`

Installe en une commande tout ce qu'il faut pour travailler sur le projet
Rose Griffon depuis n'importe quelle machine : l'accès aux données du jeu
*Inazuma Eleven: Victory Road*, les procédures de déploiement et de
diagnostic de la production, et les conventions du monorepo.

Plugin **privé** : il référence l'infrastructure du projet (unités systemd,
chemins du VPS). La topologie de production (ports, unités, hôtes) appartient à
`aphrody-infra/config/service-catalog.json`.

## Installer

```bash
# Depuis une copie du dépôt
claude plugin marketplace add /chemin/vers/rg
claude plugin install rose-griffon@rose-griffon
```

L'endpoint MCP HTTP `mcp.rosegriffon.fr` est retiré (il répond 410) : le plugin
ne déclare donc plus de serveur MCP distant (`.mcp.json` vide). Le serveur MCP
reste disponible en **stdio** via le `.mcp.json` de projet du dépôt.

## Contenu

**Skills**

| Skill | Déclenchement | Rôle |
| --- | --- | --- |
| `donnees-jeu` | automatique | interroger le wiki et les données du jeu sans rien inventer |
| `conventions` | automatique | règles du monorepo et pièges qui cassent la production |
| `/rose-griffon:deployer` | invoquée | déployer wiki, site, MCP ou API, puis vérifier |
| `/rose-griffon:diagnostic` | invoquée | remonter d'un symptôme à une cause argumentée |
| `/rose-griffon:verifier-connexion` | invoquée | réparer une connexion MCP (jeton, portée, URL) |
| `/rose-griffon:workflow-unifie` | invoquée | router les travaux multi-surfaces avec manifest, preuves P0-P4 et garde-fous |

**Agents** — `rg-donnees` (exploration des données de jeu en contexte isolé),
`rg-ops` (diagnostic de production) et `rg-workflow` (orchestration
multi-surfaces avec run borné).

**Hook** — après un `bun install`, remet `bun.lock` en `lockfileVersion: 1` si
Bun l'a réécrit en 2. La v2 est illisible par le Bun 1.3.x de la CI et de la
production ; la correction était manuelle, elle est désormais systématique. Le
hook ne s'applique qu'au monorepo `rg` : il vérifie l'identité du dépôt avant
de toucher au fichier.

## Sur le VPS

Le dépôt fournit un `.mcp.json` de projet qui lance le serveur en **stdio**,
sans réseau ; ses outils sont nommés `mcp__rose-griffon__…`.

Le workflow unifié ne déclare pas de faux connecteur : le MCP Rose Griffon
reste la surface locale de données et d'exploitation, tandis que `niers`,
WinClean, Ghidra et Computer Use sont routés seulement si leur serveur ou leur
application répond réellement. Une déclaration MCP ne vaut que P0 ; le run et
les sondes live sont requis pour P3/P4.

## Développer le plugin

Le serveur MCP lui-même vit dans `packages/mcp` (`@rosegriffon/mcp`) —
implémentation Bun native, sans dépendance Node. Sa documentation :
`packages/mcp/README.md` et `docs/mcp.md`.

Après modification d'un composant, recharger la session Claude Code
(`/reload-plugins`) ; le hook et le MCP sont relus au démarrage.
