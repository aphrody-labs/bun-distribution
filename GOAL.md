# Goal

Deliver one Bun OS product workspace from `C:\\src`, unifying Bun OS and Bun
Libraries package/setup/build/install ownership while preserving source
histories, active concurrent work, and all applicable license notices.

The root Bun workspace, setup command, dependency install, formatter, shared
`node_modules`, Cargo `target`, build output, and install destination must have
one canonical owner. Move source ownership only when imports, manifests,
consumers, and gates are updated together. A single Cargo workspace is complete
only when all included Rust packages belong to it; nested workspace boundaries
must be migrated deliberately rather than hidden by documentation.

Keep the Bun runtime fork's active checkout and processes intact. Integrate it
through the selected workspace without resetting or relocating concurrent
work. Preserve imported license files and notices; the root license applies
only to first-party material.

Finish by qualifying the integrated setup and workspace, committing precise
owned paths on branch `os`, and pushing after verifying remote ancestry.
