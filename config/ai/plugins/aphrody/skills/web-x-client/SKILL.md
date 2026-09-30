---
name: web-x-client
description: "@aphrody/x cookie-based X/Twitter client: GraphQL and REST, catalog sync, local For You ranking, SQLite storage."
metadata:
  short-description: Use the native cookie-based Aphrody Web X client.
---

See packages/x/README.md (the canonical, complete, readable one created as part of aphrody web docs work) and the web-grok-xai skill for the synergy side.

Key exports: XClient, XSession, rankTweets, tweetToPostCandidate, XTools (in xai package).

Cross-platform: pure TS + optional Rust companion in `crates/aphrody-x`.

Use the web-engineer agent for deep integration work.
