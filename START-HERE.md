# Start here

Read AGENTS.md, GOAL.md, PLAN.md and MEMORY.md.

This checkout assembles the distribution. Runtime changes belong to the
existing Bun checkout; the Material framework belongs to the configured
Material workspace. Other fork owners retain their repositories and licenses.
README.md contains product usage. PLAN.md distinguishes prepared recipes
from executed artifacts.

## Entry points

- Source topology: sources.lock.json and [source export](docs/SOURCE-EXPORT.md).
- Profiles and target ABIs: distribution.json.
- Distribution factory: src/cli.ts and src/distribution.ts.
- Primary Arch/pacman factory: factory/arch/, factory/profile.json and
  [distribution architecture](docs/architecture/arch-distribution.md).
- Ubuntu compatibility factory: factory/ubuntu.ts and factory/ubuntu-profile.json.
- Kernel/WSL/APT recipes: [native targets](docs/NATIVE-TARGETS.md).
- Package/source conversion: src/apt.ts and packages/package-converter/.
- Standalone compiler and assets: [app builds](docs/APP-BUILDS.md).
- Public routing: [app domains](docs/APP-DOMAINS.md).
- Control plane and workflows: [deployment control](docs/DEPLOYMENT-CONTROL.md).

Start with the native help and read-only plan:

```sh
bun src/cli.ts --help
bun src/cli.ts factory --action plan --composition server --snapshot 2026-10-16
bun src/cli.ts graph --composition server
bun src/cli.ts plan --profile full --target linux-x64
bun infra/app-build.ts plan apt --config infra/apps.json --target windows-x64
```

Use explicit existing checkout paths in a local configuration. Paths resolve
from that configuration; the runtime owner can also be discovered from the
selected executable. Choose fresh artifact outputs and the existing host lock.
Do not treat a snapshot's reported release URL as archive authentication or
as a build from the distribution's locked runtime revision.

Inspect permissions, running jobs, storage and current coordination
before starting a factory operation. Never start workstation WSL, confuse
the VPS with the local MCP context, or delete protected .local/provider stores.

---

Read AGENTS.md, GOAL.md and PLAN.md. Install our Bun 1.4.4 runtime.
Run `bun run setup`, then invoke `bun check`, `bun lint`, `bun fmt` and
`bun n2b` directly as documented in README.md. Native binaries require
separate host qualification.
