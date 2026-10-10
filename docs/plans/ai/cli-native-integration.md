<!-- SPDX-License-Identifier: Apache-2.0 -->
# CLI AI native — plan propriétaire

Décisions communes : [plan AI](native-integration-master.md).
Portée : CLI/aphrody-command, agent-runtime, config, MCP, skills, session,
rollout, tools, patch et project-doc. Inférence et RAG restent chez leurs owners.
Inventaire initial 2026-10-01 ; APIs et disponibilité à requalifier par lot.

## Owners uniques

| Capacité | Owner | Migration |
| --- | --- | --- |
| Client MCP | `mcp-client` | `mcp/client_cmd` et Gemini délèguent |
| Modèle MCP/config | `config` | Un modèle typé ; adapters TOML/JSON par outil |
| Manifest/plugin | `marketplace` | Une source portable ; sorties provider générées/checkées |
| Skills | `skills` discovery, `skills-forge` authoring | SDK réexporte |
| Hooks | `skills::hooks` | Mapping par provider ; agy Stop/PostInvocation, pas AfterAgent |
| Shell/search | `agent-tools` | SDK délègue ; qualifier search en processus |
| AGENTS | `project-doc` | Pas second loader |

## Produits externes et compatibilité

Codex : préférer les contrats Aphrody `exec/resume/fork/app-server/config` et
fixtures JSONL/JSON-RPC. Les anciennes propositions `codex-native`/dépendances
`codex-*` ne remplacent pas la décision protocole du plan AI.

Conserver les transports nécessaires : MCP stdio, hooks commandés, git,
shell agent, OpenSSH config probe, toolchains externes et TUI vendor optionnels.
BXC/Web appartient au owner Web ; NIE reste un produit distinct.
Gemini déprécié : retrait après fenêtre de compatibilité qualifiée.

Préserver noms de commandes, trailing args, flags, schémas, exit codes et
overrides `APHRODY_CODEX_BIN`, `APHRODY_AGY_BIN`, `BXC_BIN`, `NIE_BIN`,
`APHRODY_SSH_BIN` selon leurs consommateurs. Retirer un forwarder après
parité, sans garder un deuxième chemin inutilisé dans le build promu.

## Queue

1. Qualifier les alias `model list/ls`, `info/show`, `rm/remove`, `ps` rapportés.
   `pull` et gateway existants ; `run` dépend de l'API inférence ; cp/create non prévus.
2. Un modèle `McpServerConfig` vers Codex TOML, agy/OpenCode JSON et Claude MCP ;
   remplacer les editors provision dédiés.
3. Génération marketplace/manifests/agents depuis le owner plugin actuel,
   avec mode check ; ne pas reprendre les anciens chemins plugin comme actuels.
4. Qualifier les hooks agy Stop/PostInvocation contre types du provider.
5. Fusionner clients MCP et shell SDK vers leurs owners.
6. Tests de conformité Codex puis migration des forwards nécessaires.
7. `model run` sur l'API inférence stable.
8. Search natif au owner, sans deuxième implémentation de découverte.
9. Adapter OpenCode et valider son schéma.
10. Retirer Gemini après qualification de ses consommateurs.

## Qualification

Valider manifest, MCP/hooks et paths contre les providers installés.
Les quatre adaptations restent distinctes : Claude manifest/MCP/hooks ;
Codex marketplace/agents/config ; agy hooks/MCP ; OpenCode config/instructions/
skills/agents/commands. Réutiliser les dossiers partagés, sans copie de skills.

Les layouts provider, licences et versions se vérifient au moment du lot.
Aucune dépendance placeholder `rev=<pinned>` à ajouter depuis ce plan.
Gates : contrats CLI, conformance, plugin validator, Bun scoped et Rust sérialisé.
Les inventaires du 2026-10-01 ne qualifient pas les APIs actuelles.
