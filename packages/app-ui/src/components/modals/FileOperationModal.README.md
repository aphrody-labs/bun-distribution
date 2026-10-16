<!-- SPDX-License-Identifier: Apache-2.0 -->

# File operation dialog

`useFileOperationDialog` is an internal app-ui hook. It opens the dialog with a copy or move
operation, source `SdPath[]`, destination `SdPath`, and optional completion callback. The
implementation invokes daemon-backed mutations through `@aphrody/drive-client`.

Explorer context menus, keyboard actions, and `DndProvider` own the current call sites. There is
no public `@aphrody/drive` API or `DropZoneFile` component; use the app-ui route and DnD
composition rather than the former interface-package examples.
