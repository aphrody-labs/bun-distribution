# Source private network

The Aphrody Infra capability owner delivered the active Source authentication
and Cloudflare private network configuration in
[958e774411](https://github.com/aphrody-labs/aphrody/commit/958e7744115e186a40ad5ebb5d1e69bbfd8112ce).
Its source remains with that existing owner during flat crate migration.

- The complete `10.200.77.0/24` has a Cloudflare Tunnel route, precise WARP split
  routing, owner enrollment and private Source DNS.
- Source automatically signs private tunnel peers in as `aphrody-dev`. HTTPS and
  profile access pass from `.3` and `.4`; public forged identity headers are denied.
- The existing Gitea service, Cloudflare connector mesh, Nginx and certificate
  renewal owners are reused. Public ingress and protected credentials are preserved.

No WARP client is installed or enrolled on the workstation. Windows elevation
and sufficient disk space are required to complete the browser connection through
Cloudflare. Peer `.10` is not observed reachable. Configuration of the whole route
does not qualify every host or an actual WARP client connection.

This delivery does not activate the Bun OS product server or its pending API
route. Those activation boundaries remain separate from forge authentication.
