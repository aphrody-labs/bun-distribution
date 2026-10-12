<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun applications with Aphrody M3

`@aphrody/m3` owns the Material 3 plugin and web build primitives.
`@aphrody/m3-bun` composes that plugin with the app API/file server, executable
compiler, packaging and deployment generators. These are two entrypoints of
one framework; `m3 compile` delegates to the same `compileApp` implementation.
See the [framework map](FRAMEWORK.md) and [integration plan](../../PLAN.md).

## Configure an application

The following imports are declared package exports:

```ts
// m3.config.ts
import { defineM3Config } from "@aphrody/m3/config";
import { defineM3Bun } from "@aphrody/m3-bun/config";

export default defineM3Config({
  entry: "src/index.html",
  theme: { seed: "#6750a4" },
});
export const bun = defineM3Bun({
  api: "src/api.ts",
  port: 3000,
  compile: { bytecode: true },
});
```

```toml
# bunfig.toml
[serve.static]
plugins = ["@aphrody/m3-bun/plugin"]
```

```ts
// src/api.ts
import { defineM3Api } from "@aphrody/m3-bun/api";

export default defineM3Api({
  "/api/greeting": {
    GET: () => Response.json({ greeting: "Hello" }),
  },
});
```

Use the built-in `/healthz` and `/api/m3/info` paths for health and app metadata;
avoid user API routes at those paths. `createM3App` exposes the portable fetch
handler and `startM3Server` starts Bun's native routes/file server. Their full
HTTP parity requires the additional cases recorded in the
[finalization receipt](../reports/FRAMEWORK-FINALIZATION.md).

## Run, build and package

From the application directory, with the workspace dependencies already installed:

```sh
m3-bun dev
m3-bun build
m3-bun serve
m3-bun compile
m3-bun smoke
m3-bun package
m3-bun package --json
m3-bun package --no-bytecode
m3-bun deploy docker systemd nginx
```

Development uses Bun HMR. Production serves the build directory and API from
one process. Compilation generates a server entry, embeds the UI files and
compiles it with Bun; it does not compile HTML into a server by itself. The
default bytecode output is configurable through `compile.bytecode`. Use
`--no-bytecode` to override it for one `compile` or `package` invocation.
`package --json` emits a stable release report with the archive, SHA-256,
checksums, staged files and compile/rootfs metadata. Windows packages use ZIP;
`zip.exe` is preferred and PowerShell `Compress-Archive` is the native fallback.

`compile.target` selects a supported Bun target. It does not establish that the
result runs on that target. Linux libraries/loader requirements must be included
in packaging and checked on the target; Windows metadata has host-specific
limits. `smoke` checks the executable's root, health and metadata responses.

Deployment commands generate configuration files. Applying those files,
provisioning hosts and activating services belong to Infra and require their
own authority and validation. No deployment or installation follows merely
from generating Docker, systemd, nginx or serverless configuration.

## Theme modules and hosts

The Bun adapter reuses `@aphrody/m3/plugin` and adds standalone token/font
resolution, `m3:icons/…` and explicit optional-module resolution through
`m3:optional/…`. Next.js uses `@aphrody/m3-next`; migration compatibility checks
belong to `@aphrody/m3-next-migrate`. A desktop/mobile webview consumes the
generated UI, while native permissions and process lifetime belong to its host.

See [the host plan](../plans/design/M3-MULTI-HOST-PLAN.md) for the qualification
matrix. A browser viewport or generated Tauri project does not establish an
installed mobile application.
