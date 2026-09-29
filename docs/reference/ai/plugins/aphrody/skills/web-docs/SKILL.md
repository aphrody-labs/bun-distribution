---
name: web-docs
description: "Write or improve CLAUDE.md, plans, package READMEs, SKILL.md and agent/command frontmatter for the Aphrody Web repository."
metadata:
  short-description: Maintain aphrody web documentation and agent skills.
---

Follow the reusable guidance in this plugin and the Codex skill patterns. Keep
both integration surfaces valid: Claude Code uses
`.claude-plugin/`, while Codex uses `.codex-plugin/plugin.json` and lowercase
hyphenated skill names.

Always keep docs in sync with code changes (especially new Chat methods, XTools, FFI symbols, CLI subcommands).

The web-core and this skill emphasize making everything generic so the plugin + docs can be dropped into other projects.
