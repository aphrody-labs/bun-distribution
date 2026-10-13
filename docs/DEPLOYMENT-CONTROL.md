# Deployment ownership

`infra/apps.json` is Bun OS's distribution app-build and asset inventory. It
declares target inputs, native package requirements, source revisions and
content-addressed asset roots. It is not a host-service or deployment catalog.
Library capability IDs and application hostnames come from Bun Libraries'
`@aphrody/bun-workspace` owner; Bun OS keeps target-specific build inputs.

Aphrody Infra owns host services, Compose profiles, application routes and
standalone app activation. Its host catalog and [`git`/`deploy` routes](https://github.com/aphrody-labs/aphrody/blob/main/tools/config/host/nginx/routes.json)
are the canonical desired state. The native
[`aphrody infra deploy --stack app` workflow](https://github.com/aphrody-labs/aphrody/blob/main/docs/operations/infra/app-activation.md)
verifies and stages qualified Bun Libraries artifacts before service and route
activation. Bun OS prepares distribution artifacts and receipts; it does not
own another host registry, service stack or deployment executor.

The separate Bun OS Forgejo/FerretDB Compose proposal was never deployed and
has been removed. Its image pins and qualification limits remain in the dated
[session report](SESSION-REPORT-2026-10-13.md) and Git history at
[the reporting revision](https://github.com/aphrody-labs/bun-distribution/blob/d99d98d445d17a35d7066d8921b591d28cc1c4ad/infra/control-plane.json).
The active forge, runner, Komodo services, routes and Cloudflare records were
not changed by this source consolidation.
