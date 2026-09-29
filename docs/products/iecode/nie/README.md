# NIE consolidation dossier

This directory records evidence for consolidating IEVR/Victory Road source.
The initial Bun game packages have moved here from the sibling `nie` checkout;
their original file hashes and source revision are recorded in
[`nie/docs/SOURCE-TRANSFER-MANIFEST.json`](../../../reference/nie/SOURCE-TRANSFER-MANIFEST.json).
The remaining Rust and Python migration stays open in the single NIE plan.

- [Factual context](../../../reference/iecode/nie/CONTEXT.md) records repository ownership and the current
  runtime/deployment boundaries.
- The executable NIE migration ledger is the sibling [`nie/PLAN.md`](../../../plans/nie/PLAN.md).

`aphrody-infra` remains the sole owner of production topology, service units,
routes, releases, host operations, and secrets. Neither source code nor
runtime data from `nie` is moved into that repository.
