import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PluginManifest, PluginHooksManifest } from "./schema";

const ensureDir = (dirPath: string) => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

export interface GeneratePluginOptions {
  readonly targetDir: string;
  readonly yoloRoot: string;
  readonly name?: string;
  readonly version?: string;
}

/**
 * Autonomously generate unified YOLO plugin files directly from:
 * 1. vendor/bun/docs mdx directory (Bun docs)
 // 2. Bun core TypeScript usage
 * 3. TypeScript 7.0.2 official engine & types (@types/bun + node_modules/typescript)
 * 4. NHITL (Non-Human-In-The-Loop) execution doctrine & subagent autonomy
 */
export async function generateUnifiedYoloPlugin(
  options: GeneratePluginOptions,
): Promise<{
  readonly pluginDir: string;
  readonly filesGenerated: readonly string[];
}> {
  const pluginDir = resolve(options.targetDir);
  const yoloRoot = resolve(options.yoloRoot);
  const bunDocsDir = join(yoloRoot, "vendor", "bun", "docs");
  const bunSrcDir = join(yoloRoot, "vendor", "bun", "src");
  const filesGenerated: string[] = [];

  const writeContent = async (relPath: string, content: string) => {
    const fullPath = join(pluginDir, relPath);
    ensureDir(dirname(fullPath));
    await Bun.write(fullPath, content.trim() + "\n");
    filesGenerated.push(relPath);
  };

  ensureDir(pluginDir);

  // 1. Scan Bun docs MDX
  const mdxPages: string[] = [];
  if (existsSync(bunDocsDir)) {
    const glob = new Bun.Glob("**/*.mdx");
    for (const file of glob.scanSync({ cwd: bunDocsDir, onlyFiles: true })) {
      mdxPages.push(file);
    }
  }

  // 2. Scan TypeScript files in bun core
  const bunCoreTsFiles: string[] = [];
  if (existsSync(bunSrcDir)) {
    const glob = new Bun.Glob("**/*.ts");
    for (const file of glob.scanSync({ cwd: bunSrcDir, onlyFiles: true })) {
      bunCoreTsFiles.push(file);
    }
  }

  // 3. Read official TypeScript 7 package information
  let tsVersion = "7.0.2";
  const tsPkgPath = join(
    yoloRoot,
    "node_modules",
    "typescript",
    "package.json",
  );
  if (existsSync(tsPkgPath)) {
    try {
      const tsPkg = JSON.parse(await Bun.file(tsPkgPath).text()) as {
        version?: string;
      };
      if (tsPkg.version) tsVersion = tsPkg.version;
    } catch {}
  }

  const pluginName = options.name ?? "yolo";
  const pluginVersion = options.version ?? "1.0.0";

  // Generate plugin.json
  const manifest: PluginManifest = {
    name: pluginName,
    version: pluginVersion,
    description:
      "Unified YOLO autonomous developer runtime & Bun-TS7 native industrial engine",
    author: "aphrody-dev <contact@aphrody.com>",
    license: "Apache-2.0",
    repository: "https://github.com/aphrody-labs/yolo.git",
    engines: {
      bun: ">=1.4.2",
      typescript: `>=${tsVersion}`,
    },
  };
  await writeContent("plugin.json", JSON.stringify(manifest, null, 2));

  // Generate .claude-plugin/plugin.json & .codex-plugin/plugin.json
  await writeContent(
    ".claude-plugin/plugin.json",
    JSON.stringify(manifest, null, 2),
  );
  await writeContent(
    ".codex-plugin/plugin.json",
    JSON.stringify(manifest, null, 2),
  );

  // Generate hooks.json & hooks/hooks.json (NHITL session-start hook)
  const hooksConfig: PluginHooksManifest = {
    [pluginName]: {
      enabled: true,
      SessionStart: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command:
                'bash "${CLAUDE_PLUGIN_ROOT:-.}/hooks/scripts/session-start.sh"',
              timeout: 10,
            },
          ],
        },
      ],
    },
  };
  await writeContent("hooks.json", JSON.stringify(hooksConfig, null, 2));
  await writeContent("hooks/hooks.json", JSON.stringify(hooksConfig, null, 2));

  // Generate session-start.sh (NHITL doctrine + subagents autonomous flags)
  const sessionStartScript = [
    "#!/usr/bin/env bash",
    "# YOLO Unified Autonomous Runtime - Force Non-Human-In-The-Loop (NHITL) environment",
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"',
    "export APHRODY_YOLO=1",
    "export APHRODY_NHITL=1",
    "export APHRODY_AUTO_APPROVE=1",
    "export APHRODY_NON_INTERACTIVE=1",
    "export CI=true",
    "",
    "# Bun & TypeScript 7 Core Environment",
    "export BUN_TS7_CONTEXT=on",
    `export TS_VERSION="${tsVersion}"`,
    "",
    "# Execute TS session context check in Bun if available",
    "if command -v bun >/dev/null 2>&1; then",
    '  bun --no-install --no-env-file run "${SCRIPT_DIR}/session-context.ts" || true',
    "fi",
    "",
    `echo "[yolo] Non-human-in-the-loop autonomous runtime active (NHITL=1, AUTO_APPROVE=1, TS7=${tsVersion})"`,
    "",
  ].join("\n");
  await writeContent("hooks/scripts/session-start.sh", sessionStartScript);

  // Generate session-context.ts with verified Bun docs & TS7 rules
  const sessionContextScript = [
    "#!/usr/bin/env bun",
    `// Auto-generated session context for Bun & TypeScript ${tsVersion}`,
    'import { existsSync, readFileSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    "",
    "function findProjectRoot(start: string): string {",
    "  let dir = start;",
    "  for (let depth = 0; depth <= 5; depth++) {",
    '    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "package.json"))) return dir;',
    "    const parent = dirname(dir);",
    "    if (parent === dir) break;",
    "    dir = parent;",
    "  }",
    "  return start;",
    "}",
    "",
    "const root = findProjectRoot(process.cwd());",
    "const lines = [",
    `  "[yolo-unified] Bun runtime " + Bun.version + " in " + root + " (TypeScript ${tsVersion} Corsa compiler active)",`,
    '  "Doctrine: NHITL (Non-Human-In-The-Loop) - Never wait for human gating, enforce native technical gates.",',
    '  "- Bun-first: Bun.file, Bun.write, Bun.serve, Bun.spawn, bun:sqlite, Bun.sql. No obsolete Node wrappers.",',
    '  "- TypeScript 7.0+: Native Go Corsa compiler. Strict types: [bun] in compilerOptions.",',
    '  "- Subagents: Autonomously dispatch disjoint file sweeps without polling.",',
    "];",
    "",
    "console.log(JSON.stringify({",
    "  hookSpecificOutput: {",
    '    hookEventName: "SessionStart",',
    '    additionalContext: lines.join("\\n")',
    "  }",
    "}));",
    "",
  ].join("\n");
  await writeContent("hooks/scripts/session-context.ts", sessionContextScript);

  // Generate SKILL.md for yolo
  const yoloSkill = `---
name: yolo
description: "Unified autonomous execution (NHITL) with Bun-first engine & TypeScript ${tsVersion} compiler doctrine. Modes: single, grind, perfect loop, plan."
metadata:
  version: "${pluginVersion}"
  author: "aphrody-code"
  license: "Apache-2.0"
---

# YOLO — Unified Autonomous Execution Runtime

Universal Non-Human-In-The-Loop (NHITL) autonomous developer runtime.

## Core Rules & Gates

1. **NHITL Contract**: Approvals are never awaited from humans. Technical gates (bun test, tsc --noEmit, oxlint, cargo check) are strictly verified.
2. **TypeScript ${tsVersion} Baseline**: Type-checking is strictly delegated to \`tsc --noEmit\` (Corsa engine). Tsconfig must define \`"types": ["bun"]\`.
3. **Bun Native Stack**: Zero external npm dependencies when native Bun primitives exist (\`Bun.file\`, \`Bun.write\`, \`Bun.serve\`, \`bun:sqlite\`, \`Bun.hash\`, \`Bun.Glob\`).
4. **Docs Indexing**: Version-matched Bun documentation is generated from \`vendor/bun/docs\` (${mdxPages.length} MDX files indexed).

## Modes

- \`single\` (\`/yolo <item>\`): Complete implementation, verification gates and commit.
- \`grind\` (\`/yolo-grind\`): Up to 4 disjoint subagents in parallel with batched commit.
- \`perfect\` (\`/yolo-perfect-grind\`): Continuous execution until 0 tasks remain and all gates are green.
- \`plan\` (\`/start\`): Sequential execution of project plan.
`;
  await writeContent("skills/yolo/SKILL.md", yoloSkill);

  // Generate skills/bun-doctrine/SKILL.md
  const bunDoctrineSkill = `---
name: bun-doctrine
description: "Strict Bun-only doctrine, native API substitutions, server gotchas and Bun fork rules."
metadata:
  version: "${pluginVersion}"
  author: "aphrody-code"
  license: "Apache-2.0"
---

# Bun Doctrine & Engineering Rules

Directly derived from \`vendor/bun/docs\` (${mdxPages.length} MDX pages) and Bun core codebase (${bunCoreTsFiles.length} TS files).

## API Substitutions

The Bun-to-Node API table lives in the \`bun-apis\` skill of the Bun fork (\`bun mcp install\`); use it instead of a copy here.

Server gotcha: with \`Bun.serve({ fetch, websocket })\`, set \`server.timeout(req, 0)\` for long-lived streams/SSE.
`;
  await writeContent("skills/bun-doctrine/SKILL.md", bunDoctrineSkill);

  // Generate skills/typescript7-bun/SKILL.md
  const ts7Skill = `---
name: typescript7-bun
description: "TypeScript ${tsVersion} (Go Corsa native compiler) integration with Bun runtime and @types/bun."
metadata:
  version: "${pluginVersion}"
  author: "aphrody-code"
  license: "Apache-2.0"
---

# TypeScript ${tsVersion} with Bun

TypeScript ${tsVersion} adopts the Corsa native Go compiler. Bun transpiles TypeScript code instantly without type checking; type verification is performed via \`tsc --noEmit\`.

## Mandatory tsconfig.json Options

\`\`\`json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "types": ["bun"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  }
}
\`\`\`
`;
  await writeContent("skills/typescript7-bun/SKILL.md", ts7Skill);

  // Generate Autonomous Subagents (explore, reviewer, security, runner)
  const exploreAgent = `---
name: explore
description: Read-only code explorer mapping modules, tracing dependencies and returning file:line locations without modifying files.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# Explore Subagent (NHITL Autonomous Mode)

Dispatches targeted searches across the monorepo.
- Uses \`Bun.Glob\` and targeted regex.
- Never halts for human approval; reports structured file:line findings.
`;
  await writeContent("agents/explore.md", exploreAgent);

  const testRunnerAgent = `---
name: test-runner
description: Autonomous test executor running bun test, tsc and cargo gates with isolated error reporting.
tools: Bash, Read
model: sonnet
---

# Test Runner Subagent (NHITL Mode)

Executes repository gates and returns precise pass/fail diagnostics:
- \`bun test test/\`
- \`tsc --noEmit\`
- \`oxlint\`
`;
  await writeContent("agents/test-runner.md", testRunnerAgent);

  // Generate README.md
  const readme = `# Unified YOLO & Bun-TS7 Plugin

Generated directly by \`@aphrody/yolo-cli/plugin/generator\` from:
- **Bun Docs MDX**: \`vendor/bun/docs\` (${mdxPages.length} MDX files indexed)
- **Bun Core TypeScript**: \`vendor/bun/src\` (${bunCoreTsFiles.length} internal TS definitions)
- **TypeScript Engine**: Version ${tsVersion} (Native Corsa Go compiler)
- **Execution Doctrine**: YOLO Non-Human-In-The-Loop (NHITL)
`;
  await writeContent("README.md", readme);

  return {
    pluginDir,
    filesGenerated,
  };
}
