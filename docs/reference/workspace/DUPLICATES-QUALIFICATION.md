<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification des doublons exacts — 2026-10-03

Méthode : fichiers suivis au blob git identique (`git ls-files -s`), 429 groupes au
recensement, hors `upstream/`. Décision par catégorie ; une suppression n'est faite
qu'après mise à jour des consommateurs (règle du plan, section 0).

| Groupe | Propriétaire / consommateurs | Décision |
| --- | --- | --- |
| `crates/ui/app/ui-dist/fonts` ↔ `design/aphrody-m3/packages/assets`, `design/aphrody-m3/packages/m3-fonts`, `crates/ui/bun` (226) | `aphrody-app`, recopiés par `build.rs` depuis `ui-dist.manifest` | Retirés de l'index le 2026-10-03 (copie de packaging générée). |
| Copies `scripts/` de fichiers de paquets (13) | paquet propriétaire | Supprimées le 2026-10-03 ([SCRIPTS-INVENTORY.md](SCRIPTS-INVENTORY.md)). |
| `apps/rg/website/public/achillea/**` (not in repo) ↔ `public/**` (drapeaux, rangs, ligues, sons, fonds) | URLs publiques servies sous deux chemins | Conservés : supprimer casse des URL publiées ; à fusionner par une redirection RG. |
| `inazuma-cross/reward-imageN` ↔ `-achieve` | deux états d'interface au même rendu actuel | Conservés (assets distincts par rôle). |
| `iecode/packages/rg/assets/public` (police Humane, `noise.svg`, portrait/notfound) | paquet d'assets RG, chemins publics | Conservés (chemins publics). |
| `Gemini.ico` (`assets/ui/chrome-web-apps` ↔ `crates/ui/app/icons`) | icône de l'app Tauri | Conservé (ressource embarquée par Tauri). |
| Portraits XV2 identiques sous deux codes (Shenron bot) | table code → image du bot | Conservés (clés distinctes). |
| Licences (`LICENSE*` par paquet, `docs/migration/source-licenses`) | obligation de redistribution par paquet et preuve d'import | Conservées volontairement. |
| Schémas Tauri générés (`gen/schemas`, `permissions/schemas`) | générés par `tauri-build` dans chaque crate | Conservés (sortie de build par crate). |
| Configs par paquet (`.oxlintrc`, `.oxfmtrc`, `tsconfig.build.json`), fixtures de tests, `.cargo-ok` des patches | convention par paquet / sources amont patchées | Conservés. |
| `crates/ai/agent-home/templates/*` ↔ `plugins/aphrody/home/*` | gabarits du crate et home installé du plugin | Conservés : le plugin est un artefact distribué séparément. |
| `CLAUDE.md` ↔ `GEMINI.md`, `llm.txt` ↔ `llms.txt`, `agent.json` ↔ `agent-card.json` | points d'entrée lus par des outils distincts | Conservés (noms imposés par les consommateurs). |
| Copies de README/docs de paquets UI sous `docs/{architecture,products,operations,reference,plans}/ui` | propriétaire `design/aphrody-m3/packages/*`, `crates/ui/*` | Consolidation exacte effectuée le 2026-10-03 : 32 copies redondantes retirées avec alias `duplicateOf`, 7 liens entrants réécrits, vérification sans constat. 13 copies divergentes restent en revue manuelle. L'index d'import a été régénéré mais son gate global reste en échec à cause de 5 729 destinations manquantes dans la carte source complète. Les groupes résiduels sont conservés par rôle/style/provenance. |
| Autres copies `docs/` de README de crates (drive, obscura, whisper) | propriétaire du crate | Même procédure de consolidation, scopes `os`, `web`. |
| Logs de gates identiques (`docs/operations/infra/*/typecheck.log`) | preuves datées de qualification | Conservés (preuves). |
