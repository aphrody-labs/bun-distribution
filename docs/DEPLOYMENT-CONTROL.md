# Deployment ownership

`infra/apps.json` is Bun OS's distribution app-build and asset inventory. It
declares target inputs, native package requirements, source revisions and
content-addressed asset roots. It is not a host-service or deployment catalog.
Library capability IDs and application hostnames come from the local
`@aphrody/bun-workspace` package. Bun OS owns target-specific build inputs,
source revisions and app artifact plans.

Bun OS Infra owns host services, Compose profiles, application routes and
standalone app activation through the imported native implementation in
`crates/aphrody-infra`. The root `infra/config/host/` catalog owns desired state.
The existing deployment workflow verifies and stages qualified artifacts before
service and route activation; it is not a second deployment executor.
Source migration does not activate services or expand host-specific permissions.

The separate Bun OS Forgejo/FerretDB Compose proposal was never deployed and
has been removed. Its image pins and qualification limits remain in the dated
[session report](SESSION-REPORT-2026-10-13.md) and Git history at
[the reporting revision](https://github.com/aphrody-labs/bun-distribution/blob/d99d98d445d17a35d7066d8921b591d28cc1c4ad/infra/control-plane.json).
The active forge, runner, Komodo services, routes and Cloudflare records were
not changed by this source consolidation.
