# Root forge transport

The Aphrody Infra owner provisions the existing `vps` and `bun-forge` SSH aliases,
owner identity and protected known-host store. The root product reuses them.
No private key, global SSH configuration or third-party known-host entry is
created or changed by this script.

```sh
bun scripts/forge-transport.ts plan
bun scripts/forge-transport.ts configure
```

`plan` is read-only. It requires the native OpenSSH client, an existing
`bun-forge` alias targeting `git@127.0.0.1:29022`, and the exact ED25519 public
key already recorded by Infra. The pinned fingerprint is
`SHA256:M48ORSUT/TU1sYsWPunaXwQliH0bUVRviGx7m4gWOAs`.

`configure` additionally requires this script to match its committed Git blob
and a successful read-only lookup of the private `bun-crate-craft-fonts` branch
with the owner's existing identity. Its `os` revision must equal the root's
committed `crates/craft-fonts` gitlink. HEAD must remain unchanged during
qualification. Only then
does it write a dedicated public SSH configuration under the Git common
directory and set repository-local `core.sshCommand`. Repeating the same
configuration is idempotent; conflicting existing configuration is rejected.
The exact previous generated content with reversed proxy-option order may be
replaced in place; its header alone is insufficient to establish ownership.
No backup copy is created.

On native Windows the dedicated `Host bun-forge` uses an explicit native
OpenSSH `ProxyCommand` through `vps`, followed by `ProxyJump none`. OpenSSH
requires this order so that `none` does not suppress the proxy command. This avoids Git's
implicit ProxyJump command being interpreted as `exec ssh` by PowerShell.
The existing owner's configuration supplies the identity and the `vps` route.
On Linux it retains the existing Infra routing. Both platforms require batch
authentication and strict ED25519 host-key verification. Other hosts retain
their existing owner configuration.

The script does not initialize, update or recheckout gitlinks. Run setup only
under its existing workspace ownership contract; configuring transport does
not authorize replacing active submodule work. CI uses the separately owned
runner transport documented in `CI-TRANSPORT.md`.

After writing, `configure` checks the generated effective `ssh -G` routing and
performs another private branch lookup through the actual repository-local
`core.sshCommand`, without a command-line override. Environment SSH overrides
are rejected. That lookup must equal the committed gitlink and HEAD must still
be unchanged before `configured=true` is reported. A failed gate exits with an
error and does not claim qualification of any private submodule.

Source qualification covers types, lint, formatting and the read-only plan.
An actual `configure` and subsequent private submodule fetch must be qualified
after this source is committed. Root mirror publication and visibility belong
to Infra and do not condition this local crate transport. This source
delivery makes no claim that those mutations or fetches have occurred.
