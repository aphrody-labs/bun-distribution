# @aphrody/fut

> **High-Performance EA SPORTS FC & FIFA Ultimate Team Intelligence Suite**  
> Scraping, High-Speed Crawling, Real-Time Market Valuation, AI Squad Builder, Mathematical SBC Solver, Early Leaks & Staging Radar, Live Chrome MV3 Extension, and Autonomous MCP Bridge.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://www.npmjs.com/package/@aphrody/fut)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Bun%20%7C%20Node.js-black.svg)](https://bun.sh)

---

## ⚡ Key Capabilities

- 🎯 **Universal Omni-URL Parser**: Ingests and normalizes any URL from FUTBin, FUT.GG, or official EA Web App into structured entities (Players, SBC Challenges, Evolutions, Squads, Fodder).
- 📈 **Dual-Platform Market Valuation & Predictive AI**: Forecasts Console vs. PC price trajectories with intra-week multipliers, credit-freeze anomaly detection, and real-time X community sentiment.
- 🧩 **Mathematical SBC Solver**: Computes cheapest combinations using the exact EA Excess Squad Rating formula.
- 🛡️ **Early Leaks & Staging Radar**: Monitors Akamai/Cloudflare edge CDN ETags, `loc/en_US.json` diffs, and PC Title Update Frostbite data dumps to discover unreleased cards and promos ahead of time.
- 🌐 **Live Chrome Extension MV3**: Injects via `world: "MAIN"`, intercepts internal `/ut/game/fc27/*` UTAS calls, captures DOM states, extracts secure session cookies, and features Paletools-grade anti-detection (Gaussian jitter, humanized clicks, soft-ban mitigation).
- 🤖 **Remote MCP Server Bridge**: Enables autonomous AI agents to inspect live game state, stream HTML/CSS, and execute actions (`BUY_NOW`, `BID_ITEM`, `SEARCH_MARKET`).
- ⚡ **Zero-Spawn Bun Native Engine**: Powered by SQLite WAL caching with 64-bit WyHash keys, Rust FFI acceleration, and high-concurrency scraping.

---

## 📦 Installation

```bash
bun add @aphrody/fut
# or
npm install @aphrody/fut
```

---

## 🚀 Quick Start

### 1. Parse Any FUT Player or URL

```typescript
import { handleAnyFutUrl } from "@aphrody/fut";

const result = await handleAnyFutUrl("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves");

console.log(`Player: ${result.data.name} (${result.data.rating} OVR)`);
console.log(`Live Console Price: ${result.data.prices.console} coins`);
console.log(`Factual Meta Rating: ${result.analysis.metaScore}`);
console.log(`Investment Action: ${result.actionAdvice.verdict}`);
```

### 2. Solve Squad Building Challenges (SBC)

```typescript
import { calculateEaSquadRating, computeCheapestFodderComposition } from "@aphrody/fut";

// Calculate exact squad rating with EA excess rating algorithm
const squadRating = calculateEaSquadRating([88, 88, 87, 85, 84, 84, 83, 83, 83, 82, 82]);
console.log(`Exact Squad Rating: ${squadRating}`); // 85

// Compute the cheapest composition to hit an 86 rating
const composition = computeCheapestFodderComposition(86);
console.log("Optimal Fodder Breakdown:", composition);
```

### 3. Launch Live Web App Streaming Server & Remote MCP Bridge

```typescript
import { FutWebappStreamServer, FutWebappMcpBridge } from "@aphrody/fut";

// Port 3000 matches the extension default (DEFAULT_BXC_STREAM_WS_URL).
const streamServer = new FutWebappStreamServer({
  port: 3000,
  // The live X-UT-SID the web app uses, captured from its own traffic.
  onSessionCaptured: (session) => console.log("session", session.source),
  // Transfer-market responses the browser made: free price observations.
  onAuctionsObserved: (auctions) => console.log(auctions.length, "auctions"),
});
const mcpBridge = new FutWebappMcpBridge(streamServer);

streamServer.start();
console.log("WebSocket stream active on ws://localhost:3000/fut/stream");

// Query live state over MCP
const liveState = await mcpBridge.handleToolCall("bxc_fut_webapp_sync");
console.log(liveState);
```

### 4. Build Standalone Chrome Extension

```typescript
import { buildChromeExtension } from "@aphrody/fut";

const extensionDir = buildChromeExtension({ outputDir: "./dist/my-extension" });
console.log(`Extension ready to load into Chrome: ${extensionDir}`);
```

---

## 🛠️ CLI Usage via `bxc`

```bash
# Public scrapers (no account needed)
bxc fut player https://www.fut.gg/players/272834-joao-neves/27-272834/
bxc fut price  https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves

# Native EA web app (needs a UTAS session — see below)
bxc fut auth                 # establish and persist a session
bxc fut session              # show it; --sid <uuid> injects one from the browser
bxc fut me                   # persona, club, credits, pile limits
bxc fut club --count 90      # club players (club-all paginates everything)
bxc fut tradepile            # transfer list      (watchlist, unassigned too)
bxc fut market --defId 231747 --maxb 50000

# Observed prices: market searches are recorded automatically
bxc fut prices 231747        # buy-now floor / median + EA price band
bxc fut pricelimits 231747   # EA official band, persisted

# Chrome extension bridge
bxc fut stream --port 3000   # ingest server; captures the live session + prices
bxc fut extension build      # emit the unpacked MV3 extension

bxc fut --help               # the full surface (33 actions)
```

A UTAS session is required for every native action. The cleanest path is
`bxc fut stream` with the Chrome extension loaded: browsing the web app
captures the session and feeds the price store at the same time. Otherwise
`bxc fut auth` needs valid `accounts.ea.com` login cookies in
`src/cookies/ea.json`, or inject one with `EA_UT_SID`.

---

## 🏛️ Architecture & Modules

| Subpath Export | Description |
| :--- | :--- |
| `@aphrody/fut` | Master module re-exporting all capabilities |
| `@aphrody/fut/futbin` | Dedicated FUTBin HTML & JSON scrapers |
| `@aphrody/fut/futgg` | FUT.GG Seroval & TanStack hydration parsers |
| `@aphrody/fut/squad` | AI Squad Builder, Chemistry engine, ASCII/SVG pitch renderers |
| `@aphrody/fut/sbc` | Squad Building Challenges solvers & Bronze Pack Method (BPM) |
| `@aphrody/fut/trading` | Achat-Revente plans, snipe filters, and market cycle timing |
| `@aphrody/fut/prediction`| Dual-platform time series price prediction & anomaly detection |
| `@aphrody/fut/social` | Real-time X/Twitter sentiment analysis & review synthesis |
| `@aphrody/fut/scraper` | Universal multi-platform unified scraper |
| `@aphrody/fut/crawler` | High-concurrency worker crawler with SQLite WAL deduplication |
| `@aphrody/fut/importers`| Omni-router and dedicated page type importers |
| `@aphrody/fut/services` | Core unified service layer consumed across CLI, Web, and Bots |
| `@aphrody/fut/api` | Universal REST API server (`/api/fut/*`) |
| `@aphrody/fut/extension`| Chrome MV3 extension, Paletools hooks, WebSocket stream & MCP bridge |
| `@aphrody/fut/bots` | Live Discord webhook embed & X alert generators |
| `@aphrody/fut/leaks` | EA CDN staging poller, localization diffing, and pack code parser |

---

## 📄 License

Apache-2.0 © 2026 aphrody-code
