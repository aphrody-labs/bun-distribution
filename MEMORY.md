# Project decisions

## App hostname ownership

- `packages/workspace/src/capabilities.ts` is the canonical mapping from each
  library capability to `app-<capability>.aphrody.app`, with the library name
  retained as an alias. Bun OS consumes this mapping when planning all 14
  library application builds; those duplicate hostname values were removed
  from its `infra/apps.json`. APT and the Bun Libraries desktop keep their own
  product-specific hosts. Existing Cloudflare records and routes were not changed.

## Cloudflare inventory reconciliation

- Read-only Cloudflare API inventory confirmed 14 proxied `app-*` A records,
  plus proxied AAAA records for `apt.aphrody.app` and `desktop.aphrody.app`.
  `infra/cloudflare.json` now records both product hosts and labels
  `51.77.147.152` as the IPv4 origin. No DNS records or Worker routes changed.

- Created in the selected C:\src workspace on 2026-10-13.
- Authored text is concise English. Identity belongs to Aphrody and Bun.
- Imported sources are libraries. The shell exposes capabilities and headless
  CLI inspection, without launching upstream branded GUIs.
- Runtime: Bun 1.4.4 at 2ae8fc65fba1d05c423a2433b1195835109942b6.
- SDK: published Bun commit 939c835adf6479bc1014da3843cda4ae29851dbd.
- Preserve independent Cargo workspaces and dependency revisions.
- Provider authentication and raw sessions remain in isolated stores.
- Video is the current priority. Reuse the native source CLI and Bun.Video;
  no codec implementation or FFmpeg subprocess belongs in this adapter.
- FilmCraft schema 15 uses signed i64 ticks and unsigned u64 IDs. Preserve
  integer precision across JSON rather than routing them through unsafe Numbers.
- The installed Bun revision currently lacks Bun.Video. The parallel native
  owner is replacing the optional media provider; this batch leaves it untouched.
- Quality gates use native bun check, bun lint and bun fmt. The formatter config
  is bunfmt.json; external checker/linter/formatter packages are removed.
- Aggressive n2b changes require review: embedded host scripts retain their own
  runtime, and Buffer or callback rewrites must preserve their actual contract.
- Media export uses a fresh destination directory because native formats derive
  sibling and sequence filenames. Failed operations retain structured results.
- Paths remain checkout-relative under the selected C:\src workspace. Native
  owners are resolved from live tools and configuration after workspace changes.
