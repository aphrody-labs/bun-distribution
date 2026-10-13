# Aphrody / Bun control

The canonical deployment owner is Aphrody Infra. Its service, port and route
catalogs own the desired state; this directory contains no host registry or
copied Compose files.

Resolve the Aphrody checkout from workspace configuration, then use
`aphrody infra --root <checkout>`. The current native owner remains available;
the requested `workspace/config` relocation is not yet present.

Source configuration lives in the Aphrody repository:

- `tools/config/service-catalog.json`: services and capability reservations.
- `tools/config/production-topology.json`: host port allocation.
- `tools/config/host/apps/vps`: the single Compose project and its app includes.
- `tools/config/host/nginx/routes.json`: public routes.
- `tools/config/host/nginx/aphrody/control.aphrody.app.json`: typed ingress.

See [control plane](../../docs/control-plane.md) for qualification and limits.
The [qualification receipt](qualification.json) contains sanitized live CI and
mirror evidence; it declares no host policy or credentials.
