# Bun OS product API service

Aphrody Infra owns this one staged service through the existing service catalog,
systemd supervisor and source forge ingress. Gitea remains the only forge.

Qualified on 2026-10-13: the canonical Git checkout `~/src/bun-os` is root
revision `1e5c6435ffdb13d1aff8db1eb432033df00fd3af`, bootstrapped from the
public GitHub source while its canonical Gitea mirror resynchronized. Anonymous mirror refs were then
verified equal, and origin now selects the existing public loopback Gitea mirror. No archive,
Rust build or recursive submodule setup was used. Filtered frozen Bun installation
selects only the server SDK graph; the unrelated Tauri checkout remains lazy.

The installed Linux runtime is `/home/ubuntu/.bun/bin/bun-1.4.4`, revision
`dfde053a3045d6076ad315b6f63160c4ced71513`. The real ELF x86-64 server
compiled under the shared Bun compiler, executed `--version`, and passed
seven local HTTP contract checks. SHA-256:
`9daadd110d9c4792ebf6e1bb3fb03d13902a336ed8ab5b920d3a2091c20b6649`.
Its receipt is `~/src/bun-os/build/apps/bun-os-server.json`, with executed=true
and deployed=false. The temporary probe process was stopped after qualification.

## Activation contract

Infra installs the qualified binary at `~/src/bun-os/install/bin/bun-os-server`;
its single unit binds loopback29030. Inject `APHRODY_APP_TOKEN` only from
`~/.aphrody/secrets/bun-os/server.env` (protected directory and file; no value
belongs in Git or command arguments). A persistent bearer was generated idempotently in this protected store. Infra
secret validation reports SECURE (1/1); directory0700 and file0600 are verified. The catalog remains staged and not required at boot.

Integrate `nginx/snippets/bun-os-product-api.inc` into the existing source
TLS server only after service and proxy probes pass. Its external prefix is
`/api/product/v1/`; it rewrites to the server's `/api/v1/`. Gitea retains
`/api/v1/`, repository paths and homepage. No new vhost or forge stack is
introduced. The bearer header is preserved. Public proxy/TLS origin policy
must be qualified against the app-host transport before activation.

The typed Infra catalog, repository registry and internal-only port policy all
carry this source/service owner. Systemd candidate verification and Nginx candidate syntax checks pass. Automatic
tool review rejected the grouped unit/snippet installation, manager reload and
Infra service start before execution, with reason `blocked by policy`. No
equivalent activation retry was attempted. The actual unit is inactive; route
inclusion and service activation remain pending. Prepared files and the installed
binary are not deployment proof.
