# Aphrody — Plan de fusion Obscura × Bun (dossier de projet)

Mis à jour le 2026-10-05 après la décision finale.

## Décision finale (tranchée)

Nouveau monorepo privé **`aphrody-labs/yolo`**, créé depuis la branche `main` du fork `aphrody-labs/bun` (`c439b6fbd` ; la branche `yolo` n'existe plus)
(le dépôt `yolo` actuel, existant, privé et non archivé, doit d'abord être archivé en `yolo-legacy`, qui n'existe pas encore). Binaire unique **`yolo`** (alias `bun`), modules
`yolo:*` (alias `bun:*`). Un seul moteur JavaScript : JavaScriptCore ; V8 et deno_core disparaissent.
Obscura devient code première partie sous `crates/browser/*` et s'expose comme plugin natif
`@aphrody/plugin-obscura`. Tauri/wry/tao/next.js sont des **pins git** sur les forks aphrody-labs (jamais
recopiés) ; wgpu vient de crates.io. `aphrody-labs/aphrody` reste le dépôt des produits, consomme `yolo`
et sera vidé de ses moteurs (Tauri, obscura-*, engine, gpu) dans un one shot ultérieur (« 2 bis »).

## Contenu du dossier

- `PLAN-FUSION-APHRODY (1 de 3).md`, `(2 de 3).md`, `(3 de 3).md` — le plan complet et à jour en Markdown,
  découpé en trois parties à lire dans l'ordre (schémas en texte, décision finale en partie 1).
- `PLAN-FUSION-APHRODY (4 de 4).md` — audits et contexte vérifiés le 5 octobre au soir : état réel du fork Bun
  (`main` unique, build `bun-forge` de `c439b6fbd`), d'Obscura, de Tauri et de leurs forks, mécanismes
  d'extension du fork, collisions du nom `yolo`, infrastructure de build, décisions ouvertes, checklist à jour.
- `GOAL-FUSION.md` — A. le `GOAL.md` du nouveau monorepo `yolo` ; B. l'amendement au `GOAL.md` d'`aphrody`.
- `PROMPT-ONESHOT-1.md` — prompt de la session Opus 5.5 (workflow dynamique, 200 €, 2 jours) qui crée
  `yolo` et livre le binaire `yolo` + plugin Obscura.
- **Plan de fusion Obscura × Bun** (Google Doc) — copie antérieure à la section « Décision finale » ;
  le document vivant à jour (édition, commentaires) est ici :
  https://claude.ai/code/artifact/107724ae-da88-44f8-8b84-e9bb3c5afbb8
- `architecture-cible.png`, `chronologie-oneshot-1.png` — les deux schémas du plan (envoyés dans la conversation ; absents de ce dossier au 2026-10-05).
- Présents aussi dans ce dossier : `AUDIT-fork-bun-mecanismes.md`, `AUDIT-obscura-inventaire.md`, `AUDIT-tauri-et-renommage.md`, `RECHERCHE-obscura.md`, `RECHERCHE-tauri-v3.md`, `RECHERCHE-depots-externes.md`, `Plan de fusion Obscura × Bun.md` (copie du Google Doc).

## Dépôts concernés

`aphrody-labs/yolo` (nouvelle cible), `aphrody-labs/bun` (branche `main`, source), `aphrody-labs/obscura`
(resynchronisé le 5 octobre : `main` = `h4ckf0r0day/obscura` v0.2.4 `1fccab2c1`, `yolo` = `dbea8a7c1`), `aphrody-labs/{tauri,wry,tao,next.js}` (pins),
`aphrody-labs/aphrody` (produits, consommateur).

## Ordre d'exécution

1. Coller `PROMPT-ONESHOT-1.md` dans une session Claude Code (Opus 5.5) ; J0 crée le dépôt.
2. Après le tag `oneshot-1` : one shot 2 (crawl + release), 2 bis (nettoyage d'aphrody), 3 (desktop),
   4 (wgpu), 5 (convergence), 6 (plugins lourds) — voir partie 3 du plan.


## Journal de vérification (2026-10-05)

Statut : V = vérifié conforme, C = corrigé ou complété, N = non vérifiable ici. Sources : contenu du dossier (`eza`), API GitHub (GET).

| Affirmation | Valeur vérifiée | Statut | Source |
| --- | --- | --- | --- |
| Dépôt `yolo` « archivé en `yolo-legacy` » | Pas encore fait : `yolo` existe, non archivé ; `yolo-legacy` renvoie 404 | C | API GitHub |
| Source : branche `yolo` du fork bun | `main` (`c439b6fbd`) ; `yolo` supprimée | C | API GitHub |
| `aphrody-labs/obscura` « à resynchroniser » | Fait : `main` = v0.2.4 `1fccab2c1`, `yolo` `dbea8a7c1` | C | API GitHub |
| Parties 1 à 3 et `(4 de 4)`, `GOAL-FUSION.md`, `PROMPT-ONESHOT-1.md` présents | Présents | V | `eza` |
| `architecture-cible.png`, `chronologie-oneshot-1.png` | Absents du dossier | C | `eza` |
| Autres fichiers du dossier | `AUDIT-*` (3), `RECHERCHE-*` (3), `Plan de fusion Obscura × Bun.md` présents mais non listés | C | `eza` |
| Forks `aphrody-labs/{tauri,wry,tao,next.js}` | Existent (branche `yolo`) | V | API GitHub |
| Lien de l'artefact vivant | Non rouvert | N | — |
