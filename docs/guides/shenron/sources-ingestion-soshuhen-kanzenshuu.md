# Pipeline d'Ingestion : Archives Sōshūhen (Jump Digest) & Guides Kanzenshuu

Ce document technique formalise les protocoles d'ingestion, d'alignement et d'indexation RAG pour deux sources documentaires fondamentales de l'écosystème Dragon Ball :
1. **L'édition Sōshūhen (総集編 - Weekly Shōnen Jump Digest Edition)**
2. **Les archives et guides de référence Kanzenshuu**

---

## 1. Édition Sōshūhen (Shueisha, 2016–2017)

### 1.1 Définition & Valeur Documentaire pour Shenron
L'édition *Dragon Ball Sōshūhen* (18 tomes grand format B5) reproduit **à l'identique l'expérience de lecture originale dans le Weekly Shōnen Jump** (1984–1995) :
- **Pages couleur d'origine** : Préservation intégrale des chapitres en quadrichromie (4 couleurs) et bichromie (2 couleurs / rouge-noir), tronquées ou converties en noir et blanc dans les tankōbon standards.
- **Titres et bandeaux de prépublication** : Typographies manuscrites originales des titres de chapitres, accroches de début de chapitre et aperçus du numéro suivant (*Next Issue Teasers*).
- **Commentaires hebdomadaires d'Akira Toriyama** : Restitution des 519 encarts d'auteur hebdomadaires de la table des matières du *Jump* contemporains de la rédaction.
- **Double-pages intégrales non rognées** : Conservation des bords de coupe originaux perdus lors de la reliure des volumes reliés.

### 1.2 Schéma d'Ingestion PostgreSQL (`shenron_site`)

Chaque tome de la collection Sōshūhen est rattaché à `bot.db_media_publications` et enrichit les métadonnées de chapitres `bot.db_manga_chapters` :

```typescript
interface SoshuhenVolumeRecord {
  volumeNumber: number; // 1 à 18
  titleJa: string; // Ex: "DRAGON BALL 総集編 超悟空伝 Legend 1"
  subtitleFr: string; // Ex: "Sōshūhen Légende 1 : Enfantillage & Quête"
  chaptersRange: [number, number]; // [1, 24]
  publishedAt: string; // 2016-05-13
  rawJumpColorPagesCount: number;
  originalToriyamaCommentsCount: number;
  coverAssetPath: string; // "/images/manga/soshuhen/legend-01.webp"
}

interface SoshuhenChapterMetadata {
  chapterNumber: number; // 1 à 519
  jumpIssue: string; // Ex: "Weekly Shōnen Jump 1984 #51"
  jumpReleaseDate: string; // 1984-11-20
  hasColorPages: boolean;
  colorType: "4_colors" | "2_colors" | "monochrome";
  originalTitleHeader: string; // Calligraphie Jump
  toriyamaWeeklyComment: {
    ja: string;
    fr: string;
    source: "Weekly Shōnen Jump TOC / Sōshūhen";
  };
}
```

---

## 2. Guides Documentaires Kanzenshuu

### 2.1 Périmètre & Doctrine d'Autorité
Kanzenshuu (fusion de Daizenshuu EX et Kanzentai) constitue la référence internationale occidentale pour :
- **L'analyse des animateurs & superviseurs d'épisodes Toei** : Attribution plan par plan des séquences cultes aux directeurs d'animation (Minoru Maeda, Masaki Sato, Katsuyoshi Nakatsuru, Tadayoshi Yamamuro, Keisuke Masunaga).
- **Les traductions critiques d'interviews japonaises** : Vérification bilingue japonais/anglais des entretiens parus dans les *Daizenshuu*, *Chōzenshū*, *Shenlong Times* et brochures de cinéma.
- **Le Rumor Guide** : Réfutation méthodique des légendes urbaines et faux canons de fans (Super Saiyan 5, implication de Toriyama sur AF, fausses citations).

### 2.2 Règles Strictes d'Ingestion RAG & Wiki
1. **Recoupement Obligatoire** : Toute citation issue de Kanzenshuu doit conserver sa référence à l'imprimé japonais d'origine (*Source imprimée première*).
2. **Pas d'import de fan-théories** : Seules les données factuelles (numéros de publication, crédits de générique vérifiés, dates de diffusion) sont éligibles à l'ingestion dans `public.canon_references` et `bot.db_contributors`.
3. **Attribution Claire** : Métadonnées stockées avec `source_id = 'kanzenshuu_archive'` et mention du traducteur / archiviste d'origine.

---

## 3. Script Opérationnel Préparatoire

Le script `scripts/tools/shenron/scripts/ops/prepare-soshuhen-kanzenshuu-ingest.ts` permet de :
1. Valider l'intégrité des manifestes de chapitres Sōshūhen (1 à 18).
2. Vérifier les doublons de citations d'interviews avant insertion en base.
3. Préparer les chunks d'ingestion RAG au format `rag_chunks` avec les bons tags d'autorité.

### Commande d'Exécution :
```bash
bun scripts/ops/prepare-soshuhen-kanzenshuu-ingest.ts --dry-run
bun scripts/ops/prepare-soshuhen-kanzenshuu-ingest.ts --apply
```
