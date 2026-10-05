# Notes

Long-form investigation and debugging notes for this repository.

Start with [`../DEVELOPMENT_NOTES.md`](../DEVELOPMENT_NOTES.md) for known issues and development context. Add new topical notes here when they do not belong in [`../guides/`](../guides/).

- [`gemma4-e4b-metal-inference-research-brief.md`](gemma4-e4b-metal-inference-research-brief.md) — source brief for the E4B W6 Metal decoder and ANE vision-engine research.
- [`gemma4-e4b-runtime-baseline.md`](gemma4-e4b-runtime-baseline.md) — frozen W6 artifact, screenshot fixtures, reference oracle, host inventory, and promotion evidence boundary.
- [`gemma4-e4b-runtime-acceptance.md`](gemma4-e4b-runtime-acceptance.md) — screenshot quality, latency, receipt, privacy, and per-family promotion gates for the native runtime.
- [`debug-notes.md`](debug-notes.md) — Gemma training failure memory, including
  the pre-load clippable-linear patch that silently randomized encoder weights
  and the E4B telepathic-context LoRA program's failure to establish production
  value.
