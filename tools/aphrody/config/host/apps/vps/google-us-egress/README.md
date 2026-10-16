# Scoped Google US egress

This deployment reuses the VPS's existing Mullvad WireGuard credential and
native `ip`, `wg`, `nft`, `microsocks` and systemd owners. It creates
`aphrody-google-us` with an independent VPN interface and private veth pair.
The credential remains a root-owned regular file with mode `0600`; neither
its contents nor account tokens are copied into source or logs.

The existing Japan namespace and port `1080` remain separate. Google US SOCKS
is available only on VPS loopback `127.0.0.1:1081`, bridged to its private
namespace endpoint. Namespace firewall rules permit the proxy port only from
the exact host veth peer. The host default route and `wg1` are retained.

Stage the public Linux deployment files through the existing pinned owner SSH
route, check their source hashes, and run `sudo bash install.sh <private-stage>`.
The installer refuses existing targets, namespaces, interfaces, ports and
subnet collisions. It validates the explicit device address against the existing
Japan device metadata, verifies shell/unit syntax and starts the independent
units. Failure rolls back only the newly owned namespace, interfaces and files.
It enables boot startup only after the US, Google TLS and Japan preservation
checks pass. A subsequent update requires a separate reviewed upgrade plan;
the fresh installer does not overwrite an existing installation.

On 2026-10-11, actual activation selected active official relay
`us-atl-wg-001`. Mullvad's HTTPS status endpoint reported `country=USA` and
`mullvad_exit_ip=true`. Google `generate_204` returned HTTP `204` with TLS
verification result `0`. The Japan endpoint remained `jp-tyo-wg-001`, with
`country=Japan` and a verified Mullvad exit. The host default route and Japan
relay-cache hash matched their pre-install values. Native unit validation passed,
and the independent namespace, SOCKS service and loopback socket were enabled.

An actual `bun ssh forward` command then exposed only local Windows loopback
`127.0.0.1:1081`; the same US and Google TLS checks passed through that forward.
The Windows forward is owned by the native `BunGoogleUSProxy` scheduled task.
Its actual principal is the current interactive user with limited privileges;
the action runs the single System32 Bun runtime through `conhost --headless`.
It listens only on `127.0.0.1:1081`. Native Task Scheduler auditing reports no
remaining correction, and the running task passed the US and Google TLS checks.
The task declares owner logon and restart on failure; reboot recovery has not
been tested. Remote units persist at boot.

The isolated `windows-catalog` contains exactly this one task. Apply or audit
it through the qualified native owner:

```powershell
& "$env:LOCALAPPDATA\Aphrody\bin\aphrody-infra.exe" --root C:\aphrody\tools\config\host\apps\vps\google-us-egress\windows-catalog boot --host local --json plan
& "$env:LOCALAPPDATA\Aphrody\bin\aphrody-infra.exe" --root C:\aphrody\tools\config\host\apps\vps\google-us-egress\windows-catalog boot --host local --json apply
```

The existing System32 Aphrody Infra artifact predates this native task owner;
its older plan emits PowerShell actions and does not qualify this deployment.
Use the verified owner above. The earlier PowerShell runner was removed after
the native task succeeded; it is not an alternate startup mechanism.

Use the scoped forwarding plan in `C:\bun\scripts\aphrody\google-egress.ts`.
No global proxy variables are set. Google clients accept an injected `fetch`
transport, but native Bun SOCKS fetch compatibility and authenticated Google
requests through that transport remain unqualified. This network receipt does
not establish account login, OAuth redirect registration or regional API access.

Relay selection uses the official
[Mullvad relay metadata endpoint](https://api.mullvad.net/www/relays/all/)
and accepts active US WireGuard relays only. API failure stops setup; it never
changes the existing Japan relay or silently substitutes another country.
