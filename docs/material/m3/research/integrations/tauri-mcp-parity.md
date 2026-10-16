<!-- SPDX-License-Identifier: Apache-2.0 -->
# Upstream Tauri MCP parity

The upstream reference revision is `4451b2b1d1eb3a817674f60957e148224c24d3a8`.
Aphrody exposes the ten operations owned by the native Tauri webview subsystem
through the kernel and the `aphrody-mcp` proxy. The remaining upstream names are
tracked here so release reviews cannot mistake schema exposure for implementation.

| Upstream capability | Aphrody status | Owner / next implementation |
| --- | --- | --- |
| `webview_find_element`, `webview_interact`, `webview_screenshot`, `webview_keyboard`, `webview_wait_for`, `webview_get_styles`, `webview_execute_js`, `webview_dom_snapshot` | Implemented as `tauri_*` operations | `aphrody-ui` + `aphrody-os` kernel |
| `driver_session` | Implemented as `tauri_driver_session` (`start`, `status`, `stop`) | `aphrody-ui` kernel subsystem; session state is per desktop process |
| `manage_window` | Partial (`tauri_window_list`) | Native window manager resize/info actions |
| `read_logs` | Partial (console buffer only; requires `__APHRODY_MCP_LOGS__`) | UI-owned console ring buffer and OS log adapters |
| `webview_select_element`, `webview_get_pointed_element` | Implemented (DOM selector and viewport point) | UI picker overlay and pointer-selection state |
| `get_setup_instructions` | Implemented (`tauri_get_setup_instructions`) | Consumer-facing setup surface |
| `ipc_execute_command`, `ipc_get_backend_state`, `ipc_monitor`, `ipc_get_captured`, `ipc_emit_event` | Missing | Tauri IPC contract and audited event monitor |
| Mobile device listing | Missing | Platform-specific mobile subsystem |

The unsupported rows are deliberately not advertised as working tools. They
require owners in the kernel/UI boundary before being added to the MCP schema.
