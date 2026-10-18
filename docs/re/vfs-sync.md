# VFS sync contract (IEVR and DBXV2)

The server (the VPS games disk, `/games/SteamLibrary`) is the source of truth. Every host derives
the same **canonical manifest** from the same install with the same Rust code
(`aphrody_nie_formats::vfs_manifest`), and two hosts see the same VFS exactly when their manifest
digests are equal. The PC reaches the installs through the read-only SMB share mapped as `G:`; it
never needs a local copy.

## Manifest (version 1)

One row per logical path, read from the pack TOCs only (positioned reads, no pack is loaded):

| field | meaning |
| --- | --- |
| `path` | `/`-separated, no leading/duplicate separator, case kept as in the TOC, compared byte for byte |
| `source` | pack file name, empty for a loose file |
| `offset` | byte offset of the stored entry in the pack |
| `size` | stored bytes in the pack |
| `extractSize` | bytes after decryption/decompression (`size` when the TOC stores 0) |
| `flags` | sorted subset of `c` compressed, `e` pack outside `cpk_list.cfg.bin`, `l` loose, `u` listed but absent from the TOC |

Rows are sorted by `(path, source, offset)` in byte order. The digest is `sha256:` over the lines
`path TAB source TAB offset TAB size TAB extractSize TAB flags LF` (`%`, `\`, TAB, LF, CR escaped as
`%25 %5C %09 %0A %0D`). Wire form: NDJSON, header `{"manifest":1,"game","count","digest"}` then one
object per row.

- **IEVR** is a *logical* view: `cpk_list.cfg.bin` (last duplicate wins) first, then packs absent
  from the list in byte order of their file name (first pack wins). Overlays (`data/oc`,
  `var/ocgen`) are host-local mounts and are excluded.
- **DBXV2** lists every `(pack, path)` of `cpk/*.cpk` in byte order of the pack name; nothing is
  shadowed.

## Server endpoints

- IEVR, `aphrody-nie-model-serve` (127.0.0.1:8792, behind rg-core): `GET /vfs/digest` (header JSON),
  `GET /vfs/index` (NDJSON), both public like the other `/vfs/*` listings (names and sizes, never
  bytes). `GET /vfs/hash?path=` returns `{size, sha256}` of the extracted bytes and is gated by the
  same bearer token as `/raw`. `/vfs/ls`, `/vfs/find`, `/vfs/stat` now include the packs outside
  `cpk_list.cfg.bin`, so the folder view and the readable set are the same set.
- DBXV2, mesh-only origin `http://10.200.77.1:8794`: `GET /meta/vfs-index.ndjson` generated on the
  server with `bunre vfs manifest dbxv2 "<install>" --out ~/apps/dbxv2-assets/meta/vfs-index.ndjson`.
  It contains names, offsets and sizes only.

## Tools

- `bunre vfs manifest|verify|hash|cat <ievr|dbxv2> <install-root>` (crate `bun-re`, feature
  `assets`): works on a local disk (server) or a network share (PC `G:`).
- `bun scripts/aphrody/tools/infra/vfs-sync.ts digest|fetch|verify|read|selftest <game>`: fetches the
  server manifest over `ssh vps`, recomputes its digest in TypeScript (an independent
  implementation of this contract), compares it with the PC view, and reads entries through a
  content-addressed cache in `.local/vfs-cache` (git-ignored). `read` checks size and sha256 against
  the server copy; a blob that no longer hashes to its name is reported as corrupt and refetched.
  No credential is read, printed or written.

## Divergences removed

- Extra packs (outside `cpk_list.cfg.bin`) were stored in a different index by the remote mount
  than by the local one, in filesystem order on the local mount: duplicate resolution depended on
  the host. Both now share `register_extra_pack`, packs visited in byte order.
- The local mount loaded each pack whole (several GiB) to read a TOC or one entry; it now uses the
  same positioned reads as the remote mount.
- Listings iterated the main index only: files of extra packs were readable but invisible.
- `cpk_list` paths were concatenated without normalisation; sizes wrapped from negative `i32`.
- On Windows (NTFS, SMB) loose files and packs resolved case-insensitively; the Linux server
  refuses those names. `is_file_exact` compares the final component with the directory listing.
