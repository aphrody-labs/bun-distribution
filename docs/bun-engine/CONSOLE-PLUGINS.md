# Console plugin catalog

`plugins/consoles/manifest.json` is the machine-readable boundary between Bun
Engine and its unified console implementations. Heavy implementations load
lazily through their declared owner.

Each component declares its console, CPU domains, runtime role, firmware policy,
license metadata, publication gate, immutable source revision, build owner, and source owner files.
These files identify real Rust, C, C++, open SDK and redistributable firmware
source owners directly under `crates/`; no placeholder implementation is accepted.

License metadata does not block local research. Publication remains disabled
while `publicationGate` is `deferred-review`; changing it to `approved` requires
separate provenance and redistribution evidence. Publication state does not
remove a component from the unified local distribution.

Firmware policies are deliberately restrictive:

- `not-required`: the component operates without firmware.
- `caller-supplied-only`: firmware is never stored or distributed by Bun Engine.
- `redistributable-only`: only firmware carrying an explicit redistribution grant is accepted.

Run `bun run console:validate` to validate fields, revisions, ownership and local
source paths. Its build owner remains the only place allowed to compile or package it.
