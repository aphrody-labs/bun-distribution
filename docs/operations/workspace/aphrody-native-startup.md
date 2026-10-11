<!-- SPDX-License-Identifier: Apache-2.0 -->

# Native Aphrody startup through Infra

The Infra runner `scripts/tools/infra/native-startup.ts` (Bun, Win32 through `bun:ffi`, no
PowerShell) validates the host declaration against
`tools/config/host/windows/aphrody-startup.schema.json`, plans, supervises and probes the
declared services. The hidden `\Aphrody\Native\<id>` task that runs it is a boot catalog entry
(`tools/config/service-catalog.json`, `boot.entries`) registered by `aphrody infra boot`. Neither
stops existing listeners, changes firewall/PATH, copies credentials or installs binaries.

## Configuration

Place the host configuration outside the repository in the configured Aphrody
home, with access restricted to the task owner. Select the actual installed native
binary paths; missing binaries produce disabled tasks, not placeholder services.
Example (replace paths/user/ports using the selected host's deployment catalog):

```json
{
  "version": 1,
  "home": "C:/Users/OWNER/.aphrody",
  "root": "C:/work/aphrody",
  "principal": { "userId": "HOST\\OWNER", "logonType": "Interactive", "runLevel": "Limited" },
  "trigger": { "kind": "logon" },
  "services": [
    {
      "id": "site",
      "kind": "site",
      "executable": "C:/release/aphrody-site.exe",
      "enabled": true,
      "bind": "127.0.0.1",
      "port": 0,
      "desiredPort": 80,
      "home": "C:/ProgramData/Aphrody/site",
      "principal": { "userId": "SYSTEM", "logonType": "ServiceAccount", "runLevel": "Limited" },
      "trigger": { "kind": "boot" },
      "arguments": [],
      "healthPath": "/health"
    },
    {
      "id": "mcp",
      "kind": "mcp",
      "executable": "C:/release/aphrody-mcp.exe",
      "enabled": true,
      "bind": "127.0.0.1",
      "port": 0,
      "arguments": [],
      "healthPath": "/mcp"
    },
    {
      "id": "a2a",
      "kind": "a2a",
      "executable": "C:/release/aphrody.exe",
      "enabled": true,
      "bind": "127.0.0.1",
      "port": 0,
      "arguments": [],
      "healthPath": "/ping"
    }
  ]
}
```

These ports are an example, not a reservation. Ports must be distinct and explicitly
declared. Port0 asks the child to let the OS allocate its listener atomically;
there is no free-port scan/release race. The wrapper discovers the actual listener
owned by its child PID, probes it, then atomically records
`<service-home>/run/native-services/<id>.json` with actual address/port/PID and
honest health status. Fixed ports must be distinct. `desiredPort:80` records the
blocked desired entrypoint while an explicitly configured loopback fallback runs;
it does not silently take over another listener or expose the service on80.

MCP/A2A literal IP binds must be loopback; only the read-only product
site can listen publicly. No `serve --app` is added to the public site. Additional
arguments cannot override listener flags. `{{home}}`/`{{root}}` placeholders may
reference configured directories; never put secret values in argv/configuration.

Each service may override the default principal/trigger. For the read-only site
boot task, explicitly select SYSTEM/ServiceAccount and a dedicated `home` whose
ACLs and installed binaries/root the deployment owner has qualified. Never use
the user's provider-profile home as its implicit SYSTEM home. MCP/A2A require
the user's Interactive/logon principal. S4U does not supply network credentials
or encrypted provider-profile access. ServiceAccount must be SYSTEM/LOCAL SERVICE/
NETWORK SERVICE; choose a separate qualified home and install/configure protected
stores for that principal without copying another principal's authentication.

If the existing MCP task is already the declared owner, add
`"existingTask":{"path":"\\Aphrody\\","name":"Aphrody MCP HTTP"}` to its
service declaration. The adapter validates its existence and preserves it exactly;
it does not replace, start or disable that task. Existing tasks need their already
declared actual port or their own compatible discovery metadata for health checks.

## Plan and apply

Run from the resolved repository root; the configuration defaults to
`<APHRODY_HOME|~/.aphrody>/host/aphrody-startup.json` (`--config <path>` otherwise):

```sh
bun --no-env-file scripts/tools/infra/native-startup.ts plan    # read-only rows, exit 1 on boot-entry drift
aphrody infra boot plan --entry site                            # the declared \Aphrody\Native\site task
aphrody infra boot apply --entry site                           # register/correct it (sudo.exe or UAC), start it
bun --no-env-file scripts/tools/infra/native-startup.ts health  # bounded HTTP probes
```

`plan` performs no mutation or service execution. Per service it reports readiness
(`declared-disabled`, `missing-executable`, `occupied-port` with the listener PIDs, `ready`),
the desired-port observation and the boot entry registering `\Aphrody\Native\<id>`, with its
drift from the declared principal (`ServiceAccount` SYSTEM: `system`; `S4U`: `user`;
`Interactive`: `user` + `desktop`, wrapped in `conhost --headless`) and trigger (`boot`:
`atStartup`; `logon`: `atLogon`). Services with `existingTask` are only checked to exist. The
boot entry runs `bun --no-env-file scripts/tools/infra/native-startup.ts run <id> --config
<path>`: `--no-env-file` keeps the checkout `.env` out of the service environment.

`run <id>` is invoked by its task. It refuses a service that is not ready, launches only the
selected native executable without a console, in a kill-on-close job object (stopping the
task or killing the runner stops the child), owns and waits for that child, and stops only
that child if activation cannot establish exactly one listener in 30 seconds. The registry
records `processStartedAt` with the 100 ns precision of `GetProcessTimes`, the identity the
gateway adapter compares. `health` uses PID-owned listener metadata for dynamic ports. It is
a bounded read-only HTTP probe. MCP GET `/mcp` may legitimately
require protocol headers/session/auth and return 4xx; this is reported unhealthy,
never treated as MCP tools/list qualification. A2A `/ping` and site `/health` must
return 2xx. Root must complete protocol-aware MCP/A2A smoke separately.

Live state (2026-10-09, owner PC): `\Aphrody\Native\site` runs as SYSTEM through this runner
(`aphrody-site.exe` on `127.0.0.1:36515`, `/health` 204); MCP reuses `\Aphrody\Aphrody MCP HTTP`.

## Current blockers and Linux

The coordination observation records Windows port80 occupied by Docker/wslrelay
(PIDs7156/39044); inspect live state before activation. This runner never stops
them. The currently installed `aphrody` may lack `site`; use the qualified native
`aphrody-site` artifact. Installed `aphrody-mcp http --bind` and `aphrody a2a serve
--bind` are real owner commands, verified by live help on2026-10-09.

Linux uses the existing Infra systemd/service and Nginx catalogs, with a qualified
native `aphrody-site` release, an explicitly configured repository/template asset
root and protected home. Site can bind a declared loopback upstream port behind
Nginx80/443; MCP/A2A stay loopback or the declared authenticated private transport.
The Windows runner does not create Linux units or alter Nginx. Root must add
and apply those declarations through the existing Infra release/host workflow.
