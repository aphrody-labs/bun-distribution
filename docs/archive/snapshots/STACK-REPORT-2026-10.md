<!-- SPDX-License-Identifier: Apache-2.0 -->

# Yolo stack report: October 2026

Checked on 2026-10-03 against crates.io, npm, vendor changelogs and blogs, and the yolo and aphrody repos. Prices exclude VAT unless stated.

## TL;DR

| Question | Pick | Why |
| :--- | :--- | :--- |
| **Best Rust full-stack framework** | **Dioxus 0.7** (pin 0.7.x) | One codebase for web, desktop and mobile. Server functions compile to plain axum endpoints. It can hot-patch Rust code while the app runs. |
| **Best host for Rust/Bun apps (cost, performance, AI)** | **Your own EU bare-metal servers or large VPS** : keep and extend the OVHcloud fleet you already run. Use Hetzner's server auction when you need the cheapest RAM, with Cloudflare in front. | After the 2026 RAM price shock, memory costs about 10× less per GB than on PaaS, and your agents already operate these hosts end to end. |
| **Best UI framework for yolo** | **React 19 + Material 3 web components** (`@aphrody/material-web` through `@lit/react`), bundled by Bun | It's the stack Aphrody, which owns the product UI, already uses. It needs no extra tooling under Bun, runs in all three system WebViews, and is what coding agents write most reliably. |

---

## 1. Rust full-stack framework

| Framework | Latest stable | Next | Downloads (90 days) | GitHub stars | Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Dioxus** | 0.7.10 (2026-07-30) | 0.8.0-alpha.1 (2026-07-31) | 1.09 M | 39.3 k | Web, desktop, mobile; full-stack on axum |
| **Leptos** | 0.8.21 (2026-09-26) | 0.9.0-beta2 (2026-09-26) | 1.36 M | 21.4 k | Web first: server rendering, hydration, islands; axum or actix |
| **Loco** | 1.2.0 (2026-09-24) | — | 113 k | 9.4 k | Rails-style backend: Sea-ORM 2, jobs, mailers, Tera 2 |
| **axum** (HTTP layer) | 0.8.9 (2026-04-14) | — | 127 M | 27.3 k | The router under all three above |
| **actix-web** | 4.15.0 (2026-08-21) | — | 11.4 M | 24.9 k | Fastest of the mainstream routers |

### Winner: Dioxus 0.7
- **Server functions**: they compile to ordinary axum endpoints, with Websocket, `Streaming<T>`, `ServerEvents<T>` (server-sent events) and typed forms.
- **Hot-patching**: the "Subsecond" feature patches Rust code at runtime on web, desktop and mobile without losing app state.
- **Components**: Dioxus Primitives provides 28 first-party, unstyled, accessible components in the style of Radix.
- **AI tooling**: a first-party `llms.txt` and agent prompts in the project templates.
- **Popularity**: it has the most GitHub stars of the Rust UI frameworks checked.
- **Caveats**:
  - It is still pre-1.0, and each minor version breaks APIs. 0.8 is alpha, so stay on 0.7.x.
  - Dioxus Native (its GPU renderer, Blitz) is officially a work in progress. Don't ship on it.

### When to pick something else:
- **Leptos 0.8** for web-first apps where server rendering and fine-grained reactivity matter. It was downloaded more than Dioxus over the last 90 days. Version 0.9 mostly reshapes the signal API (`SignalOrFn`, the deref call syntax), so start on 0.8.21.
- **Loco 1.2** for database-heavy SaaS backends. It's the only option with a stable 1.x (1.0 shipped 2026-07-29). Since 1.0 it has a root `AGENTS.md`, and 1.2 adds a Loco skill for coding agents.
- **Raw HTTP speed**: the HTTP Arena composite scores (Alpha Round, updated 2026-10-03) are:
  - `actix`: 6799 (#2 of 73)
  - `ntex`: 5896 (#5; ntex 4.0 is still in beta)
  - `axum`: 4508 (#11)

  Use axum by default for the ecosystem, and actix-web only where the extra throughput pays for itself.

### How this applies to yolo:
In a yolo app the HTTP server is `Bun.serve`, and Rust code is reached through the C ABI runtime, so don't add a second Rust HTTP server inside a yolo app. A Rust full-stack framework is for all-Rust apps created from the `create-tauri-app` fork, which keeps the yew, leptos, sycamore and dioxus templates. Run Dioxus inside the Tauri shell (the template kept), not through Dioxus' own desktop renderer, so Tauri's capability and permission checks still apply.

---

## 2. Hosting Rust/Bun apps and servers

### 2026 context: RAM is now the expensive part

- DRAM contract prices rose about 93–98% in Q1 2026 (TrendForce, cited by Northflank). OVHcloud's CEO said the company was paying six times the previous year's RAM cost.
- Hetzner raised prices twice:
  - 2026-04-01: roughly 30–35% across all product lines, sometimes more.
  - 2026-06-15, new orders and rescales only:
    - Dedicated-vCPU CCX: ×2.1–2.7 (CCX13 went from €15.99 to €42.99).
    - Shared AMD CPX: ×2.4–2.75 (CPX22 went from €7.99 to €19.49).
    - Shared CX/CAX: ×1.3–1.4.
  - The whole Cost-Optimized tier (4 x86 and 4 Arm plans) has been out of stock since 2026-09-07/08. The cheapest 4 GB plan you can actually order is CPX22, at €19.99 with an IPv4 address.
- OVHcloud also raised prices:
  - VPS: +43–49% on 2026-04-01; dedicated servers only went up 5–16% that round.
  - Current "VPS 2027" range (12-month upfront commitment, excl. VAT):
    - VPS-1: 2 vCores, 4 GB, €3.81
    - VPS-2: 4 vCores, 8 GB, €7.21
    - VPS-3: 6 vCores, 12 GB, €10.40
    - VPS-4: 8 vCores, 24 GB, €19.96

    Traffic is unlimited, and no VPS plan offers more than 24 GB of RAM.
  - Second-half 2026 increase on dedicated servers: applies to new orders from 2026-08-11 and to existing servers at renewal from 2026-10-01. Kimsufi, So You Start and Rise are excluded.

### Monthly cost per GB of RAM

| Offer | Spec | Price / month | Per GB RAM |
| :--- | :--- | :--- | :--- |
| **Hetzner auction AX41-NVMe** | Ryzen 5 3600 6c/12t, 64 GB, 2×512 GB NVMe | ~€37.30 | ~€0.58 |
| **Hetzner auction AX42** | Ryzen 7 PRO 8700GE 8c/16t, 64 GB DDR5 ECC | ~€46.00 | ~€0.72 |
| **OVHcloud VPS-4 (2027 range)** | 8 vCores, 24 GB, 200 GB NVMe | €19.96 | ~€0.83 |
| **Hetzner CX33 (when in stock)** | shared vCPU, 8 GB | €8.49 | ~€1.06 |
| **Hetzner CPX22** | shared AMD, 4 GB | €19.99 incl. IPv4 | ~€5.00 |
| **Hetzner CCX13** | 2 dedicated vCPU, 8 GB | €42.99 | ~€5.37 |
| **Northflank (metered PaaS)** | $0.00833 per GB-hour | — | ~$6.08 |
| **Cloudflare Containers** | $0.0000025 per GiB-second while running | — | ~$6.48 plus CPU |
| **Fly.io shared-cpu-1x** | 256 MB | ~$1.94 | ~$7.76 |
| **Render Standard** | 1 vCPU, 2 GB | $25 | $12.50 |

### Winner: keep and extend your OVHcloud fleet (your own EU bare metal or large VPS)

1. **Keep `vps` and `dbfr`**; both are on OVHcloud. The build server has 45 GiB of RAM and 290 GiB of disk (`aphrody/tools/config/production-topology.json`). OVH no longer sells a VPS that size (the current maximum is 24 GB), so any replacement would cost more.
2. **For extra capacity**, add an OVHcloud Rise, So You Start or Kimsufi dedicated server (all spared by the second-half increase), or a Hetzner auction server at about €0.58–0.72 per GB with dedicated cores.
   - The auction's trade-off is manual provisioning and hardware repairs that take hours.
   - Stick to x86-64 for now. `yolo` has only built and verified linux-x64 (decision D8), so no Arm hosts (Hetzner CAX, Ampere) until the linux-arm64 target exists.
3. **Deploy yolo's own artifact unchanged**: one executable, the runtime library and a systemd unit (`bun run pack:deploy`, decision D21), shipped and managed with `yolo ship` and `yolo host`. No Docker or PaaS layer is needed.
4. **Put Cloudflare in front** for DNS, TLS, CDN and R2 (static assets, release mirrors). Use Cloudflare Containers (generally available since 2026-04-13) only for side services that should scale to zero.

### Why this is also the most AI-friendly option:
- **Agents already run it**. They operate these hosts through the Aphrody MCP tools (`infra_exec`, `infra_sync`, `systemd_*`), `yolo ship` (coordination claims, GitHub commit statuses) and `yolo host` (plan, then apply, then journal). There is no provider-specific integration to add.
- **No request timeouts**. Long SSE, WebSocket and LLM streams, and supervised processes (`process.supervise`), run unchanged.
- **Root access**. The runtime library can be loaded through `bun:ffi`.
- **GPUs on demand**. Rent them by the hour when local inference becomes a requirement. Today text generation goes to Gemini (`aphrody/tools/config/local-ai.json`).

### Not recommended as yolo's main host:
- **Vercel Functions** runs Bun 1.4, but that runtime is still in beta (August 2026), and the function model doesn't suit long-lived supervised processes.
- **Cloudflare Workers** runs on `workerd`, not Bun. Rust only works through WASM, and it can't load the runtime library.
- **Railway, Render and Fly.io** are pleasant to use and fine for side projects. But memory costs about $6–12.50 per GB-month, an order of magnitude above bare metal. Fly is the cheapest of the three at scale ($0.02/GB egress in North America and Europe).
- **New Hetzner Cloud CCX or CPX** instances cost 2.1–2.75× more since June 15. Instances ordered before then keep their old price, so don't rescale them.

---

## 3. UI framework for yolo

### What the repos already decide:
- **Web**: Bun HTML bundles served by `Bun.serve` routes (`templates/stack.toml`).
- **Desktop**: Tauri 3 alpha on the system WebViews ("System WebViews retain platform engines", `AGENTS.md`). The UI must therefore run on WebKitGTK, WKWebView and WebView2. Tauri 3 alpha now makes the runtime an explicit choice between Wry (system WebView) and CEF (bundled Chromium); yolo stays on Wry.
- **Deploy**: one executable (D21). `bun build --compile` embeds the frontend loaded through HTML imports into that same binary; Bun calls these "full-stack executables" (since Bun 1.2.17).
- **Who owns the product UI**: Aphrody (Aphrody PLAN §1). It has already standardized on:
  - React 19.3, through its dependency catalog
  - `@aphrody/material-web`, its fork of Google's Material 3 components built with Lit (3.3.3, on npm since 2026-10-03)
  - `lit` 3.3.3 and `@lit/react`
  - its own packages in `packages/ui/m3-*` (react, primitives, theme, icons, motion, forms, ai, …)
- **Bun-only tooling**: Bun compiles JSX/TSX itself, so React needs no plugin. Svelte, Vue and Solid each need a compiler plugin.

### Winner: React 19 + Material 3 web components (`@aphrody/material-web` through `@lit/react`), bundled by Bun's HTML bundler, with no Vite and no extra compiler.
1. **Same stack as Aphrody**. Its `m3-*` packages run unchanged in yolo-generated apps and in the desktop shell (`packages/infra/product`), so there's no second design system.
2. **No extra tooling**.
   - TSX support is built into Bun.
   - Hot reload comes with `Bun.serve` development mode.
   - The frontend ships inside the single executable.
3. **Works the same in every WebView**. React plus standard web components behave the same on all three. Because the Material 3 layer is web components, the plain TypeScript template can use the same components without React.
4. **Easiest for AI agents**. React has by far the largest body of code to learn from. npm downloads over the last month:

| Package | Downloads |
| :--- | :--- |
| `react` | 738 M |
| `vue` | 67 M |
| `lit` | 30 M |
| `svelte` | 25 M |
| `solid-js` | 21 M |

5. **Consistent with the Bun + Rust-only create-tauri-app refactor**. The templates removed there were Vite-based npm projects. Here React is just a library compiled by Bun's own bundler.

On the Rust side: use Dioxus 0.7 for all-Rust apps (inside the Tauri shell), or Leptos 0.8 when web server rendering comes first.

### Considered and rejected for yolo:

| Option | Why not for yolo |
| :--- | :--- |
| **Svelte 5.57, Solid 1.9 (2.0 RC), Vue 3.5** | Each needs a compiler plugin under Bun and adds a second component model next to Aphrody's React and Material 3 |
| **Preact 11 (2026-09-30)** | Smaller and plugin-free (via `jsxImportSource`), but Aphrody's packages target React 19, so the compatibility layer is a risk |
| **Tauri 3 CEF runtime** | One Chromium everywhere, but it contradicts "System WebViews retain platform engines" (D15 also already leaves `cef-rollback` out of the vendored code) |
| **Dioxus Native (Blitz)** | Still a work in progress, according to Dioxus' own 0.7 release notes |
| **Slint 1.18** | Licensed GPL-3.0 or under Slint's own royalty-free or commercial terms. It would need a `deny.toml` exception (D18 allows no GPL). It has no DOM, so it can't reuse the Material 3 web UI. |
| **egui 0.36, iced 0.14, GPUI** | Native GUIs without a DOM, so they can't reuse the Material 3 web UI. Fine for internal tools. |

---

## 4. Follow-ups in yolo (1-3 done on 2026-10-03, 4 pending)

1. Add a React + Material 3 web template built by Bun's HTML bundler, depending on `@aphrody/material-web` and `@lit/react`. **Done:** `yolo create --with react` (`templates/react`, commit `4596954`). Checked on a scaffold (install, `tsc`, oxlint, oxfmt, 7 tests, `build:bin`) and the compiled executable in headless Chromium 157, light and dark; the system WebViews were not run.
2. The `create-tauri-app` `vanilla-ts` template still runs Vite (`"dev": "vite"`, `vite ^8.0.16`). Moving it to Bun's HTML bundler and dev server would finish the Bun-only refactor. **Done:** it now runs `Bun.serve` on the fixed port 1420 (a taken port is an error, as with Vite's `strictPort`) and `Bun.build` (fork commit `516da1d`). `tauri dev` and `tauri build` were not run.
3. The Yew template still pins `yew 0.21`, while `0.23.0` has been out since 2026-03-10. The Dioxus 0.7, Leptos 0.8 and Sycamore 0.9 pins are current. **Done:** bumped to 0.23 with no source change (fork commit `c7692bb`); built for `wasm32-unknown-unknown` and run in headless Chromium with a stand-in for `invoke`. `trunk` was not run.
4. Build and ship the `linux-arm64` target before considering Arm hosts. **Not started.**

> [!NOTE]
> Not verified: what current OVH VPS plans actually cost after the April 2026 increase, and live Hetzner auction stock. Check the OVH manager and Hetzner's auction page before ordering anything.

---

## 5. References & Primary Sources

### Rust frameworks
- crates.io API: versions, 90-day downloads and licenses for `dioxus`, `leptos`, `loco-rs`, `axum`, `actix-web`, `tauri`, `slint`, `egui`, `iced`, `gpui`
- Dioxus 0.7 release notes & releases
- Leptos 0.9 beta notes
- Loco releases
- HTTP Arena: Rust benchmarks

### Hosting
- Northflank: Hetzner 2026 price increases
- igor'sLAB: Hetzner April 2026 adjustments
- bex.co: auction vs cloud & cheap tier availability
- OVHcloud VPS & Dedicated server pricing H2 2026
- Cloudflare Containers GA
- Vercel: Bun 1.4 in Functions
- Render: Railway vs Fly.io pricing analysis 2026

### UI
- npm downloads API
- Bun full-stack dev server & full-stack executables
- Tauri 3 CEF runtime
- `@aphrody/material-web` on npm

### Local Repositories
- `yolo`: `templates/stack.toml`, `docs/DECISIONS.md` (D8, D15, D18, D21, D27), `AGENTS.md`, `vendor/create-tauri-app/templates/` (not in repo) (historical upstream template layout)
- `aphrody`: `PLAN.md` §1, root `package.json` dependency catalog, `packages/ui/m3-*`, `tools/config/production-topology.json`, `tools/config/local-ai.json`
