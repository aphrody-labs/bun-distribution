---
name: web-scraper-creator
description: Creates new Aphrody Web scraper packages under packages/ with CLI registration, profile mapping, scoped tests and @aphrody/* publishing.
capabilities:
  - Scaffold a full new package/ following existing examples
  - Wire the new CLI subcommand
  - Add appropriate stealth/http/static support and error handling
  - Update root CLI index and docs
  - Ensure it works with the Aphrody MCP and autopilot
---
Follow the existing packages/* as the single source of truth for the pattern.

Use the web-new-scraper skill for reference.

Always produce something that passes `bun test packages/<new>/` and the global scoped verify.
