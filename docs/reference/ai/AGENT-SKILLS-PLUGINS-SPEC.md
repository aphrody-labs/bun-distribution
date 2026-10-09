<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contrat agents, skills et plugins

Cette page définit ce que le dépôt Aphrody maintient. Elle ne remplace pas les
spécifications des produits externes : suivre leur documentation officielle
avant de créer ou publier un artefact qui leur est destiné.

## Principe de composition

Une **skill** décrit un workflow réutilisable. Un **plugin** est un paquet
installable qui peut distribuer des skills, un serveur MCP, ou les deux. MCP
est l'interface pour les outils connectés ; il ne remplace pas les instructions
de workflow.

Commencer par une skill étroite et testable. Créer un plugin seulement lorsque
le workflow doit être partagé, associé à un connecteur ou fourni comme capacité
stable. Cette distinction correspond au modèle documenté pour Codex et ChatGPT
par [OpenAI](https://learn.chatgpt.com/fr-FR/docs/plugins).

## Arborescence maintenue ici

| Surface | Emplacement | Responsabilité |
| --- | --- | --- |
| Skills YOLO | `../plugins/aphrody/skills/<nom>/SKILL.md` | Workflows portables et leurs ressources proches. |
| Bundle YOLO | `../plugins/aphrody/plugin.json`, `.claude-plugin/` et `skills/` | Métadonnées, compatibilité Claude et workflows distribués par le plugin Aphrody. |
| Plugin Codex | `<plugin>/.codex-plugin/plugin.json` | Métadonnées et point d'entrée lorsqu'un bundle Codex est créé. |
| Configuration MCP | configuration générée par Aphrody ou fichier dédié | Commande, arguments et environnement minimal du serveur. |
| Règles de dépôt | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Contraintes d'exécution, sécurité et validation. |

Ne dupliquez pas le contenu d'une même skill entre plusieurs emplacements sous
version. Un manifeste doit référencer la source canonique avec un chemin relatif
quand l'hôte le permet.

## Une skill exploitable

Chaque `SKILL.md` doit :

1. déclarer un nom stable et une description qui indique les déclencheurs ;
2. expliquer les entrées, sorties, limites et vérifications ;
3. placer les scripts, références et assets à côté de la skill uniquement s'ils
   sont réellement utilisés ;
4. ne jamais contenir de credential, de chemin personnel ou de commande
   destructive non signalée ;
5. être testée sur un dépôt représentatif avant d'être distribuée.

Les agents ne doivent charger des références volumineuses que si elles sont
nécessaires à la tâche. Les instructions racines du dépôt restent prioritaires
pour les contraintes de sécurité, commits et validations.

## Plugin Codex

Pour Codex, le manifeste est
`.codex-plugin/plugin.json`. Un plugin minimal expose un nom, une version, une
description et le chemin de ses skills. La structure et l'essai local sont
décrits dans la [documentation OpenAI de création de
plugins](https://learn.chatgpt.com/fr-FR/docs/build-plugins).

Avant de partager un plugin :

1. valider le JSON et tous les chemins référencés ;
2. lancer des demandes représentatives dans une nouvelle session ;
3. vérifier que le plugin n'élargit pas les permissions ni les accès réseau par
   surprise ;
4. conserver la version et le changelog à jour.

## MCP et authentification

Un serveur MCP doit déclarer uniquement les outils nécessaires, employer les
credentials fournis par l'environnement hôte et ne jamais écrire de secret
dans le dépôt. Tester séparément son démarrage, `tools/list`, puis chaque
opération qui muterait un système externe.

`aphrody-mcp` est le serveur MCP du plugin agentique. Le binaire
`aphrody-mcp` reste le serveur MCP natif de la surface Aphrody Web du dépôt.
Le provisioning d'`aphrody
agy` est merge-safe et peut être désactivé avec `APHRODY_AGY_NO_PROVISION` ;
voir [AGENTS.md](./AGENTS.md) pour le contrat Antigravity complet.

## Validation et livraison

Les changements de skills/plugins suivent les mêmes portes que le reste du
dépôt : validation ciblée, scan des liens Markdown si les docs changent, puis
tests Cargo/Bun/Python affectés. Toute livraison autonome est qualifiée
`FAIT`, `INCOMPLET` ou `NON_FAIT` avec l'artefact ou le bloqueur précis.

Pour la navigation documentaire et l'entretien des pages, consulter
[DOCUMENTATION-PIPELINE.md](./DOCUMENTATION-PIPELINE.md).
