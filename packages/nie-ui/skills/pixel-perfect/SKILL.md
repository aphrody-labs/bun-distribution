---
name: pixel-perfect
description: "Measure a game capture or VFS texture and reproduce it elsewhere: menu screen, clean SVG icon, sprite sheet or extra pose from a NIE (IEVR) asset. Use when an image must be matched with numbers; never claim pixel-perfect without a metric."
---

# pixel-perfect

Follow [IECODE scope and execution](../../references/workflow.md).

Prefer original VFS textures, then deterministic render/layout, then a supplied screenshot with its limitations. Measure geometry and colors before reproducing them. Use one geometry source; render skinned models for new poses instead of deforming image pixels.

Compare fixed reference/candidate conditions and report tool, region, tolerance and result. SHA-256 proves byte identity; CPU/GPU `--verify` proves internal agreement, not game fidelity. No metric means no pixel-perfect claim. Private game assets stay outside commits.

Read the selected [measurement/output procedure](references/details.md) and [library map](references/bibliotheques.md) only when needed. Aphrody's `pixel` is a shared owner interface; verify installed help rather than building it from this plugin.
