<!-- SPDX-License-Identifier: Apache-2.0 -->

# Yolo Stack Report: October 2026

Cross-repository consensus and stack evaluation checked on 2026-10-03 against crates.io, npm, vendor changelogs, blogs, and the `yolo` and `aphrody` repositories.

## TL;DR & Primary Recommendations

| Area | Recommended Pick | Key Rationale |
| :--- | :--- | :--- |
| **Rust Full-Stack Framework** | **Dioxus 0.7** (pinned 0.7.x) | Single codebase for web, desktop, and mobile. Server functions compile to standard axum endpoints. Subsecond hot-patching preserves application state. |
| **Hosting (Cost, Performance, AI)** | **Own EU bare-metal / large VPS** (retain OVHcloud fleet `vps` + `dbfr` with 45 GiB RAM; Hetzner auction for cheap €0.58/GB RAM) behind Cloudflare | After the 2026 RAM price shock (+93-98%), bare metal is ~10× cheaper than PaaS ($6–12.50/GB). Agents already operate these hosts natively via MCP. |
| **UI Framework for Yolo** | **React 19 + Material 3 Web Components** (`@aphrody/material-web` via `@lit/react`), bundled by Bun | Identical to Aphrody's UI stack (`m3/packages/m3-*`). Zero extra compiler plugins under Bun, runs identically across Wry system WebViews, largest AI corpus. |

---

## 1. Rust Full-Stack Frameworks

- **Dioxus 0.7.10** (Winner):
  - Server functions compile to standard axum endpoints (supporting WebSockets, SSE streams `ServerEvents<T>`, typed forms).
  - Subsecond hot-patching across platforms without losing state.
  - Dioxus Primitives (28 unstyled accessible components).
  - First-party `llms.txt` and agent prompts.
  - *Caveats*: 0.8 is in alpha; stay on 0.7.x. Blitz GPU renderer is still experimental.
- **Alternatives**:
  - **Leptos 0.8.21**: Preferred for web-first SSR with fine-grained reactivity.
  - **Loco 1.2.0**: Rails-style backend over Sea-ORM 2, jobs, and mailers.
  - **HTTP Layer**: Use `axum` by default for ecosystem integration; `actix-web` where raw request throughput pays for itself.

### Monorepo Architecture Integration
In a Yolo-based app, the primary HTTP server is `Bun.serve`, reaching Rust logic through the C ABI runtime (`yolo-runtime`). Rust full-stack frameworks apply to all-Rust apps generated via `create-tauri-app`, executed within the Tauri shell (Wry) so capability and permission policies remain enforced.

---

## 2. Infrastructure & Hosting Strategy

### The 2026 RAM Price Shift
- DRAM contract prices surged ~93–98% in Q1 2026.
- Hetzner raised prices in April and June 2026 (dedicated CCX ×2.1–2.7, CPX ×2.4–2.75).
- OVHcloud VPS increased 43–49% in April 2026; existing dedicated ranges (Rise, So You Start, Kimsufi) remain shielded from second-half dedicated price hikes.

### Cost Comparison (RAM per GB-month)
- **Hetzner Auction (AX41/AX42)**: ~€0.58 – €0.72 / GB.
- **OVHcloud VPS-4 (2027)**: ~€0.83 / GB.
- **Hetzner CPX22**: ~€5.00 / GB.
- **PaaS (Northflank, Cloudflare Containers, Fly.io, Render)**: ~$6.08 – $12.50 / GB.

### Infrastructure Strategy
1. **Retain existing OVHcloud instances** (`vps` and `dbfr`). The VPS build server has 45 GiB of RAM; replacing it with current VPS plans (capped at 24 GB) would cost substantially more.
2. **Expand with Hetzner Auction or OVH dedicated servers** when more raw memory is needed.
3. **Deploy self-contained Yolo artifacts** (compiled binary + runtime library + systemd unit) directly via `yolo ship` and `yolo host`.
4. **Cloudflare edge fronting** for DNS, TLS, CDN, and R2 asset storage.

---

## 3. UI Framework Selection

- **Winner**: React 19 + Material 3 web components (`@aphrody/material-web` via `@lit/react`), bundled natively by Bun's HTML bundler.
- **Unified Ecosystem**: Consumes Aphrody's `@aphrody/m3-*` packages directly with zero duplicated design tokens.
- **Zero Build Plugins**: Bun compiles TSX natively without Babel or Vite plugins.
- **Cross-Platform Parity**: Standard web components behave identically across WebKitGTK (Linux), WKWebView (macOS), and WebView2 (Windows).

---

## 4. References & Pointers

- Canonical Yolo Report: `yolo/docs/STACK-REPORT-2026-10.md`
- Yolo Architecture Decisions: `yolo/docs/DECISIONS.md` (Decision D27)
- Aphrody Product Plan: `PLAN.md`
- Primary Sources: crates.io API, npm download metrics, HTTP Arena benchmarks, Hetzner & OVHcloud 2026 price notices.
