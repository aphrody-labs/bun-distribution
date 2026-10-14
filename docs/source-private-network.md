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

Windows delivery is recorded in
[a61d18a6d4](https://github.com/aphrody-labs/aphrody/commit/a61d18a6d4).
Native WinClean and Windows UAC reclaimed old generated caches and expanded C:
to all allocatable SSD space, with 131.7 GB free at qualification. The B: SUBST
alias was removed; `C:\bun` source and current runtime outputs were preserved.
Cloudflare One Client 2026.8.2110.0 is installed and enrolled in `aphrody-labs`.
WARP reported Connected/unstable and private Source access failed; disconnecting
WARP restored HTTP 200 over the existing WireGuard path. It remains disconnected.
Private hostname DNS and native TLS pass. Peer `.10` remains unobserved reachable.
The configured whole subnet does not establish successful WARP client routing.

This delivery does not activate the Bun OS product server or its pending API
route. Those activation boundaries remain separate from forge authentication.
