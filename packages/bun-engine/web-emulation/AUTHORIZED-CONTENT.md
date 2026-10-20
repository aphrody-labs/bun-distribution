# Owner-authorized proprietary content

`authorized-content.json` records the repository owner's 2026-10-20
distribution declarations for Level-5 and Bandai Namco content, separately
from the open-source fixture catalog. Those declarations do not turn the
games into open-source software or provide end-user license terms. No agreement
document or additional contract terms have been supplied in this catalog.

The supplied French Inazuma Eleven 2 ZIP and its Nintendo DS member are pinned
by SHA-256. Dragon Ball Xenoverse 2 has an authorization declaration but no
artifact, system, version or binary hashes supplied here; it cannot be prepared
by this command.

Run preparation on the VPS using the qualified Aphrody Bun runtime:

```sh
bun packages/bun-engine/web-emulation/prepare-authorized-content.ts \
  --archive=/tmp/bun-os-private-dust-rom.zip
```

Without `--archive`, the input is the existing
`usr/share/rom/Inazuma_Eleven_2_-_Tempete_de_Glace_(France).zip` in this checkout.
The command downloads nothing, uses `unzip` with explicit arguments to stream
only the pinned member, and validates both the archive and extracted ROM.
It writes the ROM and preparation receipt beneath the canonical root build
owner's `web-emulation/authorized-content/` directory. It does not write ROM
bytes into a source package, add files to Git, publish objects or mark an
emulator as qualified. Browser execution and public product publication
require their own receipts and integration.
