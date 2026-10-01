# @shenron/pipeline

CLI de coordination des imports Dragon Ball : OCR, RAG, crawl, IA et traduction.
Les calculs OCR/RAG/LLM et le crawl Web passent par Aphrody lorsque leurs
backends distants sont activés. Les scripts conservent l'extraction et la
validation éditoriales propres à Shenron.

Le serveur MCP Shenron n'est plus dans ce dépôt : il est porté par
`aphrody-ai/apps/shenron-mcp` et déployé par `aphrody-infra` (`shenron-mcp.service`).

```bash
bun run pipeline <ocr|rag|ia|translation|crawl> [options]
```

`bun run pipeline unify` ingests BXC JSONL exports through the installed Rust
owner (`aphrody rag ingest-shenron`). Set `APHRODY_BIN` when the binary is not
on `PATH`; set `APHRODY_DRAGONBALL_RAG_DB` to choose the target SQLite store.
This path preserves the former URL, UTF-16 chunk boundaries and lexical-only
mode while the Rust owner manages SQLite and FTS5.

Pour obtenir des candidats OCR Koharu depuis un projet natif, utiliser
`bun run pipeline koharu-native-candidate <manga|databook> <manifest.json>
<project-root> <project-name> <candidates.jsonl> [--sdk <koharu-sdk>]`.
Le binaire Rust doit être installé ou fourni avec `--sdk`. La commande vérifie
le SHA-256 des images du manifeste contre les images stockées dans le projet,
puis écrit uniquement un artefact `decision=unreviewed`, sans dépôt éditorial.
Voir `docs/KOHARU-CAPABILITY-MAP.md` pour la frontière de provenance.

Pour des sorties `aphrody.ocr.result/v2` (y compris une projection OCR Koharu),
`bun run pipeline aphrody-ocr-candidate <manga|databook> <manifest.json>
<ocr-v2.jsonl> <candidates.jsonl>` conserve le texte, les blocs, la qualité et
la provenance dans le candidat de revue déjà utilisé par Shenron. Chaque
résultat doit porter le SHA-256 de l'image traitée ; le pipeline revérifie les
octets et les dimensions de cette image dans l'export Shenron. Son
`page_id` peut être l'identité du manifeste (`DB:...`/`DBS:...` pour le manga,
`databook:<id>:<page>` pour les databooks) ou égaler `image.path` pour un lot
PP-OCR générique. Ce chemin reste une trace du fichier traité : seul le SHA-256
unique du manifeste établit l'identité éditoriale. Seuls les états
`text` et `needs-review` avec du texte peuvent produire un candidat. `no-text`,
`unreadable` et `processing-error` sont refusés ; aucun de ces états ne peut
effacer une transcription ni lever une quarantaine. Le manifeste reste
l'autorité pour l'identité de page et le SHA-256 du scan original.

Pour faire entrer ces candidats manga dans la revue visuelle hors ligne :

```bash
bun packages/shenron/pipeline/scripts/manga-revue-agents.ts prepare <racine-run> --lot <n> --sortie <revues> --candidates <candidates.jsonl>
```

`prepare` revérifie le schéma, l'identité, les deux SHA-256 du manifeste et les
octets de chaque image concernée. Le paquet de revue contient les régions ou
preuves OCR sous `candidatNonRelu`, en plus des indices PP-OCR existants.
L'arbitre doit toujours lire l'image réelle ; le candidat ne fournit aucune
revue visuelle, confirmation de couverture ou décision éditoriale. La commande
`sceller` attend toujours ses deux revues indépendantes. Les candidats databook
n'ont pas encore d'entrée offline équivalente : `planches-a-relire.ts` construit
sa file depuis PostgreSQL et les scripts de dépôt attendent des transcriptions
déjà jugées au format `{image,text}`, pas `shenron.databook.review-candidate/v1`.

Pour les règles de bascule et les preuves de production, voir
`docs/APHRODY-OFFLOAD.md` à la racine du dépôt.

La traduction des databooks est centralisée par
`scripts/ops/translate-databooks-session.ts` : Aphrody `ja→fr` est sondé en
premier, puis les replis déclarés, avec garde lexicale, juge unique, dépôt
PostgreSQL atomique et ingestion RAG rejouable. PostgreSQL est l'autorité ; le
JSON RAG est un artefact dérivé. Voir
[`docs/TRADUCTION-DATABOOKS.md`](../../docs/TRADUCTION-DATABOOKS.md) pour les
compteurs et le protocole d'arrêt/reprise.
