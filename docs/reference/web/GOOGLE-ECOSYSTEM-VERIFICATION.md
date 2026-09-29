<!-- SPDX-License-Identifier: Apache-2.0 -->
# Google ecosystem verification contract

Ce document est l'arbre canonique de vérification de l'intégration Google,
Gemini Web et Aphrody. Il décrit les tests et les preuves attendues; il ne
contient jamais de cookie, jeton, clé API ou réponse privée.

## Arbre d'exécution

```text
aphrody-kernel (autorité Rust / IPC / MCP)
├── aphrody-browser
│   ├── Obscura : DOM, navigation, markdown, session Web
│   ├── web_fetch / google_search
│   └── Gemini Web navigation
├── aphrody-web MCP provider
│   └── BXC / curl-impersonate / Rust FFI
├── aphrody-app (Tauri / Wry)
│   └── fenêtre Gemini Web persistante, séparée de l'IPC privilégié
├── aphrody-shell / Nushell / CLI
├── aphrody-re / Ghidra / agy / Antigravity
└── clients polyglottes
    ├── Rust : kernel, FFI, Obscura
    ├── Bun : BXC, MCP, CLI, UI
    └── uv/Python : SDK Google et adaptateurs non privilégiés
```

## Matrice de tests

| Surface | Cible publique | Preuve locale sans secret | Preuve live conditionnelle |
|---|---|---|---|
| curl-impersonate | `https://www.google.com` | résolution de bibliothèque, ABI, profils, URL invalide, cookie-jar | HTTP status, TLS/HTTP version, redirections |
| Obscura | `https://www.google.com` | navigation, snapshot, markdown, extraction de liens | consentement/région et contenu observé |
| Gemini Web | `https://gemini.google.com/app` | ouverture Wry/Tauri, session kernel, statut sans cookie | conversation uniquement après connexion utilisateur |
| Google native | Google Search/DoH APIs autorisées | schémas, validation, routage kernel/MCP | réponse réelle et quotas |
| MCP | provider Aphrody Web | initialize, tools/list, collision filtering, tools/call | appel Google public |
| CLI/shell | `aphrody`, `bxc`, Nushell, agy | help, doctor, dispatch, codes de sortie | requête Google/Gemini authentifiée |
| GUI/Tauri | fenêtre `gemini-web` | commande IPC et création de fenêtre | rendu et navigation dans la session utilisateur |
| RE | binaires locaux Google/Aphrody autorisés | triage, strings, sections, rapports | jamais de déchiffrement ou extraction de secrets |

Les tests live doivent être explicitement marqués `LIVE=1`, journaliser
uniquement métadonnées/statuts et redacter les en-têtes sensibles. Une session
Gemini non authentifiée est un résultat `blocked-auth`, pas un succès simulé.

## Stockage des résultats

Le résultat canonique est un événement append-only avec le même schéma logique
dans chaque backend :

```sql
create table if not exists google_verification_runs (
  run_id text primary key,
  started_at text not null,
  surface text not null,
  target text not null,
  profile text,
  status text not null check (status in ('pass','fail','skip','blocked-auth','blocked-env')),
  http_status integer,
  latency_ms integer,
  evidence_ref text,
  redaction_version text not null
);
```

- SQLite est le journal local portable et la source de replay.
- PostgreSQL est le miroir serveur, avec migrations versionnées.
- Redis/Valkey sert uniquement aux verrous, files et agrégats temporaires; il
  ne devient pas la source de vérité.
- Aucun backend ne reçoit de cookie, valeur de `Authorization`, clé API ou
  contenu privé; ces champs sont remplacés par une empreinte non réversible ou
  `[REDACTED]`.

## Gates et ordre de preuve

```text
typecheck/lint
  -> tests unitaires Rust/Bun
  -> build FFI et binaires standalone
  -> kernel + provider MCP sur IPC local
  -> Google public sans authentification
  -> GUI/Tauri Gemini Web
  -> tests live Gemini après authentification utilisateur
  -> miroir SQLite/PostgreSQL et métriques Redis
```

Commandes déjà canoniques :

```powershell
cargo test -p aphrody-browser --offline --locked
cargo test -p aphrody-kernel --offline --locked
bun run typecheck
bun test apps/bxc/test/unit/gemini-toolbox.test.ts
bun test apps/bxc/test/upgrade-smoke.test.ts
bun scripts/build-standalone.ts
```

Les tests Google/Gemini live doivent être lancés depuis l'environnement qui
possède la session utilisateur, sans importer ni versionner ses cookies. Les
résultats sont publiables; les artefacts d'authentification ne le sont pas.

## État vérifié au 2026-09-22

- Kernel, browser subsystem et UI Tauri compilent ensemble.
- Provider MCP Aphrody Web est découvert et filtré contre les doublons Obscura.
- Appel Google public via kernel/MCP est validé.
- BXC standalone compile pour six cibles; le bytecode est opt-in sur Bun 1.4.
- Gemini Web est câblé dans une fenêtre Tauri/Wry et une session Obscura.
- La conversation Gemini live reste `blocked-auth` tant qu'une connexion
  utilisateur n'est pas établie dans la fenêtre dédiée.
