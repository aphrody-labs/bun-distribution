# @aphrody/replica-skills

This private workspace package ships the complete Replica workflow collection
with Bun OS: architecture, backend, brand, build, deploy, design, diff,
entrepreneur, launch, recon and test. Its skills are exposed as MCP resources
and prompts by the product `bunos mcp` server.

The skills come from Replica by Jake Schincariol
(https://github.com/Jakeschincariol/replica-skill), MIT licensed. `LICENSE`
keeps the upstream notice and `UPSTREAM.md` records the compared commit and
the Bun OS changes. Retain both when moving or redistributing these files.

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
