# @aphrody/plugins

Compatibility API for the unified YOLO plugin generator behind `yolo plugin create [dir]`.
The implementation, schema and CLI command live in `packages/engine/yolo/src/cli/plugin`;
this package only re-exports the existing public API. New consumers can use
`@aphrody/yolo-cli/plugin`, `/plugin/generator` and `/plugin/schema` directly.

- `generateUnifiedYoloPlugin({ targetDir, yoloRoot, name?, version? })` writes a complete plugin for
  Claude Code, Codex and Antigravity: `plugin.json` (also under `.claude-plugin/` and `.codex-plugin/`),
  `hooks.json` with a `SessionStart` hook (`hooks/scripts/session-start.sh` and `session-context.ts`),
  the `yolo`, `bun-doctrine` and `typescript7-bun` skills, the `explore` and `test-runner` agents and a
  README. It indexes the version-matched Bun docs (`vendor/bun/docs/**/*.mdx`) and the Bun core sources
  of `yoloRoot` when present, and reads the installed TypeScript version.
- `@aphrody/plugins/schema`: `PluginManifest`, `PluginHooksManifest`, `HookDefinition`,
  `HookMatcherGroup`, `AgentManifest`, `SkillManifest`.

The published marketplace plugins live in the `plugins` submodule (`aphrody-labs/plugins`);
`yolo plugin check|purge|status` audits them.

Scripts: `bun run test` (`../yolo/test/plugins.test.ts`: generated files, manifests, hooks, skills and a run of
the generated session context), `bun run typecheck`.
