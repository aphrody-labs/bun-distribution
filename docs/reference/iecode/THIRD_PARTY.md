# IECODE third-party inventory

This repository versions the source and licensing notices required to build the IECODE
monorepo. Network-resolved dependencies remain declared in `Cargo.toml`, `package.json`,
`pyproject.toml`, `vcpkg.json` and `IECODE.sln`. The selected Rust emulator
forks and license-cleared Git dependencies are also preserved as source-only
trees under `engine/`, `emulators/` and `libraries/`; see
[`docs/FORK-INTEGRATION.md`](./FORK-INTEGRATION.md) for revisions and gaps.

## Vendored source

| Location | Component | Notice/license | Integration |
| --- | --- | --- | --- |
| `src/iecode-cpp/third_party/stb` | stb image codecs | license text in headers; attribution in `src/iecode-cpp/third_party/README.md` | CMake interface target |
| `src/iecode-cpp/third_party/bcdec` | bcdec block decoder | license text in header; attribution in the third-party README | CMake interface target |
| `src/iecode-cpp/third_party/mio` | mio memory mapping | MIT attribution in the third-party README | CMake interface target |
| `src/iecode-cpp/third_party/tinygltf` | TinyGLTF exporter | MIT attribution in the third-party README | CMake interface target |
| `src/iecode-cpp/emulation/melonds/src/teakra` | Teakra emulator core | `LICENSE` and `README.md` | native emulator source |
| `src/iecode-cpp/emulation/melonds/src/dolphin` | Dolphin components | `license_dolphin.txt` | native emulator source |
| `src/iecode-cpp/emulation/melonds/src/fatfs` | FatFs | `LICENSE.txt` and `00readme.txt` | native filesystem source |
| `src/iecode-cpp/emulation/melonds/src/tiny-AES-c` | tiny-AES-c | `unlicense.txt` and `README.md` | native crypto source |
| `src/iecode-cpp/emulation/melonds/src/net/libslirp` | libslirp | `README.md` plus upstream headers | native networking source |
| `src/iecode-cpp/emulation/melonds/src/blip-buf` | blip-buf | `license.txt` and `readme.txt` | native audio source |

The complete upstream text is kept beside each vendored component. Do not replace a notice with
a URL-only reference: redistributions and offline builds must retain the applicable terms.

## Generated verification

Run:

```sh
bun run check:licenses
```

The verifier checks that vendored files are tracked by Git, every declared component has a local
notice/readme, and the working tree has no untracked files hidden in a vendor directory. It does
not copy package-manager caches or build output into the repository.
