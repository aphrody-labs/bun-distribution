# Start here

Read AGENTS.md, GOAL.md, PLAN.md and MEMORY.md.
The [session report](docs/SESSION-REPORT-2026-10-13.md) records the delivered
artifacts, correction stages and remaining qualification gaps.

This checkout assembles the distribution. Runtime changes belong to the
existing Bun checkout; the Material framework belongs to the configured
Material workspace. Other fork owners retain their repositories and licenses.
README.md contains product usage. PLAN.md distinguishes prepared recipes
from executed artifacts.

## Entry points

- Source topology: sources.lock.json and [source export](docs/SOURCE-EXPORT.md).
- Profiles and target ABIs: distribution.json.
- Distribution factory: src/cli.ts and src/distribution.ts.
- Ubuntu factory: factory/ubuntu.ts and factory/profile.json.
- Kernel/WSL/APT recipes: [native targets](docs/NATIVE-TARGETS.md).
- Package/source conversion: src/apt.ts and packages/package-converter/.
- Standalone compiler and assets: [app builds](docs/APP-BUILDS.md).
- Public routing: [app domains](docs/APP-DOMAINS.md).
- Control plane and workflows: [deployment control](docs/DEPLOYMENT-CONTROL.md).

Start with the native help and read-only plan:

```sh
bun src/cli.ts --help
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
