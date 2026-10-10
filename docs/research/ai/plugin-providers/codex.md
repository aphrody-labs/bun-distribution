<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- docs-links: external-paths — paths below describe provider packages and host configuration. -->

# Codex provider: plugins, skills and MCP

Verified **2026-10-03**, Linux, domain `aphrody`. This is a provider contract
for the centralized manager, not an installation request.

## Installed evidence

| Probe                                  | Observed result                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `codex --version`                      | `codex-cli 0.158.0`; executable `~/.local/bin/codex`                            |
| `codex --strict-config doctor --json`  | Exit 0, `overallStatus: ok`, configuration loaded; reports running app-server **0.160.0** |
| `codex plugin marketplace list --json` | `{"marketplaces":[]}`; no local/configured marketplace in scope                           |
| `codex plugin list --json`             | Six remote installations; no owner plugin installed                                       |
| `codex mcp list --json`                | `[]`; no directly configured MCP server in this invocation                                |

Remote installations from `openai-curated-remote`: `github` **0.1.12-5f7cd798dc99**,
`openai-templates` **0.1.1** (disabled), `pages` **0.1.19**, `sites` **0.1.75**,
`plugin-management` **0.1.0**, `work-pets` **0.1.6**. The other five are enabled.
The empty marketplace result does not exclude the remote catalog.

Owner sources now live under `~/plugins`. Preparation synchronizes
portable and compatibility versions; detached caches were cleaned with unique
contents retained in `_recovered`. The historical relocation report remains
unchanged. The central marketplace is `aphrody-user`; old `aphrody-ai` Git
catalogs must not be reactivated.

Discovery research ran `aphrody docs search 'Codex plugins skills MCP' --json`
successfully. Its three repository results were third-party material; native
help and the official sources below establish this contract.

## Native commands and validation limits

Verified installed help: `codex --help`, `plugin --help`, `plugin add|list|remove
--help`, `plugin marketplace --help` and its `add|list|upgrade --help`,
`mcp --help` and its `add|list|get|login --help`, `doctor --help`, and
`app-server --help` (each prefixed with `codex`).

| Operation                     | Exact installed interface                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin inventory              | `codex plugin list --json`; `--available` includes uninstalled entries; `--marketplace NAME` filters                                                     |
| Plugin installation           | `codex plugin add PLUGIN@MARKETPLACE --json`, or `codex plugin add PLUGIN --marketplace MARKETPLACE --json`                                              |
| Marketplace registration      | `codex plugin marketplace add SOURCE --json`; local root, `owner/repo[@ref]`, HTTPS/SSH Git URL; Git supports `--ref REF` and repeatable `--sparse PATH` |
| Marketplace inventory/refresh | `codex plugin marketplace list --json`; `codex plugin marketplace upgrade [NAME] --json` refreshes Git snapshots                                         |
| MCP inventory                 | `codex mcp list --json`; `codex mcp get NAME --json`                                                                                                     |
| Local diagnostics             | `codex doctor --json`; `codex --strict-config doctor --json` rejects unrecognized config fields                                                          |

There is **no advertised `plugin validate`, `marketplace validate`, `skill
validate`, `mcp validate`, or installation `--dry-run`** in 0.158.0. There is no
top-level `skills` CLI command. `doctor` diagnoses installation/config/auth/runtime;
it does not certify a candidate plugin or skill. `app-server generate-json-schema`
generates the **app-server protocol** schema, not a plugin package validator.
Removal commands exist (`plugin remove`, `plugin marketplace remove`, `mcp
remove|logout`); this audit did not execute them.

Manager gate: parse JSON/YAML/TOML, check declared schemas, required skill metadata,
path confinement and references; then reconcile native inventories with intended
scope. Report these as manager checks. Actual loading, skill triggers and MCP
`initialize`/tool discovery require a separate authorized runtime check; listing
configuration alone does not establish readiness.

## Package and marketplace formats

Current official packaging supports portable root `plugin.json` and `mcp.json`,
fixed `skills/`, and OpenAI settings under `extensions.com.openai`. The inline
extension replaces, rather than merges with, `.codex-plugin/plugin.json`.
Legacy Codex manifests remain supported. Paths start with `./`, resolve from the
plugin root, and stay inside it. Portable format support was **not exercised on
CLI 0.158.0**; retain the existing compatibility layout until qualified.
[Official package contract](https://developers.openai.com/plugins/build/plugins#plugin-structure).

| Artifact                                  | Schema/shape to preserve                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable `plugin.json`                    | `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`; stable `name`, version/description metadata; OpenAI overlay in `extensions.com.openai`         |
| Portable `mcp.json`                       | `$schema: https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`; `mcpServers` map; HTTP transport `type: "streamable-http"`                                        |
| Compatibility `.codex-plugin/plugin.json` | Existing name/version/description plus `skills: "./skills/"`, `mcpServers: "./.mcp.json"`; optional `apps`, `hooks`, `interface`; preserve publisher/license metadata |
| Compatibility `.mcp.json`                 | `mcpServers` map; existing local sources use `type: "stdio"`, `command`, `args`; remote Codex entries use `type: "http"`, `url`                                       |
| `.app.json`                               | `apps` map of registered hosted MCP connections; distinct from local process registration                                                                             |

Submission has its own requirements and automated review; it is not a local
validation command. See the official
[manifest fields and import rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).

For a future local catalog rooted at `~/plugins`, the entry would be
in `~/plugins/.agents/plugins/marketplace.json`:

```json
{
  "name": "owner-local",
  "interface": { "displayName": "Owner local plugins" },
  "plugins": [
    {
      "name": "aphrody",
      "source": { "source": "local", "path": "./aphrody" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

`source.path` is relative to the **marketplace root**, not its `.agents/plugins`
directory. This example is a proposed catalog, not a created registration.
The installed CLI supports the future sequence `codex plugin marketplace add
~/plugins --json`, then `codex plugin add aphrody@owner-local --json`.
Neither command was run. Discovery roots and cache behavior are documented in
[local marketplace setup](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually).
The documented installed copy lives at
`~/.codex/plugins/cache/MARKETPLACE/PLUGIN/VERSION/` (`VERSION=local` for local
plugins). Treat `~/plugins` as source storage and provider caches as
derived state; preserve their distinct identities and versions.

## Skills and scope preservation

Standalone discovery scans `.agents/skills` from CWD to repository root,
`~/.agents/skills`, `/etc/codex/skills`, and bundled system skills; symlinked
folders are supported. `~/plugins` alone is not a standalone discovery
root. At audit time neither user nor monorepo `.agents/skills` exists;
`~/.codex/skills` exists. Preserve that existing legacy/system store.

Every skill needs YAML frontmatter `name` and `description` in `SKILL.md`.
Optional `agents/openai.yaml` carries `interface`,
`policy.allow_implicit_invocation` and `dependencies.tools`; dependency metadata
does not replace explicit MCP registration. `/skills` and `$skill-name` are
interactive discovery/invocation. Duplicate names are not merged. See
[official skill discovery and metadata](https://learn.chatgpt.com/docs/build-skills).

The manager must retain this owner scope independently of manifests:

| Plugin            | Allowed scope                                           |
| ----------------- | ------------------------------------------------------- |
| `aphrody`         | `<repo>` and `../aphrody-py` only |
| `iecode`          | `../iecode` only                               |
| `yolo` | Global, as authorized by root rules                     |

The archived Aphrody description says “any project”; that does not override
root scope. Do not expose restricted skills via user-wide symlinks or register
their MCP globally. Keep source storage centralized while activation remains
project/domain specific. Native help offers no plugin/MCP `--scope` switch.

For local-marketplace plugins, user defaults can disable a plugin and trusted
project `.codex/config.toml` can enable `plugins."NAME@MARKETPLACE".enabled`.
Discovery, installation and enablement are separate states; disabling may still
allow cache refresh. Preserve managed requirements and unrelated user entries;
do not confuse directory visibility with authorization. Project configuration
requires trust. See [configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)
and [managed marketplace configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration#configure-plugin-marketplaces-and-defaults).

## MCP registration

Installed help supports these future registration forms; none was executed:

```sh
codex mcp add NAME -- COMMAND ARG
codex mcp add NAME --url https://example.invalid/mcp --bearer-token-env-var TOKEN_VAR
codex mcp login NAME --scopes read,search
```

Direct registrations use `[mcp_servers.NAME]` in Codex TOML. For restricted
servers, the manager should target trusted project `.codex/config.toml`; CLI
`mcp add` has no advertised project-scope option. Preserve `command`/`args`/`cwd`
and environment references for stdio, or `url`/`bearer_token_env_var` for HTTP,
plus enabled/tool policy. Keep credentials in private stores, not manifest
values or CLI `--env KEY=SECRET` arguments. See
[official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Plugin-bundled servers keep transport in the package; policy belongs under
`[plugins."NAME@MARKETPLACE".mcp_servers.SERVER]`, not a duplicate direct
registration. `.app.json` connections require their existing registered hosted
identity; they are not interchangeable with `.mcp.json` processes. Preserve
OAuth settings and tool allow/deny lists during translation; use the
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
to check available fields. `/mcp` inspects active servers in the TUI. This audit
did not start a server, authenticate, or exercise tools.

## Delivery checks

Read-only probes above passed; installed help and official pages were fetched.
No install, removal, config rewrite, Cargo, commit or push. Package compatibility
and MCP runtime readiness remain untested. Documentation link and whitespace
checks passed for this provider document; repository-wide generation and
code gates are outside this documentation-only change.

Workspace gate: `bun packages/infra/workspace/src/ops.ts docs links --root
. --docs docs/research/ai/plugin-providers --exclude-file
docs/research/ai/plugin-providers/agy.md --exclude-file
docs/research/ai/plugin-providers/claude.md --json` exits 0 (zero broken links
or dead paths). The initial directory run failed on those concurrent provider
documents; none of its findings concerned Codex. Whitespace inspection found
no trailing whitespace, conflict markers or missing final newline.

## Qualification centralisée

La vérification finale résout Codex 0.160.0 via le PATH. Son help n'annonce
toujours aucune commande de validation des plugins. Le premier inventaire
ci-dessus décrit le binaire 0.158.0 utilisé par l'agent de recherche.
Le gestionnaire Workspace a ensuite qualifié les installations et retraits de
fixtures plugins, skills et MCP aux scopes utilisateur et projet dans des homes
temporaires. Le cache du paquet Codex est conservé après retrait d’un projet.
Aucune source propriétaire n’a été réactivée dans le profil réel. Les overlays
préparés suivent la version canonique. Voir le [guide](../../../guides/ai/AGENT_PLUGINS.md).
