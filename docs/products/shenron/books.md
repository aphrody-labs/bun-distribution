# Databooks — pipeline et audit live

Document opératoire pour les transcriptions japonaises des databooks. La
source de vérité est l'API databooks du site ; PostgreSQL local n'est pas
requis pour une reprise depuis un poste distant.

## Chaîne active

Deux commandes natives du monorepo Aphrody remplacent désormais les scripts ad-hoc :
`aphrody ocr dbfr` (HTTP direct vers l'API) et `aphrody ocr shenron` (spawn
`bun apps/shenron/site/scripts/databooks.ts`, réutilise le judge `classerDefaut`).
Voir `crates/infra/aphrody-command/src/ocr_dbfr.rs`,
`crates/infra/aphrody-command/src/ocr_shenron.rs` et le contrat
`docs/reference/ai/databooks-transcription-bridge.md`.

```text
aphrody ocr dbfr fetch-all
    ↓ pages[].text vide + pages[].image présente → lot local reprenable
aphrody ocr batch --engine vlm   (dots.ocr, GPU)
aphrody ocr batch --engine ppocr (PP-OCRv5, repli sur ce qui reste vide)
    ↓ drop_noise_blocks · is_page_furniture · content_score
    ↓ aphrody ocr audit — bloque boucles CJK, script étranger, remplacement
aphrody ocr dbfr push --apply    (ou aphrody ocr shenron deposit --apply)
    ↓ POST /api/databooks/:id/transcription · mode=merge
```

Orchestrateur bout-en-bout, sans humain dans la boucle :
`aphrody-ai/scripts/databooks-autopilot.sh [lot-root] [max-iter]` — boucle
fetch → OCR → audit → dépôt jusqu'à point fixe (plus aucune planche gagnée).

Les images sont servies par `bot.dragonballfr.com`, tandis que les données et
l'API d'écriture sont sur `dragonballfr.com`. Les pages sans scan ne sont pas
inventées ni effacées.

## État du corpus — 2026-09-08 21:19 Europe/Paris

| Indicateur | Valeur | Contrôle |
|---|---:|---|
| Ouvrages API | 370 | `aphrody ocr dbfr survey --json` |
| Planches API | 14 233 | `pages[]` |
| Planches avec scan | 13 720 | — |
| Planches transcrites | **13 592** | `pages[].text` non vide après dépôt |
| Planches manquantes | **128** | point fixe confirmé (autopilot, 2 itérations, 0 gain) |
| GPU | RTX 4070 | `nvidia-smi` |

Pipeline lancé et convergé sans intervention le 2026-09-08 (`aphrody
scripts/databooks-autopilot.sh`, commit `fc07d85b`). Les 128 planches
restantes se concentrent sur 4 lots (114/128) : lot 29 (43, scans 17 Mo/planche
— hors de portée du VLM au débit mesuré, 272 s/planche, exclu par le size-gate
`OVERSIZED_KIB=4096`), lot 312 (40), lot 36 (19), lot 362 (7) ; le reste est
dispersé sur des Saikyō/V Jump anciens. Aucun des deux moteurs n'en tire de
texte exploitable — considéré comme un vrai point fixe, pas un blocage.

### Correction de corpus — boucles CJK et scripts étrangers

Le 2026-09-08, un audit croisé (judge `classerDefaut` de ce dépôt contre
l'audit natif d'`aphrody`) a révélé que l'audit `aphrody` était aveugle aux
boucles de génération bloquée en japonais/chinois (segmentation par espaces
uniquement — sans effet sur du CJK sans espace) et n'avait aucune détection de
contamination par alphabet étranger (cyrillique/arabe/thaï/hangul mêlé à du
CJK). Corrigé dans `aphrody-ocr-core::audit` (scan caractère-par-caractère,
seuil aligné sur `classerDefaut` : 4-40 caractères minimum, sinon faux positifs
sur l'emphase chinoise légitime type 非常非常非常).

**23 planches fautives** déjà déposées ont été annulées (`text: null`, mode
`merge`, réversible et tracé dans `wiki_revisions`) sur 6 ouvrages : 5, 22, 36,
126, 354, 362. Boucles mesurées de 65x à plus de 3000x répétitions (dont une
planche de quiz comptant jusqu'à « Q326 » sur un questionnaire qui n'en a
jamais eu que 15).

## Règles de sécurité éditoriale

- `--skip-done` rend la reprise idempotente et évite les doubles lectures.
- Un résultat `kind: none` n'est jamais envoyé par défaut : il ne doit pas
  effacer une transcription existante.
- `aphrody ocr audit --json` bloque le dépôt sur les tokens de contrôle,
  boucles (CJK compris) ou script étranger mêlé à du CJK.
- Un lot mixte n'est pas publié partiellement par défaut : séparer les pages
  saines des pages fautives, puis auditer le sous-lot avant dépôt.
- Le dépôt utilise `merge` : seules les pages transcrites du lot sont ciblées.
- Le jeton vient de `apps/shenron/site/.env` (not in repo) (bridge `shenron`) ou de `$DBFR_TOKEN`
  côté `aphrody` (bridge `dbfr`) ; il n'est jamais affiché dans les journaux ni
  dans ce document.
- Le serveur résident `llama-server` n'est pas utilisé : il est expérimental
  et connu pour bloquer avec dots.ocr. Un seul worker donne le meilleur débit
  mesuré sur la RTX 4070 ; deux workers saturent la VRAM sans accélérer le run.
- Un lot dont les planches moyennent plus de 4 Mo est routé directement vers
  PP-OCR (repli CPU si l'inférence GPU échoue — CUDA 13 sans cuDNN) : le VLM
  n'est jamais lancé dessus par défaut (mesuré : 272 s/planche contre ~9 s
  normal sur un lot standard).

## Commandes de contrôle

```bash
aphrody ocr dbfr survey --include-hidden --top 30
aphrody ocr shenron doctor
bash scripts/databooks-autopilot.sh var/ocr-lots 6
```

Contrôle du worker et du GPU :

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'aphrody|llama-mtmd|llama-server' }
nvidia-smi --query-gpu=name,memory.used,utilization.gpu,pstate --format=csv
```

Le pipeline ne dépose qu'après succès de l'audit (deux juges : `aphrody` et
`classerDefaut`). En cas de défaut bloquant, le JSONL local est conservé pour
relecture et aucun dépôt n'est tenté.

## Reprise après audit

```bash
aphrody ocr shenron emit <id> --out <dir>
bun apps/shenron/site/scripts/databooks.ts verifie <dir>/resultats.jsonl
bun apps/shenron/site/scripts/databooks.ts depose <dir>/resultats.jsonl
```

Ne pas utiliser `--force` pour contourner l'audit : une page `vide`, en boucle
ou dans une langue étrangère doit être relue sur son scan. Après un dépôt
accepté, vérifier les compteurs via l'API, puis lancer le reverse-sync et la
mise à jour RAG selon [`databooks-doctrine.md`](../../reference/shenron/databooks-doctrine.md).

## Références

- [`databooks-doctrine.md`](../../reference/shenron/databooks-doctrine.md) — doctrine de qualité et de
  relecture.
- [`databooks-transcription.md`](../../guides/shenron/databooks-transcription.md) — contrat API et
  format JSONL.
- [`prompt-aphrody-ocr-databooks.md`](../../guides/shenron/prompt-aphrody-ocr-databooks.md) — contrat
  de sortie OCR.
- `crates/infra/aphrody-command/src/ocr_dbfr.rs` — pont HTTP natif
  (`aphrody ocr dbfr`).
- `crates/infra/aphrody-command/src/ocr_shenron.rs` — pont natif vers ce dépôt
  (`aphrody ocr shenron`).
- `docs/reference/ai/databooks-transcription-bridge.md` — contrat du pont côté
  Aphrody.
