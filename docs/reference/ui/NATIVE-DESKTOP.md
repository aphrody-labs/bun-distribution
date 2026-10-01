<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native desktop and distribution boundary

> **Tauri version note (historical).** Mentions of Tauri v2 below describe the former host. The workspace now pins Tauri 3 alpha (`tauri =3.0.0-alpha.3`, default runtime `tauri-runtime-wry`, `tauri-runtime-cef` only for Koharu): see [the Tauri 3 upstream line](../../operations/ui/tauri-upstream.md) and [`config/tauri-apps.json`](../../../config/tauri-apps.json). The product-boundary rules on this page are unchanged; host details need requalification under Tauri 3 (Verify).

Tauri v2 is the current host for Aphrody's public Chat, Files, Models and Settings webview.
Rust M3, rendering and window crates remain reusable foundations, not a commitment to build
an Aphrody-owned operating-system shell or browser from scratch.

Aphrody is a Rust distribution. When a standalone shell or browser is needed, evaluate mature
Rust GUIs, upstream maintenance, licensing, accessibility and packaging first. Package the
best fit where possible. Build a custom wgpu/full-Rust host only for a documented product gap;
keep that application separate from the privileged consumer webview.

The app-ui webview does not include browser navigation, shell/PTY/terminal sessions, SSH
consoles or infrastructure diagnostics. Backend web retrieval and OS process/job APIs remain
with their owners and are exposed only through explicit product actions.

See [M3 host boundaries](../../plans/ui/design/M3-MULTI-HOST-PLAN.md), [GUI contract](./GUI.md) and
[distribution workflow](./DESKTOP-INTEGRATION.md). Any standalone native package needs its own
installed-bundle, accessibility, update, offline and process-lifecycle evidence.
