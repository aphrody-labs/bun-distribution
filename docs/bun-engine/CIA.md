# CIA management

Bun Engine handles Nintendo 3DS CIA files through `azahar-cia`, a small headless tool built from
our Azahar fork (`vendor/azahar`, branch `os`, `src/citra_cia`). It reuses the emulator's own CIA
container, ticket, TMD, NCCH and AES code, so the crypto matches what Azahar itself does. The
TypeScript front end is `bun-engine 3ds cia` (`packages/bun-engine/src/ctr/cia.ts`).

No key material is shipped, generated or downloaded. Keys are supplied by the owner as local files.

## Commands

```text
bun-engine 3ds cia status                  where the tool, the user directory and the keys are
bun-engine 3ds cia info <cia>              header, ticket, TMD, contents, keys required (no keys needed)
bun-engine 3ds cia verify <cia>            content hashes against the TMD (needs keys if encrypted)
bun-engine 3ds cia decrypt <cia> <out.cia> write a decrypted copy
bun-engine 3ds cia install <cia>           install into the isolated Azahar NAND/SD
```

All commands print JSON. Exit codes: `0` success, `1` failure, `2` usage, `3` missing keys. When
keys are missing the output names every absent file and entry, for example:

```json
{ "ok": false, "error": "missing-keys",
  "missing": [{ "file": "sysdata/keys.txt", "entry": "common1", "needed_for": "ticket title key (content layer)" }] }
```

Nothing is ever produced from absent keys.

## What a CIA encrypts

A retail CIA has two layers. `decrypt` removes both:

1. The content layer: every content is AES-128-CBC encrypted with the title key (TMD content type
   flag `0x0001`). The title key is stored in the ticket, encrypted with a common key chosen by the
   ticket's common key index.
2. The NCCH layer: the ExHeader, ExeFS and RomFS inside each NCCH are AES-CTR encrypted with keys
   derived from the console KeyX slots `0x2C`, `0x25`, `0x18` or `0x1B` and a KeyY taken from the
   NCCH signature (or from a seed, for seed-crypto titles).

The decrypted CIA keeps the layout of the original. The TMD gets the encrypted flag cleared, the
content hashes and both hash levels rebuilt; its signature no longer validates, as for every
decrypted CIA. Each NCCH gets the NoCrypto flag. Zakuro (`zakuro-fs`) and `aphrody-ctr-emu` open
the result directly, because they only require the TMD flag and the NCCH flag to be clear.

`install` removes the crypto layers into a temporary CIA first (Azahar only installs plain titles),
installs it, and deletes the temporary file.

## Key files the owner must provide

The isolated user directory is `usr/etc/3ds/azahar-user` (git-ignored, like all of `usr/`). Override
it with `AZAHAR_USER_DIR`. Put the files in its `sysdata/` subdirectory:

| File | Needed for | Content |
| --- | --- | --- |
| `sysdata/keys.txt` | every encrypted CIA | Azahar key file, an `:AES` section of `name=hex32` lines |
| `sysdata/seeddb.bin` | only titles with seed crypto (some late eShop games) | seed database, 16-byte header then `title id, seed, padding` records |

Entries read from `keys.txt`, by name:

* `generatorConstant` (always).
* `slot0x3DKeyX` and `common<N>`, where `N` is the ticket's common key index (`info` prints it;
  the retail CIAs under `usr/bin/3ds` use index 1 at least): the content layer title key.
* `slot0x2CKeyX` for the NCCH layer, plus `slot0x25KeyX`, `slot0x18KeyX` or `slot0x1BKeyX` when the
  NCCH header selects that secondary slot.

`bun-engine 3ds cia info <cia>` lists exactly which entries that file needs (`requiredKeys`) and
which of them the user directory is missing (`missingKeys`).

Azahar does not read `boot9.bin`, `otp.bin` or `movable.sed` for CIA handling: it takes the
derived keys from `keys.txt`. Those other files (and `sysdata/otp.bin`, `nand/private/movable.sed`)
only matter for console-unique data, which this flow does not touch.

## Building `azahar-cia`

The tool is a separate CMake target (`ENABLE_CIA_TOOL`, default on) that does not need Qt or any
frontend. On Linux:

```sh
git submodule update --init --depth 1 --recursive vendor/azahar
cmake -S vendor/azahar -B ~/build/azahar -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_QT=OFF -DENABLE_TESTS=OFF -DENABLE_ROOM=OFF -DENABLE_ROOM_STANDALONE=OFF \
  -DENABLE_SDL2=OFF -DENABLE_WEB_SERVICE=OFF -DENABLE_SCRIPTING=OFF -DENABLE_GDBSTUB=OFF \
  -DENABLE_OPENAL=OFF -DENABLE_CUBEB=OFF -DENABLE_LIBUSB=OFF -DENABLE_FFMPEG=OFF \
  -DENABLE_VULKAN=OFF -DENABLE_OPENGL=OFF -DENABLE_BUILTIN_KEYBLOB=OFF -DENABLE_LTO=OFF \
  -DCITRA_WARNINGS_AS_ERRORS=OFF -DCITRA_USE_PRECOMPILED_HEADERS=OFF
cmake --build ~/build/azahar --target citra_cia
```

`ENABLE_BUILTIN_KEYBLOB=OFF` keeps the key store explicit: only `sysdata/keys.txt` is used. The
binary is `~/build/azahar/bin/Release/azahar-cia` (or `bin/azahar-cia`). The wrapper looks for it
in `AZAHAR_CIA`, `usr/lib/azahar-cia/`, `usr/bin/` and `PATH`.

## Assets

The CIAs in `usr/bin/3ds` are copyrighted test assets: they stay on the workstation, are
git-ignored, and are never committed or copied. `info` only reads their headers.
