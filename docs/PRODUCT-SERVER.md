# Unified product server

The root product owns one server package, `@aphrody/bun-app-host`. Its
transport policy also serves compiled native applications. Aphrody Infra owns
machine identities, protected secrets, service activation and reverse-proxy
routes. The source portal remains `https://source.aphrody.app` on that owner.
This package does not deploy a second forge or infrastructure service.

## Run and build

From the root checkout:

```sh
bun packages/bun-app-host/src/cli.ts serve
bun packages/bun-app-host/src/build.ts catalog
bun packages/bun-app-host/src/build.ts build
bun packages/bun-app-host/src/cli.ts verify build/apps/bun-os-server
```

Infra injects `APHRODY_APP_TOKEN` from its protected store; it must have at
least 32 characters. `HOST` defaults to loopback and `PORT` to 3000.
The CLI does not accept a secret argument. The compiled executable embeds the
sanitized catalog and runs without Git, Cargo or the source checkout.

Compilation uses the shared Bun artifact compiler, the exact configured host
runtime pin, committed input sources, and a 30-second bounded child process.
Unrelated concurrent work remains untouched and does not block compilation.
Outputs default to `build/apps/bun-os-server` (`.exe`
on Windows); use a fresh explicit output as the third argument when necessary.
Manifests, catalogs, build/compiler owners and every actual bundled input must
match their Git blob at the captured root HEAD. Git's normal checkout filters
are honored; raw SHA-256 checks also prove those exact working bytes remain
unchanged. Only the generated staging entry is exempt from Git membership, with
its own before/after checksum. The emitted source graph must contain no unproven
input, and root HEAD must remain identical throughout compilation. A neighboring
JSON receipt records source/runtime/artifact identities and per-input Git blobs.
Uncompiled native engines and runtime source checkouts are not build inputs;
their catalog pins do not establish build provenance. Compilation does not qualify service
activation. Native engines are compiled separately by their existing owner.

## API routes

| Route | Owner | Authentication |
| --- | --- | --- |
| `GET /healthz` | App host process | Public |
| `GET /api/v1/sources` | Workspace modules and distribution source lock | Bearer |
| `GET /api/v1/apps` | Infra app inventory and workspace hostnames | Bearer |
| `GET /api/v1/status` | App host runtime and catalog snapshot | Bearer |
| `GET /api/v1/owners` | Explicit API ownership map | Bearer |

The transport rejects mismatched origins and cross-site requests, permits no
catalog mutations, and returns no cookies, secrets, provider sessions, local
absolute paths or raw host configuration. Private repository entries are only
available after authentication. Unknown routes return 404; authenticated writes
return 405. Responses disable caching and MIME sniffing.

Sources carry their pinned revision and source license when known. A null
license refers callers to the source owner; it is not a license grant. Catalog
qualification values preserve the declared app inventory. Snapshot observation
and source revision are distinct from current process readiness or a fresh
native/deployment qualification. All Aphrody Labs mirror progress remains with
Aphrody Infra; this source lock is not an inventory of every mirror.

## Automated binary qualification

`@aphrody/bun-app-host/verify` exports `verifyProduct(binary, receiptPath,
{root, timeoutMs})`. The CLI exposes `verify [BINARY] [RECEIPT]` for the local
target host. Builder `build` invokes this owner after compilation, sharing the
30-second overall build deadline; it leaves `executed=false` if qualification
fails. A direct verification has its own maximum 30-second deadline.

Verification validates receipt shape, the artifact SHA-256, configured target
runtime provenance, committed input Git blobs and exact working-byte hashes.
It requires the recorded source commit to be an ancestor of the current root;
source HEAD, inputs, receipt and binary must stay unchanged during the gate.
Generated entry proofs are restricted to the owner staging path. An entry that
was already removed after compilation does not require a regenerated copy.

The shared process owner runs `--version`, then an isolated temporary loopback
server on a dynamically allocated port. Eleven HTTP gates cover readiness,
anonymous denials, authenticated catalogs/status/owner identities, unknown
paths, denied writes and origin rejection. Responses are bounded and never
printed; the ephemeral bearer is generated in memory and passed only through
the child environment, never arguments or disk. Both success and failure close
the owned process tree. No service or proxy is activated by verification.

Only passing gates and unchanged source/artifact proofs set `executed=true` and
record the HTTP count. Existing deployment qualification is preserved. The
CLI prints only source/runtime/artifact identities and gate totals; it never
dumps private catalog responses or the bearer.

## Windows qualification, 2026-10-13

The fresh candidate `build/staging/server-d2-verified.exe` passed all eleven
HTTP gates and its version/source/runtime/artifact checks. Its receipt records
source `efa6ccb6a82125c6109d7090364d38f7dece9989`, runtime
`d2ff37699e391e8e271fc877e9bcc81cdc49fa82` and artifact SHA-256
`137cb093ead1efa1d47627a322604959da11fa99dda2a51993c71197c706aa8b`.
It is compiled and executed, with deployment false.

Automatic approval review rejected the proposed replacement of the canonical
`build/apps` and `install/bin` binaries before execution, reporting only
`blocked by policy`. The qualified candidate therefore remains in staging;
the installed binary retains the earlier runtime
`cb64a09ae6dd618efc300c39b9b03ccfa861cac2` and SHA-256
`0816173e335eff2308929f0c10e043912c0d65d11fb5812d36415d7be95c8325`.
An earlier review also rejected service activation. Neither this candidate
qualification nor the source portal's HTTPS readiness proves that the product
service or its public proxy routes have been activated.

A later invocation through `bun-os server verify` correctly refused this
candidate after the concurrent canonical owner changed
`packages/bun-workspace/src/process.ts`. The eleven passing gates above remain
evidence for the recorded source snapshot; they do not qualify the subsequent
working source. Rebuilding against the final committed owner inputs is required.
