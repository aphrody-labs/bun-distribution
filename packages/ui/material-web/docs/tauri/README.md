<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri integration references

These pages previously described a proposed `examples/showcase/src-tauri` host and mobile
targets. That showcase is a Bun web fixture; it has no Tauri host. Aphrody's current Tauri host
is `crates/aphrody-app`, which mounts `packages/ui/app-ui`.

Use the current repository guides:

- [Desktop integration](../../../../../docs/reference/ui/DESKTOP-INTEGRATION.md): host configuration, plugins,
  packaging and runtime behavior.
- [Native desktop boundaries](../../../../../docs/reference/ui/NATIVE-DESKTOP.md): host scope and native GUI
  evaluation criteria.
- [Tauri integration design](../../../../../docs/reference/ui/tauri/aphrody-integration.md): process and
  frontend boundaries.
- [M3 multi-host plan](../../../../../docs/plans/ui/design/M3-MULTI-HOST-PLAN.md): renderer and host
  direction.

The numbered files remain as link-compatible redirects. Their previous platform and type-sync
instructions are not current build guidance. The Material Web package remains a web-component
library, not the desktop host.
