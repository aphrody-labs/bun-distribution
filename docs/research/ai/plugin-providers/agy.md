<!-- SPDX-License-Identifier: Apache-2.0 -->

# Fournisseur agy : plugins, skills et MCP

Recherche déléguée via `aphrody a2a invoke --peer agy`, complétée par
`aphrody docs search`, le help installé et les documents livrés avec le CLI.
Vérifié le 2026-10-03. La vérification finale `agy --version` retourne `1.2.16`;
le gestionnaire conserve le résultat de chaque probe et son chemin de binaire.

## Sources locales

- [Plugins](../../../../m3/docs/reference/tauri/plugins.md)
- Skills
- Enregistrements JSON
- MCP
- Hooks

## Commandes observées

```sh
agy plugin --help
agy plugin validate /chemin/plugin
agy plugin install /chemin/plugin
agy plugin uninstall nom
agy mcp --help
agy mcp add --env NOM=valeur serveur commande argument
agy mcp remove serveur
```

Les options MCP précèdent les arguments positionnels. Ne pas appeler
`agy plugin uninstall --help` : cette interface traite `--help` comme un nom.
`plugin validate` vérifie les composants et la résolution PATH des commandes MCP.
Aucune commande distincte de validation des skills n'est annoncée; utiliser la
validation du plugin et les contrôles du gestionnaire/`aphrody-skills`.

## Formats et découverte

Un bundle contient `plugin.json`, éventuellement `skills/<nom>/SKILL.md`,
`agents`, `commands`, `hooks.json` et `mcp_config.json`. Un hook Claude sous
`hooks/hooks.json` doit être adapté au format racine agy. Le frontmatter des
skills contient un nom et une description YAML valides. Les ressources restent
avec la skill.

La découverte globale emploie `~/.gemini/config/plugins` et
`~/.gemini/config/skills`. Les enregistrements explicites sont
`~/.gemini/config/plugins.json` et `skills.json`. Dans le projet, agy lit
`.agents/plugins.json` (not in repo) et `.agents/skills.json` (not in repo), également dans les répertoires
parents entre le cwd et la racine du projet. Une entrée scanne exactement un
niveau; `include_only` filtre les noms de sous-dossiers.

```json
{
  "entries": [{ "path": "~/plugins", "include_only": ["aphrody"] }]
}
```

Ce filtre est nécessaire : enregistrer tout `~/plugins` sans sélection
activerait également les bundles réservés à d'autres domaines.
Le gestionnaire garde `aphrody` et `iecode` dans leurs workspaces autorisés.

## MCP

Les surfaces documentées sont le fichier global
`~/.gemini/config/mcp_config.json` et le fichier `mcp_config.json` d'un plugin
actif. Un serveur stdio déclare `command`, `args`, éventuellement `env`; un
serveur HTTP déclare `url`. Le transport SSE legacy n'est pas pris en charge.
Le gestionnaire produit un plugin MCP de projet enregistré par `plugins.json`
pour préserver ce scope, plutôt qu'un fichier MCP de projet non documenté.
Les configurations privées ne doivent jamais être copiées dans la documentation.

Après préparation, les huit manifests sont cohérents et les huit bundles
passent `agy plugin validate`. Le lanceur BXC 0.9.15 existait dans son store
de paquets Aphrody; un lien vers `~/.local/bin/bxc` le rend visible au
validateur sans reconstruire BXC. BXC fournit navigation, crawl, recherche et
extraction. Les doublons détachés ont été nettoyés et leurs contenus uniques sont dans
`~/plugins/_recovered`; le rapport de migration historique est conservé.

L'installation et le retrait de fixtures plugins/skills/MCP aux scopes global
et projet ont été qualifiés dans un home temporaire. Le chargement interactif
et la disponibilité des serveurs restent des contrôles séparés.
Voir le [gestionnaire Workspace](../../../guides/ai/AGENT_PLUGINS.md).
