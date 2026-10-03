<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Hub CLI integration

The canonical `aphrody model hub` parser dispatches directly to the native
`aphrody-models::hub::Hub` owner. It adds no separate catalog, cache or downloader.
These source commands require rebuilding/installing the existing CLI; their
presence in an already-installed binary has not yet been established.

```sh
aphrody model hub search --kind model --query embedding --limit 20 --json
aphrody model hub search --kind dataset --query manga --format markdown
aphrody model hub info owner/repository --revision main --json
aphrody model hub runtime owner/space --json
aphrody model hub auth --credential-key HF_TOKEN --json
```

Metadata discovery is anonymous unless `--credential-key` selects the name of
an existing `EnvSecretStore` key. The process environment is read through the
existing secret-store owner; a missing or invalid selected token does not fall
back to anonymous access. Supply key names only, never credential values in
arguments or repository files. No credential provisioning or new store is added.

`auth` defaults to the existing `HF_TOKEN` key and emits only provider and
verification status. A missing or rejected identity yields `verified: false`
and a nonzero exit code. Network failures also remain unverified. It never
returns token bytes or the private profile from the upstream identity response.
No real provider identity has been verified in this batch.

Search limits are bounded to 1–100 by the parser and native owner. Repository
metadata retains the official model/dataset/Space fields through serialization
of the matching upstream metadata type. All output formats and file destinations
reuse the existing model command's report contract. Search/info/runtime are
read-only; they acquire no weight or dataset payload. Hub commands default to
JSON when no output format or destination is selected; explicit formats and
the existing destination-extension inference remain available.

Encrypted-store selection, safe interactive credential capture, live identity,
installation and generated help refresh remain qualification work. Existing
Google authentication commands retain their owner and contract.
