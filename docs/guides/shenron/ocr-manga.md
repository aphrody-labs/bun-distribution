# OCR des planches → markdown

Objectif : transcrire le texte des planches manga (bulles + cartouches) en
**markdown** par tome — pour la lecture texte, l'accessibilité et l'indexation RAG.
Le manga self-hosté est majoritairement **français** (VF) ; cf.
[`docs/guides/shenron/manga-scans.md`](manga-scans.md).

Pour une revue hors ligne, `manga-revue-agents.ts prepare` accepte aussi
`--candidates <candidates.jsonl>` après conversion des sorties Koharu ou
`aphrody.ocr.result/v2` en `shenron.manga.review-candidate/v1` par le CLI
`@shenron/pipeline`. Le paquet conserve ces indices sous `candidatNonRelu`.
La commande revérifie l'identité et les SHA-256 du manifeste ainsi que les
octets de l'image. Le juge ouvre toujours l'image originale ; `sceller` exige
toujours la transcription visuelle et son audit indépendant avant tout résultat.

## Pourquoi pas Tesseract seul

Tesseract `fra` sur une planche extrait des fragments de bulles mais avec du **bruit
issu des dessins** et **sans ordre de lecture des cases** → markdown inutilisable tel
quel. Il faut une étape de **détection des bulles + ordre de lecture** en amont.

## Options évaluées (FR, CPU, à l'échelle)

| Approche                                                    | Layout / ordre | Langue         | CPU          | Note                                                                                   |
| ----------------------------------------------------------- | -------------- | -------------- | ------------ | -------------------------------------------------------------------------------------- |
| **PP-OCRv5 → revue VLM jointe**                             | oui            | multilingue ✅ | hybride      | Détection géométrique locale, puis arbitrage visuel conservateur. **Pipeline retenu.** |
| **VLM vision seul** (dots.ocr OSS ; ou modèle vision cloud) | oui (1 passe)  | multilingue ✅ | lent sur CPU | Les petits VLM locaux testés ont déclaré à tort des pages textuelles « sans texte ».   |
| manga-ocr (kha-white)                                       | bulles         | **JP only ❌** | oui          | Inadapté au VF.                                                                        |
| PaddleOCR seul / docTR                                      | partiel        | FR ✅          | oui          | Recognition correcte, layout faible.                                                   |

## Recommandation

- **Production** : PP-OCRv5 propose les régions et leur géométrie, puis deux
  sessions indépendantes `gpt-5.6-luna` en raisonnement `low` relisent l'image
  réellement jointe. La première transcrit ; la seconde audite exclusivement
  l'exhaustivité, les caractères, le type et l'ordre des régions.
- **Politique de refus** : si un seul caractère éditorial reste incertain, la
  planche devient `needs_human`. Un JSONL PP-OCR seul n'est jamais déposable.

Démarrer par la **VF Dragon Ball original (42 tomes)** ; un tome = un fichier
markdown `# Tome N` avec un bloc par case/bulle dans l'ordre de lecture.

## Pipeline de production

La chaîne opérationnelle couvre **Dragon Ball** (`DB`, 42 tomes réguliers + 2
Full Color) et **Dragon Ball Super** (`DBS`, 103 chapitres). Elle n'infère jamais
l'identité d'une planche depuis la sortie du modèle : le `manifest.json` signé
par SHA-256 fait autorité.

```text
assets/manga/{DB,DBS}/**/*.webp
  → export-manga-ocr.ts
  → runs/corpus-<sha>/lot-NNN/{manifest.json,images/*.jpg}
  → run-manga-ocr.ts → detections.jsonl (PP-OCRv5)
                     → reviews/*.json (gpt-5.6-luna/low + image jointe)
                     → coverage-audits/*.json (2e Luna/low indépendante)
                     → results.jsonl doublement arbitré → aphrody ocr audit
  → deposit-manga-transcriptions.ts (simulation, puis --appliquer)
  → PostgreSQL bot.db_manga_pages + public.wiki_revisions
  → materialize-manga-transcripts.ts → Markdown par tome → RAG
```

### 1. Générer les manifestes

Depuis la racine :

```bash
bun run manga:ocr:export -- --sortie data/manga-ocr
```

Le mode par défaut ne sélectionne que les planches sans texte dans le réplica
SQLite. `--tout` prépare une retranscription complète ; `--series DB` ou
`--series DBS` borne le corpus ; `--id DB:vol1:3` peut être répété pour un lot QA
exact ; `--plan` n'écrit rien. Avant un export sur le
VPS, laisser le reverse-sync PostgreSQL → SQLite terminer afin que le filtre des
planches manquantes parte d'un réplica frais.

Un run est immuable et adressé par le SHA-256 des sources et des paramètres de
réduction. `data/manga-ocr/current.json` (not in repo) pointe vers le run courant. Chaque
entrée de lot porte :

- l'identité stable `DB:vol12:7` ou `DBS:ch1315:29` ;
- le chemin source, sa taille et son SHA-256 ;
- l'image OCR réduite, sa taille et son SHA-256 ;
- la collection (`regular`, `fullcolor/...`, `principal`) et l'état déjà
  transcrit.

Le schéma versionné est
`packages/shenron/pipeline/scripts/manga-ocr-manifest.schema.json`. Une couverture non numérotée,
une autre série ou un doublon `(series,tome,planche)` est refusé.

### 2. Transcrire et auditer

```bash
bun run manga:ocr:run -- --root data/manga-ocr
```

Le runner appelle d'abord le moteur déterministe `aphrody ocr ppocr` avec
`ppocr-v5-mobile`. Ses textes, confiances et polygones sont conservés dans
`detections.jsonl` comme **indices**, à partir de 0,20 afin de ne pas masquer une
zone difficile. Il lance ensuite une revue `gpt-5.6-luna`/`low` avec l'image
jointe par `-i` et un schéma JSON strict. Une seconde session Luna `low`, elle
aussi alimentée par l'image originale, repart de l'image et cherche les régions
omises, erreurs de caractère, mauvais types et ordres. Elle ne voit la première
sortie que comme une proposition à contredire. Le dépôt exige son verdict
`confirm` sans aucune anomalie.

`results.jsonl` ne contient que les arbitrages hybrides. Les filigranes et
numéros restent traçables dans la revue mais sont exclus du Markdown. Une région
éditoriale `low` ou une seule anomalie du second arbitre impose `needs_human` et
neutralise le texte dans le résultat ; le runner termine alors avec un état
partiel et un code non nul. Le smoke réel a notamment corrigé les confusions
PP-OCR `SUIS → SLIS`, `UN → LN`, `voeu → vœu` et l'interprétation erronée du mot
imprimé « ILLISIBLE » comme une consigne.

Le runner est relançable : le JSONL est dédupliqué atomiquement après sauvegarde.
Chaque résultat porte aussi la version du prompt de revue ; le runner et le
dépôt écartent automatiquement une sortie produite par une version antérieure.
Un verrou local empêche deux consommateurs manga simultanés. Un verrou orphelin
n'est récupéré que si `owner.json` est son unique fichier et si son PID est
confirmé mort. Chaque image et chaque manifeste sont revérifiés par SHA-256 avant inférence, puis
`aphrody ocr audit` bloque les jetons de contrôle, générations coincées et
balisages survivants.

Options utiles : `--lot 2`, `--limit 1` ou plusieurs `--id` pour un smoke test,
`--retry-needs-human`, `--force-review`, `--min-confidence 0.20`, et `--dry-run`
pour vérifier tous les manifestes et fichiers sans les modifier ni charger le
modèle.

La QA visuelle d'un premier passage sur `DB:vol12:100` a détecté une acceptation
incorrecte : une petite adaptation latine avait été inventée et les grands
glyphes stylisés avaient été omis. Une passe durcie a encore accepté
`DB:vol14:37` avec le seul `CRAAK` en oubliant quatre énormes glyphes japonais.
Le second arbitre a correctement bloqué ce cas, ainsi que `DB:vol2:97` pour la
ligature manquée dans `vœu`, tout en confirmant `DB:vol3:215` comme réellement
sans texte malgré six faux positifs PP-OCR sur les points du front de Krilin.
Les prompts imposent un balayage des quatre bords et de chaque case, traitent
tout groupe de glyphes géant, incliné ou coupé comme un SFX, comptent aussi la
ponctuation isolée (`!!`, `?!`, `…`) et forcent `needs_human` dès qu'une région
n'est pas lisible en entier ou n'a pas été recensée.
Après tout changement de prompt, relancer avec `--force-review` au minimum toutes
les décisions `accept` obtenues par la version précédente.

### 3. Simuler puis déposer

```bash
bun run manga:ocr:deposit -- --root data/manga-ocr
bun run manga:ocr:deposit -- --root data/manga-ocr --appliquer
```

Le dépôt est **une simulation par défaut**. Il réexécute l'audit, exige un lot
complet et ne remplit que les lignes vides. Le parseur refuse explicitement les
résultats PP-OCR non arbitrés et les décisions `needs_human`, même avec
`--partiel`. Un texte existant différent devient
un conflit protégé ; seul `--remplacer --appliquer` autorise sa correction.
`--partiel` doit être explicite pour déposer un lot interrompu.

L'écriture cible PostgreSQL, source éditoriale de vérité. Elle prend un verrou
de table borné, conserve les identifiants existants, alloue les nouveaux IDs
sans collision et écrit une `public.wiki_revisions` **par planche modifiée**.
Chaque création ou correction est donc annulable depuis l'historique admin.
L'index unique `(series,tome,planche)` de `src/db/bot-indexes.sql` doit être
appliqué avant le premier dépôt.

### 4. Matérialiser et indexer

```bash
bun run manga:ocr:materialize
bun run --filter @shenron/bot manga:ocr:map
bun apps/bot/scripts/ingest-manga-rag.ts
```

La matérialisation relit PostgreSQL et réécrit atomiquement un Markdown par
tome/chapitre sous `assets/manga/transcripts/` (not in repo). Le build RAG reste une opération
séparée : conformément aux règles d'exploitation, ne jamais lancer `rag:build`
au premier plan sur le service de production.

## État mesuré au 2026-09-06

- 12 716 planches numériques DB + DBS sur disque (les 147 couvertures sont
  volontairement hors OCR) ;
- 12 577 transcriptions présentes dans le réplica ;
- 139 planches manquantes exportées en 2 lots vérifiés, run
  `corpus-3945f79955b1f7c9`.
- lot QA inter-séries de 4 planches (DB + DBS), run
  `corpus-c3ae02a7029bd19f` : 3 textes acceptés et 1 refus conservateur au premier
  passage, puis 4/4 après durcissement et seconde relecture visuelle.
