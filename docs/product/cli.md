# Bun OS product CLI

The root `bunos` command is the product entry point. It routes to the existing package owners so installed commands and workspace source share one implementation.

## First-party commands

- `bunos design <query> --stack m3` searches UI/UX Pro Max against the M3 product stack. Add `--design-system` to generate a design-system artifact. `bunos design compile --prompt <brief>` invokes the canonical M3 compiler, HCT theme generator and self-critique. The full searchable catalog and references ship inside `@aphrody/m3-design`.
- `bunos engine <command>` runs Bun Engine operations such as `probe`, `build`, `run`, `compile`, `web` and `frontend`.
- `bunos re <arguments>` runs the Bun OS RE facade; `bunos rea <arguments>` runs the canonical REA CLI. Use `bunos rea mcp` to start REA's standalone MCP server.
- `bunos mcp` starts the native Bun MCP server. It exposes UI/UX Pro Max plus all eleven Replica workflow skills as resources and prompts, alongside Bun's native tools and skills.

The root workspace directly depends on M3 Design, Bun Engine, Bun OS RE and REA so package installation resolves these owners with the product. The UI/UX guidance uses the canonical M3 token, theme and component packages for Bun OS and Aphrody Labs interfaces.

## Workspace inventory

Use `bunos workspace inventory` for the read-only catalog of Cargo/Bun manifests, source owners, revisions, physical locations and migration state. It separates package members from fixtures, vendored inputs, unavailable sparse checkouts and source submodules; do not treat every manifest under `vendor/` as a product package. At this checkout the scan reports 3,640 manifests (2,052 Cargo and 1,568 Bun), including 682 root Cargo members and 532 root Bun members. See `docs/SOURCE-WORKSPACE.md` for the source-owner inventory contract.
