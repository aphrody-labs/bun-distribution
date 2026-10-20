# Alpine browser desktop delivery target

The owner requests a real Alpine Linux environment exposed through the unified
Aphrody site, using the current Aphrody Bun fork from `main`, the product Rust
crates and Bun packages, Aphrody applications, COSMIC and Hyprland desktop
sessions, and applicable Omarchy and CachyOS applications. This request extends
the browser product; it does not establish that these components already run
inside the current guest.

## Existing implementation

- `apps/webos/src/apps/linux.ts` boots a real 32-bit x86 Alpine ISO through v86.
  It provides saved machine state and an explicit shared-folder bridge.
- `apps/webos/vm.lock.json` pins the guest ISO and emulator inputs. The guest
  does not contain the complete Bun OS runtime or native desktop composition.
- `factory/images/bunos-alpine/Containerfile` consumes a qualified musl Bun
  artifact for amd64/arm64 server and edge images. These images have no desktop
  session and are distinct from the browser's 32-bit ISO.
- Craft browser applications are real Rust/WASM artifacts assembled by
  `apps/webos/build-craft.ts`; they are installable only after the artifact
  manifest is generated. The source catalog is not an execution receipt.

## Required qualification before claiming completion

1. Select an execution architecture supporting the qualified Bun runtime and
   native Wayland sessions. The current x86 guest cannot be described as
   executing the existing amd64/arm64 musl runtime.
2. Pin the actual fork `main` commit and its qualified musl artifact receipt;
   do not relocate or reset an active runtime checkout.
3. Assemble an Alpine image retaining its package manager, product packages,
   licenses and update contract. Keep source availability separate from target
   compatibility and successful installation.
4. Qualify COSMIC and Hyprland as separate selectable sessions, including
   graphics, input, persistence, shared Drive files and browser transport.
5. Resolve Omarchy/CachyOS application dependencies for the selected Alpine
   target. Their Arch package catalogs are not Alpine installation evidence.
6. Verify actual boot, Bun execution, app launch and open/save roundtrips from
   the public site before marking this desktop target delivered.

These native desktop and complete guest gates remain pending. The coordinated
WebOS/Craft publication must report its actual app artifacts and source commit
without representing those gates as complete.
