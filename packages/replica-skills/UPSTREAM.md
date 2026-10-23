# Upstream: Replica

- Project: Replica, eleven Claude skills that clone an app clean-room style, by Jake Schincariol
- Repository: https://github.com/Jakeschincariol/replica-skill
- License: MIT, Copyright (c) 2026 Jake Schincariol (see `LICENSE`)
- Compared against: commit `77c9436fb3d18c3d58169efb8caf4fe906b0dc51` (2026-10-03)

The REA fork (`vendor/rea/third_party/replica`) keeps the same license and the upstream README.

## What Bun OS changed

- The six standard-library Python tools are byte-identical to upstream and stay beside their
  skills as the reference. Each has a Bun-native port that the skills now call:
  - `replica-design/contrast.py` -> `m3-design contrast` (`packages/m3-design/src/contrast.ts`)
  - `replica-diff/parity.py` -> `m3-design parity` (`packages/m3-design/src/parity.ts`)
  - `replica-diff/imgdiff.py` -> `m3-design imgdiff` (`packages/m3-design/src/imgdiff.ts`)
  - `replica-brand/sweep.py` -> `replica-brand/sweep.ts`
  - `replica-launch/listing.py` -> `replica-launch/listing.ts`
  - `replica-entrepreneur/reviews.py` -> `replica-entrepreneur/reviews.ts`
- The design tools are also M3 tool-host tools (`m3_contrast`, `m3_parity`, `m3_imgdiff` in
  `@aphrody/m3-mcp`).
- `SKILL.md` and reference files were adapted for Bun OS agents; upstream tests are not vendored.

## Parity

On the commit above, each Bun port prints the same text report and exit code as its Python
original for the shipped samples (`tokens.json`, `features.csv`, `listing.example.json`) and
for mixed matrices, review sets, PNG pairs and a sweep with names, domains and colours. JSON
reports match except that whole-number floats print as `0` instead of `0.0`. Diff PNGs
decode to identical pixels; their compressed bytes differ.
