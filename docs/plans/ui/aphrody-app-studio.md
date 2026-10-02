<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody app : Studio Shenron × Koharu — 2026-10-03

Décision du propriétaire (2026-10-03) : l'app desktop Aphrody (`crates/ui/app`,
frontend `packages/ui/app-ui`) devient l'application unique d'administration
Shenron, de traduction et lecture manga (Koharu), de databooks, d'entraînement /
fine-tuning, d'agent home dbfr et du Drive dbfr. Cet accord lève la réserve de
`GEMINI.md` qui tenait Shenron et RG hors de l'app jusqu'à accord explicite ; la
mise en production du site et du bot reste une opération distincte.

Règles : aucun moteur recréé (Koharu, `aphrody-ocr*`, `aphrody-train`,
`aphrody-drive`, `@shenron/ui`, `@koharu/ui`, M3 restent propriétaires) ; pas de
régression des surfaces existantes (chat, fichiers, modèles, réglages) ; Cargo
uniquement via `scripts/build/rust/cargo-serial.sh`, une commande à la fois.

## Phases

1. **Shell Studio (Bun).** Destination `/studio` dans `desktop-navigation.ts`,
   sidebar et palette ; écran à onglets M3 (`@aphrody/m3-primitives`) : Admin,
   Manga, Traduction, Databooks, Entraînement, Drive. Chaque onglet n'appelle que
   des commandes Tauri existantes ou déclarées en phase 2 ; état vide explicite
   tant qu'une commande manque (pas de données factices).
2. **Commandes Rust de l'app.** `aphrody_train_*` (déléguer à
   `aphrody-command` / `aphrody-train`, jobs et événements), `aphrody_shenron_admin`
   (proxy authentifié de l'API admin du bot, jeton dans le coffre local),
   `aphrody_databooks_*` (lecture du corpus via `@shenron/config` / API),
   ouverture du flag `APHRODY_SHENRON_PRODUCTION_READY` par réglage explicite.
3. **Manga / traduction par Koharu.** Onglet Manga = éditeur `@koharu/ui` sur
   `koharu_rpc`/`koharu_rpc_batch` (pipeline détection → OCR → traduction →
   inpainting → rendu), export vers la file Shenron (`ShenronExportPanel`).
4. **Fusion backend OCR / LLM.** Un seul propriétaire par capacité : OCR ONNX
   (`aphrody-ocr-onnx` vs `koharu-ml::pp_ocr_v6`), OCR VLM (`aphrody-ocr-vlm` vs
   `paddle_ocr_vl`), LLM local (`aphrody-llama-server` vs `koharu-llama`) ;
   adaptateurs côté Koharu, parité par fixtures, aucune régression des tests.
5. **Drive dbfr.** Volume cloud Google Drive (OpenDAL `services-gdrive`,
   `ops/volumes/add_cloud`) monté par `aphrody-drive` sur le dossier dbfr ;
   synchronisation vers `~/.aphrody/workspaces/dbfr`.
6. **Modèles et stubs.** Chargement des modèles Koharu, OCR et chat depuis le hub
   Modèles (`aphrody-models`), complétion des stubs restants, puis refonte UI
   M3/Gemini pixel-perfect avec `@shenron/ui` et `@koharu/ui`.

## Statut

- 2026-10-03 — Studio (`/studio`) livré dans l'app :
  - **Shenron** : santé site/bot/IA/RAG/Agent Home dbfr, corpus RAG et recherche,
    environnement d'entraînement — logique extraite en API publique de
    `aphrody-command::shenron_cmd` (`doctor_report`, `rag_stats_report`,
    `rag_search_checked`, `train_status_report`), commandes typées `studio_*`,
    rendu `@shenron/ui` (`PageHeader`, `SectionHeading`). Aucun CLI ni sous-processus.
  - **Administration** : dashboard admin Shenron complet dans une fenêtre native
    (`studio_open_shenron_admin`, `SHENRON_ADMIN_URL`, capability `shenron-admin`
    limitée aux origines du site), avec pont `window.aphrodyNative` vers l'IA
    locale (`studio_native_ai_status`, `studio_native_chat` sur le `llama-server`
    géré) ; le cockpit IA affiche un panneau « IA locale » sourcé par le RAG.
  - **Manga & traduction** : projets Koharu, import, pipeline détection → OCR →
    traduction → nettoyage, export PNG/PSD (`koharu_rpc`).
  - Restent : Entraînement (lancement de jobs), Databooks, Drive dbfr, éditeur
    `@koharu/ui`, fusion OCR/LLM, `ui-dist` à régénérer au build.
