# Native application activation

`aphrody infra deploy --stack app` binds a verified standalone application to
its existing service catalog entry. Aphrody Infra owns admission, protected
environment provisioning, systemd, loopback health and typed ingress. The
artifact package retains manifest, source/runtime and executable verification.

Run on the qualified host with its explicit canonical target:

```sh
aphrody infra --root "$HOME/src/aphrody" deploy --stack app --target vps --local \
  --id aphrody-app-video --source "$APHRODY_BUN_OS_CHECKOUT" \
  --build-report "$APHRODY_BUN_OS_BUILD_REPORT" \
  --bun "$HOME/.bun/bin/bun-1.4.4"
```

The default prints a verified plan. Add `--apply` for activation. Paths come from
the selected checkouts and host policy; explicit host selection does not imply
remote or local execution permission.

The adapter invokes `packages/bun-artifacts/src/cli.ts verify` from the Bun OS
checkout, stages the exact binary and sidecar under `~/apps/<app>/`, and invokes
that same validator again. The build report is emitted in the Bun OS checkout's
`build/staging/app-owner/<app>-<build-id>/build-report.json`; set
`APHRODY_BUN_OS_BUILD_REPORT` to the report for the requested application build.
Source-free native
doctor qualification is required. Catalog capability, host and listener bind
the receipt without maintaining a second application registry.

Library capability aliases share their canonical service ID in the route
catalog. Activation switches every hostname for that service together. Before
an alias can receive production traffic, both DNS and the origin certificate
must include its name. The live zone has the existing `video.aphrody.app` alias
but no `filmcraft.aphrody.app` record; the currently installed
`aphrody-control` certificate covers the 14 `app-*` hosts plus `git` and
`deploy`, not library aliases. Keep those aliases staged until DNS, certificate
renewal and live HTTPS qualification pass.

One `aphrody-app@.service` template runs every qualified application. App tokens
are created through the existing Infra secret owner in the protected app store;
existing protected tokens remain untouched. Persistent app data and native cache
stay in isolated directories. Tokens never appear in reports or argv.

Loopback health must pass before the matching HTTPS ingress changes. The typed
Nginx owner renders the configuration; other control domains, ACME routes and
staged applications retain their definitions. The canonical catalog gains its
unit only after successful host qualification.

Source changes do not upgrade the installed native CLI. Native Infra compilation,
target command qualification, source publication and service activation remain
separate delivery stages. This adapter presently qualifies Linux systemd hosts.
