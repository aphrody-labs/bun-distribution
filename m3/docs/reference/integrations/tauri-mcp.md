<!-- SPDX-License-Identifier: Apache-2.0 -->
# Tauri MCP integration

## Ownership and transport

The desktop (`aphrody-app`) owns Tauri webview inspection and interaction. At startup it registers the `tauri` subsystem with the per-user Aphrody kernel; an already-running kernel receives both the existing window subsystem and the webview subsystem over independent IPC sessions. The kernel remains the tool router. `aphrody-mcp` consumes the live kernel catalog and exposes these operations with the `aphrody_tauri_` prefix. `aphrody-tauri-mcp` is a standalone stdio adapter for MCP consumers that need just these tools.

## Tools

`tauri_window_list`, `tauri_dom_snapshot`, `tauri_find_element`, `tauri_interact`, `tauri_keyboard`, `tauri_wait_for`, `tauri_get_styles`, `tauri_execute_js`, `tauri_viewport_read`, and `tauri_screenshot` operate on Aphrody Tauri webviews. `tauri_execute_js` evaluates caller-supplied JavaScript in the selected local webview. `tauri_wait_for` polls for a CSS selector or text for up to 30 seconds. `tauri_viewport_read` returns text and dimensions. On Windows, `tauri_screenshot` captures the selected native window and returns PNG image content; other platforms report that native capture is unavailable.

## Upstream

The MIT-licensed reference is [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri), revision `4451b2b1d1eb3a817674f60957e148224c24d3a8`. The source checkout has been removed because Aphrody does not install its unauthenticated WebSocket listener; native desktop-to-kernel IPC avoids opening a new network port. The upstream license notice is retained in [`tauri-mcp-upstream.LICENSE`](./tauri-mcp-upstream.LICENSE).
