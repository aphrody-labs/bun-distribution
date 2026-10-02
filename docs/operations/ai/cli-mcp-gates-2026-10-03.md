# Reprise des gates CLI/MCP — 2026-10-03

Coordination A2A : Claude poursuit la section 0 de `PLAN.md` ; Codex reprend
les sections 1, 2 et 5 et reste intégrateur Cargo via
`scripts/build/rust/cargo-serial.sh`. Les changements préexistants du checkout
ne sont pas attribués ni intégrés en bloc.

## Résultats Linux du checkout courant

- `cargo-serial.sh clippy -p aphrody -p aphrody-mcp --all-targets --locked
  --no-default-features --message-format=short -- -D warnings` : réussi.
  Les six anciens diagnostics Web Frames ne sont plus reproduits.
- Le premier passage échouait sur `manual_range_patterns` dans
  `crates/ai/mcp/src/shenron_llm_backend.rs:61`. Correction locale équivalente :
  `Self::Status(502 | 503 | 504)` devient `Self::Status(502..=504)`.
  Ce fichier appartient à un lot backend préexistant non suivi ; il reste
  dans le worktree et n'est pas livré par ce rapport.
- `cargo-serial.sh test -p aphrody-mcp --locked --no-default-features
  --bin aphrody-mcp` : 84 tests réussis, aucun échec ni test ignoré.
  Les quatre tests backend sont inclus et ont également passé isolément.
- Logs locaux : `/tmp/aphrody-cli-mcp-clippy-20261003.log` et
  `/tmp/aphrody-mcp-tests-20261003.log`.

Ces gates concernent les sources et modifications courantes, pas un clone
propre du commit livré. Ils ne couvrent pas les features MCP par défaut
(`native-browser`, `dragonball`, `managed-llama`), Windows, les tests CLI,
la poignée de main d'intégration ou un service installé.

## Exigences restant ouvertes

- Section 1 : `AgentBus` conserve un canal Tokio dans
  `crates/os/subsystem/src/lib.rs` (propriétaire déplacé sous OS après ces gates).
  Ses consommateurs kernel et systemd gardent la même API ; leur qualification
  après déplacement est consignée séparément.
  La recherche d'imports seule ne prouve pas la pureté des contrats.
- Section 2 : `crates/interop/ffi` dépend encore de l'application `aphrody`
  pour `run_async` ; le dispatch et ses features doivent être conservés lors
  de l'extraction. Les tests corpus avec l'artefact local existant ne
  qualifient pas son installation ou sa version.
- Section 5 : ces tests MCP ne prouvent pas la parité des calculs RAG
  Python/Rust ni la qualification des services Web/AI externes.

Aucune case globale de `PLAN.md` n'est clôturée par cette reprise.
