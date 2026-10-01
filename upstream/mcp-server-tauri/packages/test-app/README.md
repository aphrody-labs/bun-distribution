# Test App

A Tauri v2 test application used for integration testing of the MCP server. This app
provides a complete Tauri application environment for end-to-end testing of native
automation, IPC monitoring, and plugin functionality.

## Overview

This is a vanilla TypeScript + Tauri v2 application that serves as the target for M2E
(Model-to-Everything) testing. It includes:

   * **Frontend**: TypeScript + Vite
   * **Backend**: Rust with Tauri v2
   * **MCP Bridge Plugin**: Integrated for IPC monitoring and testing

## Development

### Prerequisites

   * Node.js 20+
   * Rust and Cargo
   * Tauri CLI: `npm install -g @tauri-apps/cli@next`

### Running the App

```bash
# From the workspace root
cd packages/test-app

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Tauri Commands

```bash
# Run Tauri dev mode
npm run tauri dev

# Build Tauri app
npm run tauri build
```

## Testing

This app is used by the MCP server's E2E test suite. Tests:

1. Launch the app in dev mode
2. Connect via WebSocket for UI automation
3. Test IPC commands via the MCP Bridge plugin
4. Verify window information and backend state
5. Monitor IPC events

Run the full test suite from the workspace root:

```bash
npm run build
npm test
```

## Project Structure

```text
test-app/
├── src/                    # Frontend source (TypeScript)
│   ├── main.ts            # Entry point
│   └── assets/            # Static assets
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
│   └── tauri.conf.json    # Tauri configuration
└── package.json
```

The MCP Bridge plugin is included as a workspace dependency from
`packages/tauri-plugin-mcp-bridge/`.

## Integration with MCP Server

This app is configured to work with the MCP server's native automation:

   * **WebSocket Port**: Automatically allocated (9223-9322 range)
   * **MCP Bridge Plugin**: Provides IPC monitoring and direct command execution
   * **Window Management**: Exposes window information for testing

## Recommended IDE Setup

   * [VS Code][vs-code]
   * [Tauri Extension][tauri-ext]
   * [rust-analyzer][rust-analyzer]

[vs-code]: https://code.visualstudio.com/
[tauri-ext]: https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode
[rust-analyzer]: https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer
