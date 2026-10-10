# Migration guardrails

The requested raw exfiltration of ignored files, secrets and databases is intentionally not automated here. Git is not a secret store, and copying unclassified runtime state into a different repository would make ownership and retention ambiguous.

Approved future workflow:

- classify each artifact by consumer and retention;
- export databases with the native tool into an encrypted operator-controlled location;
- calculate checksums without printing contents;
- restore into an isolated target and validate schema/application probes;
- rotate credentials after cutover;
- remove the old copy only after a separately recorded retention decision.

The live VPS is not purged by this repository. Service retirement requires a named target, rollback, backup proof and a separate change record.

