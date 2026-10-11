<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Windows installation from R2, 2026-10-09

The product setup now uses the owner's public `aphrody-dist` R2 schema for its default native runtime step. An explicit access-pack `downloadsBase` keeps the existing legacy catalog workflow. Desktop installer/plugins retain their own published-artifact contracts. No custom domain or namespace delegation is activated by this change.

## Public product contract

Base: `https://pub-2a25b78efa294362ad9d988bb2deffeb.r2.dev`.

| Product | Objects | Declared SHA-256 |
| --- | --- | --- |
| Bun | `bun/manifest.json`, `bun/SHA256SUMS.txt`, `bun/bun-windows-x64.zip` | `308eefcea95ea02f3efd47c29b944840130332b4f0cab71b5e1fa9694ad6eb0b` |
| Aphrody | `aphrody/manifest.json`, `aphrody/SHA256SUMS.txt`, `aphrody/aphrody-windows-x64.zip` | `4161f5af327bba421b396d6fcba6ce28275009ea4ca43c632adf2b17a95d2380` |

Native public GET verifies the live manifest/checksum contract. Bun declares `1.4.3-aphrody.3`, revision `1.4.3-aphrody.3+d46f0ed6c`; Aphrody declares `aphrody 1.0.0-canary`. These are provider-hosted integrity metadata, not independent signed build provenance.

## Installer behavior

`packages/infra/product/src/setup/r2.ts` validates product/platform identity, exact archive name, allowed binary paths, unique safe aliases and manifest/checksum agreement. Actual archive bytes must match SHA-256 before extraction or execution. Native .NET ZIP handling copies only the exact declared binary entries into a new flat staging directory; duplicate entries, links and reparse metadata are rejected. Archive paths cannot select destinations. No WSL or replacement archive tool is installed.

Staging probes Bun/Aphrody `--version` and matches the declared version. `aphrody-site.exe` has `--help`, not `--version`; its successful help probe is the qualification contract. Native multicall aliases are hard links to the owner binary, including `bunx.exe`→`bun.exe`; unsupported cross-volume/link permissions fall back to exclusive executable copies. No MCP server registrations are added.

The setup runtime step stages both products before constructing a candidate bin. Default target is configured `LOCALAPPDATA/Aphrody/Native`; `APHRODY_NATIVE_INSTALL_ROOT` overrides it. Candidate activation retains the previous managed bin under a unique rollback name, restores it if the candidate rename fails, and adds the managed bin to the user PATH without replacing unrelated PATH entries. A failed PATH update reports failure while retaining the previous bin. Existing System32/provider stores and repository files are not installation targets. Subsequent exact manifest hashes plus required managed binaries skip replacement.

## Verification and operational limits

```powershell
bun scripts/install/r2-native.ts
bun scripts/install/r2-native.ts --stage
```

The first command is a metadata/checksum plan. The second downloads and verifies archives, extracts/probes binaries and creates aliases in a per-user verified staging directory, preserving active PATH binaries. Real Windows staging succeeded for both products. A direct staged `bunx.exe --version` reports `1.4.3-aphrody.3`; both aliases are 145,729,536 bytes. Staged `aphrody-site.exe --help` reports the native product-site usage. The stage receipt contains the captured manifest and mapping. No activation/PATH update was applied on the owner's workstation by this batch.

Ten focused R2/setup tests (52 assertions), strict scoped TypeScript, oxlint/oxfmt and whitespace checks pass. Tests cover default R2 selection, explicit legacy override, malformed schema/unsafe paths/aliases, checksum mismatch/duplicate checksum, corrupt archives refusing extraction/execution, native bunx alias construction, managed-bin preservation and simulation behavior. The managed receipt records installed binary checksums; an existing installation qualifies only after every primary binary and alias matches its recorded checksum, before any execution. Activation tests use an isolated filesystem and fake System; they do not prove real PATH activation or an installer executable release.

The `aphrody-assets` pet/fonts/symbol objects are managed by their asset/site owner and are not changed here. Custom domains remain dependent on the zone/registrar cutover. Rebuilding/publishing `Aphrody-Setup.exe` and qualifying real installation/rollback remain release tasks; source wiring and verified staged archives do not imply installed upgrade.
