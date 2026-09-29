# 🕷️ Aphrody Web Dedicated Scrapers & Verticals

Aphrody Web provides dedicated, highly specialized scrapers designed to handle complex site structures, Cloudflare Turnstile bypass, or direct iframe video resolutions in-process.

---

## ⚽ FIFA Ultimate Team Scraper (`aphrody web fut`)

Handles extraction from major FIFA/EA Sports FC Ultimate Team directories (FUTBin and FUTGG).

### Features
* **FUTBin Price Scraper**: Fetches live console/PC player prices. Because FUTBin uses aggressive Cloudflare Turnstile checks, `aphrody web fut price` defaults to in-process fallback pipelines or launches a `ghost` browser instance for stealth bypass.
* **FUTGG Player Stats Scraper**: Pulls detailed stats, attributes, playstyles, and traits of players.

### Usage
```bash
# Get player price
aphrody web fut price "https://www.futbin.com/26/player/1042/cristiano-ronaldo" --profile stealth

# Get player statistics
aphrody web fut player "https://www.fut.gg/players/20801-cristiano-ronaldo/" --profile static
```

---

## 🐦 X.com Profile Scraper (`aphrody web xcom`)

Extracts public user timeline and profile details from Twitter without relying on developer API limits or browser automation processes.

### Features
* **Stealth Ingestion**: Runs inside Aphrody Web's `ghost` browser with resource blockers enabled (images, videos, and fonts blocked by default to maximize speed and minimize VPS bandwidth).
* **AI-Ready Markdown**: Emits clean GFM markdown representing the user's public info (bio, followers count, recent pinned tweets).
* **Screenshot Support**: Optional visual layout captures in PNG format.
* **AI Extraction**: Feeds the profile to a local LLM parser to extract structured JSON properties.

### Usage
```bash
# Scrape profile to markdown
aphrody web xcom profile elonmusk

# Scrape profile with visual verification & structured AI info
aphrody web xcom profile elonmusk --screenshot --ai-extract
```

---

## 🛡️ Google Ecosystem Client & Auditor (`aphrody web google`)

Integrates with the Google Ecosystem Atlas (5000+ mapped subdomains and frameworks) to route browser requests safely under strict compliance rules.

### Features
* **Mandate Guard Compliance**: Ensures navigational targets follow smart routing, avoiding traps and Honeypots.
* **Framework Audit**: Identifies Wiz, Angular, and Lit properties.
* **Massive Concurrency**: Audits dozens of endpoints in parallel.

### Usage
```bash
# Mandate compliant open/visit
aphrody web google open "https://accounts.google.com" --profile stealth

# Audit massive list of Google subdomains
aphrody web google audit "https://mail.google.com" "https://docs.google.com" "https://drive.google.com"
```

---
