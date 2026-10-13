# Project decisions

- Created in the selected C:\src workspace on 2026-10-13.
- Authored text is concise English. Identity belongs to Aphrody and Bun.
- Imported sources are libraries. The shell exposes capabilities and headless
  CLI inspection, without launching upstream branded GUIs.
- Runtime: Bun 1.4.4 at 2ae8fc65fba1d05c423a2433b1195835109942b6.
- SDK: published Bun commit c209b95eb0dcc964745f4684f127abb83cbe2697.
- Preserve independent Cargo workspaces and dependency revisions.
- Provider authentication and raw sessions remain in isolated stores.
