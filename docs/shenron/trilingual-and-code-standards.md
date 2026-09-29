# Trilingual Architecture & Code Standards (EN / FR / JA)

> **Mandate:** Unified specification for trilingual operations (English, French, Japanese) across SEO, UI, UX, AI/RAG, Documentation, Data schemas, and Code conventions.

---

## 1. Codebase Standards (English Only)

To ensure international maintainability and compliance with modern open-source standards:

- **File Naming**:
  - All new files, directories, tools, and scripts must be named in **English** using `kebab-case` (`entity-resolver.ts`, `wiki-slugs.ts`) or `PascalCase` for React components (`CharacterCard.tsx`, `PlanetViewer.tsx`).
  - No accents, no spaces, no French or mixed language in newly created filenames.
- **Code Comments & Documentation**:
  - All inline code comments, block comments, and JSDoc/TSDoc must be written in **English**.
  - Document parameter contracts, edge cases, invariants, and mathematical/performance rationales clearly.
- **Identifiers & Types**:
  - Variables, functions, methods, interfaces, types, enums, and database migrations must use clean **English** (`characterId`, `fetchCanonicalSlug`, `TransformedState`).

---

## 2. SEO (International & Multilingual Engine)

- **Global Semantic Slugs**:
  - URLs must use canonical, international English/Hepburn naming rather than opaque numeric IDs or untranslated local jargon.
  - Examples:
    - `/wiki/personnages/son-goku` (not `/wiki/personnages/1`)
    - `/wiki/personnages/cell` (not `/wiki/personnages/celula`)
    - `/wiki/transformations/super-saiyan` (not `/wiki/transformations/1`)
    - `/wiki/cosmologie/namek` (not `/wiki/cosmologie/1`)
- **Canonical & 301 Redirects**:
  - Every legacy numeric URL (`/wiki/<category>/<id>`) and regional alias must permanently redirect (HTTP 301 / 308) to the canonical international slug.
  - Strict `<link rel="canonical" href="..." />` tag pointing exclusively to the canonical slug.
- **Metadata & Alternate Tags (hreflang)**:
  - Structured support for multi-region targeting: `fr-FR` (primary editorial site), `en-US` (global/international readers), `ja-JP` (original canon source attribution).
  - OpenGraph and Twitter cards formatted with international title hierarchy: `${name} (${nameJa}) — ${category} | Dragon Ball`.

---

## 3. UI / UX & Design Systems

- **Tri-Linguistic Readiness (EN / FR / JA)**:
  - User interfaces designed to be fully i18n-ready.
  - Text containers must gracefully handle text expansion: French text is typically 25% to 35% longer than English, while Japanese is compact and glyph-dense.
- **Typography & CJK Glyph Rendering**:
  - Robust font-stacks incorporating high-legibility Japanese typography (Noto Sans JP, Hiragino Kaku Gothic, Meiryo) ensuring Japanese kanji (`孫悟空`, `超サイヤ人`) render crisply alongside Latin fonts without layout shifts or clipping.
- **Visual Hierarchies**:
  - Display primary international/French labels clearly while highlighting authentic Japanese source names in subheaders or badge chips.

---

## 4. AI, RAG & LLM Integration

- **Multilingual Knowledge Embeddings**:
  - Embedding models and vector search indexing must support cross-lingual similarity (e.g., querying in English or French retrieves Japanese databook excerpts).
- **Author Citations & Grounding Truth**:
  - Any author statement (Akira Toriyama, Toyotarō, Shueisha editors, V-Jump) must preserve the **original Japanese text** (`original_ja`) as the immutable grounding evidence.
  - French and English translations are mapped alongside the Japanese quote to eliminate translation distortion or hallucination.

---

## 5. Data & Database Schemas

- **Multilingual Entity Columns**:
  - Schema convention for core encyclopedia tables:
    - `name` (text, not null) — localized name or global standard.
    - `name_ja` (text) — native Japanese script (Kanji/Kana).
    - `name_romaji` (text) — official Hepburn romanization.
    - `slug` (text, not null, indexed) — international kebab-case slug.
- **Backward Compatibility**:
  - All accessors and resolvers (`getShenronCharacter`, API endpoints, Discord bot queries) accept both `id: number` and `slug: string` seamlessly.
