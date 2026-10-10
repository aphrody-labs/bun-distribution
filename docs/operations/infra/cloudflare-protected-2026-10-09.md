<!-- SPDX-License-Identifier: Apache-2.0 -->
# Protected Cloudflare provider activation, 2026-10-09

The owner-provided bootstrap bearer and issued native credential remain isolated under the configured Aphrody home `auth/cloudflare/owner-token.dpapi` and `native-token.dpapi`, encrypted with Windows CurrentUser DPAPI. The directory allows only the owner and SYSTEM; files inherit that protected ACL. No user/machine token environment is persisted, credential value is logged, repository credential is created or previous token revoked.

`scripts/tools/infra/cloudflare-protected.ps1` supplies the bearer only in an in-memory HTTPS header, with a 30-second deadline. Default Audit uses the issued native token. Explicit CreateOwnerToken uses the preserved bootstrap and refuses duplicate issuance/overwrite. Reports persist only public resource IDs, counts and statuses. Configuration is declared in `tools/config/cloudflare-auth.json`.

## Qualified scope and live evidence

The owner account is `ca22c1a51a145f919b54afa18d936516`; the `aphrody.com` zone is `963461271f885bc3f3c2bfd586f2b7ba`, currently pending. The provider returned 413 selectable permission groups. The new token `cdab136c224c93adbad330b469cd5783` grants 399 supported standard user/account/zone groups on the verified owner user, exact account and its zones. Groups are split into policies of at most 300 as required by the provider.

Cloudflare rejects sub-token permissions to manage other tokens (API error 1001), so four API-token management groups remain only on the bootstrap credential. Ten specialized bucket/script/app scope groups were not assigned guessed resource policies. This is the broad permitted standard owner scope, not a claim that all 413 groups are granted. No subscription or paid-resource creation occurs.

The issued token verifies active, reads both R2 buckets and 25 Cloudflare DNS records successfully. Actual values are not persisted in reports. The zone remains pending: no nameserver, DNSSEC, mail or zone mutation was performed by this batch. The domain owner retains the separate reviewed migration catalog.

## Official plugin and remaining limits

The official Cloudflare plugin 1.0.2 is already enabled in the owner's Codex configuration. Its public `.mcp.json` declares the distinct remote provider endpoint `https://mcp.cloudflare.com/mcp`; no deprecated Yolo/kernel alias or local Aphrody MCP replacement is configured. No Cloudflare tool is callable in this turn, and the remote plugin's OAuth/session activation is not established by storing an API token. Its existing manifest and provider history are preserved.

Cloudflare documents Global API Key retrieval through the dashboard's User Profile / API Tokens / View flow. The bearer token API creates tokens, not a Global API Key. No key rotation or dashboard challenge bypass was attempted. See [official token creation](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/), [Global API Key retrieval](https://developers.cloudflare.com/fundamentals/api/get-started/keys/) and [official provider MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/).

PowerShell parsing, isolated ACL inspection, live token verification and real R2/DNS reads qualify the provider wrapper. Plugin callable/OAuth activation remains an explicit qualification limit.
