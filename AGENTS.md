# Bun OS

Write project documentation in English. Follow the owner's requested language
for replies; the current request asks for French. Read GOAL.md, PLAN.md,
MEMORY.md and START-HERE.md before changes. Preserve concurrent work.

This checkout owns distribution assembly. The canonical runtime remains
aphrody-labs/bun on main in its existing checkout. Material owns the native
Material framework, tokens, libm3 and its WASM binding. COSMIC, libcosmic,
Linux, WSL, WSLg and APT retain their owners, histories and licenses.
Resolve paths from explicit configuration, the selected checkout or the
installed executable. Never hardcode a workstation checkout path in code.

Follow Linux kernel, Debian, COSMIC and Bun upstream conventions; read
docs/CODING.md. Use the installed Aphrody Bun runtime and its native tools.
Confirm APIs in primary sources. Use bun n2b for migration review and
native bun check, bun lint and bun fmt for authorized gates. Do not invoke
separate OXC, TypeScript, Node or Python commands for this workflow.

Use native Windows on the owner workstation; never start WSL there.
SSH, Docker and native hosts are distinct execution contexts. Use bun ssh
for the VPS. Bound long jobs asynchronously, retain PIDs/logs/receipts, and
use ConnectTimeout=15 and BatchMode=yes. Serialize heavy work through the
existing host lock. The Ubuntu factory keeps its state, socket, logs and
temporary files on its qualified build filesystem. Preserve active Shenron
restoration, services, sources, unpushed work and protected data.

The current objective unifies Bun OS, Bun Libraries, Aphrody and the Bun fork
in the selected src workspace. Consolidate infrastructure, builds, factories,
quality gates, documentation, plugins, sites, domains, distribution and owners.
Reuse qualified implementations; preserve repository histories and concurrent
work. The earlier reporting-only phase and temporary resource hold have ended.

Keep authentication, raw provider sessions, cookies, databases, model weights
and protected .local stores isolated. Do not synchronize provider stores or
configure deprecated MCP aliases. Our measured 50 GB cleanup was on the SSH
VPS; it does not authorize workstation media or episode deletion.

Use Cloudflare MCP for account/domain mutations. aphrody-app is the existing
public edge owner for the application domains. Preserve the homepage, www,
existing services and R2 custom domains. A DNS/HTTPS response qualifies routing;
it does not qualify an independently deployed native application.

Reuse capability owners: exportPinnedSources for source export, the qualified
artifact package for standalone apps, the canonical bun-cloudflare client for
R2/authentication, and package-converter ABI helpers. Shared process lifetimes
and streamed hashes come from @aphrody/bun-workspace. Native Aphrody Infra owns
hosts, services, control-plane deployment and app activation. Existing adapters
remain until their replacement preserves their contracts and passes its gates.
Keep target/runtime and ABI versions distinct. Qualify source, binary, package,
desktop, image, WASM, performance and publication independently.
Do not add or run tests unless the owner requests them.
