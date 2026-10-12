# Material 3

Monorepo for Material Design 3 components, tokens, themes, icons, and tools.

Packages are grouped directly under `packages/*`. Integrations remain decoupled
from the component model. `m3-bun` provides Bun commands for developing,
testing, serving, and packaging M3 applications.

## Layout

```text
packages/*  M3 packages
scripts/    workspace checks
docs/       design documentation
```

## Platform alignment

The shared contract follows the Material 3 theme model used by Android
Compose: color scheme, typography, and shapes. Web packages expose the same
semantic roles through CSS tokens and web components. See
[`docs/platform-alignment.md`](docs/platform-alignment.md).

## Development

```powershell
bun install
bun run list
bun test
```
