<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Computer Use Architecture (`computer`)

Aphrody provides a unified, cross-platform `computer` tool that enables autonomous agents to interact with desktop and browser graphical interfaces without human intervention.

---

## 1. Unified Tool Contract

The `computer` tool exposes 12 deterministic actions through a standardized JSON schema:

| Action | Required Arguments | Description |
|---|---|---|
| `screenshot` | none | Capture display frame. Emits image data in `ToolOutput.images`. |
| `click` | `(x, y)` or `element_id` | Click primary or specified mouse button at screen coordinate or accessible node. |
| `double_click`| `(x, y)` or `element_id` | Double click primary mouse button. |
| `move` | `(x, y)` | Move mouse cursor smoothly to coordinate. |
| `drag` | `(start_x, start_y, end_x, end_y)` | Click, drag, and release between coordinates. |
| `scroll` | `direction, amount` or `delta_y` | Scroll active window or viewport. |
| `type` | `text` | Send raw text string to active window input focus. |
| `keypress` | `key` | Press keyboard key or key combination (e.g. `Enter`, `ctrl+c`). |
| `wait` | `duration_ms` | Sleep execution thread for UI stabilization. |
| `observe` | none | Extract accessible UI automation tree (UIA) and OCR text elements. |
| `list_windows` | none | Return inventory of open application windows with title and handle. |
| `focus_window`| `window_title` or `window_id` | Bring targeted application window to foreground. |

---

## 2. Dual Perception Architecture

Modern models have disparate perceptual capabilities. Aphrody resolves this transparently:

### A. Vision-Language Models (Multimodal)
- When interacting with vision-capable models (such as `qwen3-vl-8b-instruct-q4km`), the tool outputs `ToolOutput` with structured image attachments (`ToolImage` containing Base64 PNG bytes).
- The agent loop maps these directly into `Part::Image` model inputs, allowing visual reasoning over pixel coordinates.

### B. Text-Only Models
- For pure text models that cannot process raw pixels, the `observe` action queries the OS UI Automation (UIA) tree and PaddleOCR text detections.
- Elements are tagged with synthetic references (e.g. `@e1`, `@e2`).
- Actions accept `element_id = "@e1"` as a direct alternative to pixel `(x, y)` coordinates, enabling fully autonomous desktop navigation on lightweight text models.

---

## 3. Backends

The `ComputerBackend` trait abstracts the operating system and environment:

1. **`WindowsComputerBackend`**:
   - Runs in-process via `winclean.dll` (AOT-compiled C# / Rust FFI).
   - High-performance desktop interaction using Windows Native API, `DirectX` / `DWM` off-screen capture, and UI Automation without shell overhead.
2. **`BrowserComputerBackend`**:
   - Bridges to `bxc`'s browser automation suite (`Chrome DevTools Protocol`).
   - Handles headless and headed browser contexts, tab management, DOM selectors, and web-specific navigation.
3. **`MockComputerBackend`**:
   - Zero-dependency mock environment used for deterministic headless integration tests in CI.

---

## 4. Security Policy & Hard Denials

Unlike human-in-the-loop agents that prompt for user approval on each window click, Aphrody enforces automated security policy:

### Deterministic Hard Denials
The following windows and processes are rejected immediately with structured refusal messages:
- **User Account Control (UAC)** prompts.
- **Windows Security / Defender** elevation windows.
- **Windows Credential Manager** and authentication dialogues.
- Administrative shells requesting root privileges.

### Application Filtering (`[computer_use]`)
Configured in `config.toml`:
```toml
[computer_use]
# If populated, only applications matching allowed_apps may be focused or automated
allowed_apps = ["notepad", "calc", "browser", "code"]

# Applications matching denied_apps are blocked deterministically
denied_apps = ["regedit", "cmd", "powershell", "taskmgr"]
```
Attempts to interact with unlisted or denied applications return structured errors back to the model, allowing the agent to replan autonomously without hanging the turn.
