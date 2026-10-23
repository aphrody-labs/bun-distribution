# @aphrody/replica-skills

This private workspace package ships the complete Replica workflow collection
with Bun OS: architecture, backend, brand, build, deploy, design, diff,
entrepreneur, launch, recon and test. Its skills are exposed as MCP resources
and prompts by the product `bunos mcp` server.

The skills come from Replica by Jake Schincariol
(https://github.com/Jakeschincariol/replica-skill), MIT licensed. `LICENSE`
keeps the upstream notice and `UPSTREAM.md` records the compared commit and
the Bun OS changes. Retain both when moving or redistributing these files.

This is the canonical copy. The REA submodule (`vendor/rea/plugin/skills`)
still carries an older copy of the same eleven skills next to the
reverse-engineering skills that only REA ships, so its skill root stays on
`BUN_MCP_SKILLS_PATH`. Bun MCP lets a later root replace an earlier skill of
the same name; `bunos mcp` (`src/cli/commands.ts`) and the product
qualification (`factory/product-qualification.ts`) list this package after
REA, so these skills win. Edit them here, not in the submodule.

## Bun-native tools

The skills call Bun, not Python. The original standard-library Python tools
stay beside their skills as the upstream reference.

| Skill                  | Command                                         | Source                                   |
| ---------------------- | ----------------------------------------------- | ---------------------------------------- |
| `replica-design`       | `m3-design contrast replica/design/tokens.json` | `packages/m3-design/src/contrast.ts`     |
| `replica-diff`         | `m3-design parity replica/features.csv`         | `packages/m3-design/src/parity.ts`       |
| `replica-diff`         | `m3-design imgdiff original.png clone.png`      | `packages/m3-design/src/imgdiff.ts`      |
| `replica-brand`        | `bun sweep.ts . --config replica/brand.json`    | `skills/replica-brand/sweep.ts`          |
| `replica-launch`       | `bun listing.ts replica/launch/listing.json`    | `skills/replica-launch/listing.ts`       |
| `replica-entrepreneur` | `bun reviews.ts replica/reviews.csv`            | `skills/replica-entrepreneur/reviews.ts` |

`m3-design` runs as `bun run bunos design` from a Bun OS checkout root, or as
`bunx @aphrody/m3-design` elsewhere. The design tools are also served by the
M3 tool host as `m3_contrast`, `m3_parity` and `m3_imgdiff`. The skill-local
scripts use only Bun built-ins and run from the skill's folder, so an
installed copy of a skill keeps working outside the checkout.
