---
name: web-new-scraper
description: Scaffold a new aphrody web scraper package under packages/ with CLI integration, tests and docs.
argument-hint: <kebab-name>
allowed-tools: ["Write", "Bash", "Read"]
---
Usage: /web-new-scraper my-new-site

Steps performed:
1. mkdir packages/my-new-site
2. Create minimal package.json (name @aphrody/my-new-site, workspace dep on aphrody web if needed)
3. Create src/index.ts with the scraper logic skeleton + export for CLI
4. Add a CLI entry in src/cli/my-new-site.ts (export async function main(argv, baseOpts))
5. Wire the case in src/cli/index.ts and printUsage
6. Add basic test stub in packages/my-new-site/index.test.ts (unit, no live)
7. Update root README table if appropriate
8. Run the new verify to make sure it doesn't break scoping

Use the web-scraper-creator agent for the creative part and web-verify-enforcer for the rules.
