# M3 and Google search publication evidence

Verified on 2026-10-11 through the [existing Downloads publication workflow](public-google-search.md). This record qualifies the actual M3 artifact and the VPS Downloads service activation. Anonymous Google results and the full Bun runtime release remain unqualified.

## Immutable source and artifact

The final clean build used Aphrody `1823790960f0f75de244041fbc704e44c93370a9` and Bun `8e96fabf86100a479f4f8807537f4d9ffcfed4c1`. The Bun commit was pushed to the existing `origin/main` after an ancestor check. The publisher prepared the real Tauri JS owners, identity sprite and checksum-pinned fonts before building M3 with `--build --public-assets` through `bun bd -j1`.

The manifest verified 616 payload files, totaling 28,686,520 bytes. It pins the transferred source commit `4b83ea7f6c2727d67c30d4942501e5b831e559dd`, transfer receipt SHA-256 `686103d938df5f82b51df34f53c1816dd2b6a62580f34d929ed08b78ba6d45d6`, and docs catalog SHA-256 `0feff88bb064abd78ca093d5e9ad9edaefd8fc2a090c883b148588d51ea7819d`.

The build archive SHA-256 was `f10b10f750db5631deec8dac70a78fd783c6be8acb4157ea0a241ea14bc4ff24`. The apply workflow repacked the same verified payload; its uploaded archive SHA-256 was `090aaccff77370ba9170c0c2a56cf6a94e0f4b156b7317a57ff40ee70c378ea5`. Archive metadata can change the tar checksum; source pins and payload checksums remain the verification contract.

## Activated Downloads service

Native Infra SSH/SFTP activated `app-ui-1823790960f0f75de244041fbc704e44c93370a9` on the cataloged VPS, under `aphrody-downloads.service` on loopback 8797. The SDK module and its nonsecret environment follow the UI's `app-ui/current` symlink. The owner executable is explicitly configured; no credential store, account session or browser profile was transferred.

| Verified bytes               | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| Activated server             | `f02ec3cc35ebe6b7d579a4e9050b92469cf687f19b66898b7818199963352bd0` |
| Activated Google SDK         | `9fcc8f5565ae1e3b0a470bca6195a675fe0d266d6f62f14eb9131623270a8c52` |
| Actually served M3 app.js    | `f8817a9fa8be2ea45544eb4f38991a92440e59ecafaa97442be839c3c5113b3b` |
| Retained prior server backup | `c1a6458707252e302e4679d021258ecdb40b8d5092c5ebbb3d5b74f2c9e22fba` |

The existing publisher guarded the old server checksum, verified the uploaded archive and every payload checksum, retained the server/declaration/current-pointer backups, and used its rollback trap during activation. It restarted only Downloads. Post-activation health, homepage and OS checks passed, including the unavailable privileged-RPC declaration. The served JavaScript hash matched the built artifact. Nginx and DBFR were not modified by this transaction.

For a subsequent rollback, use the reviewed publisher rollback command from the activation receipt. It verifies the retained server checksum before restoring the server, prior UI current pointer and deployment declaration, then restarts Downloads. Preserve that backup until the replacement release is qualified.

## Search and public routing boundary

With the declared site Host header on loopback 8797, `safe=off` returned HTTP 400. A valid anonymous French web search returned HTTP 503 with the redacted unavailable message. The source route and SDK are active; live Google result retrieval is still blocked. No fabricated results, credential discovery or implicit browser fallback was introduced.

A separate Windows DNS/HTTPS probe resolved `aphrody.com` to `51.77.147.152` and received HTTP 200 for the homepage. Read-only Nginx inspection still found the apex proxy targeting the separately owned DBFR service on port 18803. Its search query with `num` returned HTTP 400 for an unsupported field; a compatible anonymous SafeSearch query returned HTTP 502. These public responses qualify neither the new Downloads search route nor Google availability. Public routing requires a coordinated change by that route's owner.

## Gates and retained receipts

The publisher passed 11 native tests, including actual ESM/CJS/declaration output, rejection of a real TypeScript type error, selected-runtime child execution and bounded compiler diagnostics. The actual Tauri API builder produced 20 entries. Strict TypeScript, scoped lint, format and whitespace checks passed. The final clean build and guarded activation both exited zero.

Machine-local receipts are retained in `.coord/public-m3-google-final-artifact-receipt.json` and `.coord/public-m3-google-activation-plan.json`. They record the real source pins, hashes, activation result, verified backup and public routing boundary; they are not committed build output or credentials. Recheck service state, DNS, routing and upstream availability before making a newer production claim.
