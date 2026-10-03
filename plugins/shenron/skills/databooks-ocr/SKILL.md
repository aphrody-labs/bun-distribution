---
name: databooks-ocr
description: "Transcrit visuellement des planches de databooks Dragon Ball en japonais (sous-agent lecteur), sortie JSONL, revue avant dépôt. Utiliser quand on a le scan sous les yeux ; sans scan lisible, répondre SCAN_INDISPONIBLE."
---

# OCR visuel des databooks

> **S'applique quand :** le scan de la planche est ouvrable avec la capacité visuelle du runtime ; le dépôt des résultats suppose en plus le monorepo Aphrody (`apps/shenron/site/scripts`, Bun) et un jeton fourni par l'opérateur. **Sinon :** réponds `SCAN_INDISPONIBLE` pour l'entrée (jamais de transcription devinée) et saute les scripts de lot et de dépôt.

Cette skill fait d'un sous-agent Claude ou Codex un **lecteur visuel** de
planches, pas un générateur de texte japonais plausible. Les outils MCP de
lecture `dragonball_databooks_*` servent à contextualiser une lecture, jamais à
remplacer le scan ; le sous-agent n'utilise aucun outil `dragonball_admin_*`.
Shenron reste l'unique validateur et écrivain du corpus.

## Entrée

Prendre soit un lot créé par :

```bash
bun apps/shenron/site/scripts/export-databooks-ocr.ts --sortie /chemin/vers/lots --taille 4
```

soit une file de relecture créée par :

```bash
bun apps/shenron/site/scripts/planches-a-relire.ts --classe remplacement --limite 4 --json
```

L'agent parent fournit à chaque sous-agent l'image locale ou l'attache dans son
contexte visuel, avec son identifiant `<databookId>-<page>.jpg`. N'envoyer que
1 à 4 planches par sous-agent : cela permet une vraie lecture et une seconde
vérification, plutôt qu'une réponse globale approximative.

Si l'image ne peut pas être ouverte avec la capacité visuelle du runtime,
répondre `SCAN_INDISPONIBLE` pour cette entrée. Ne jamais transcrire depuis le
nom de fichier, une miniature, l'OCR antérieur ou la mémoire du modèle.

## Lecture

1. Ouvrir le scan à taille lisible et le parcourir par blocs, dans l'ordre de
   lecture japonais (haut vers bas, droite vers gauche).
2. Restituer les titres, listes et paragraphes en Markdown ; conserver le
   japonais, sans le traduire.
3. Quand une graphie Dragon Ball reste ambiguë, interroger
   `dragonball_databooks_planches` (expression dans le texte transcrit des
   planches) ou `dragonball_databooks_get` (détail d'un ouvrage) via le MCP, ou
   `GET https://dragonballfr.com/api/databooks/search?q=…` sans MCP, pour
   chercher des occurrences comparables. Si le serveur est construit avec la
   fonctionnalité `dbfr`, `dbfr_pages` indique les planches encore sans
   transcription. Une occurrence existante est un indice, jamais une preuve qui autorise à
   inventer un glyphe invisible.
4. Un caractère réellement illisible devient `�`. Ne complète pas une phrase,
   ne déduis pas une onomatopée dessinée et ne « corrige » pas un nom propre à
   partir de sa vraisemblance.
5. Relire visuellement une fois le texte produit. Pour une planche suspecte,
   comparer à la transcription existante et ne changer que ce que l'image
   tranche.

## Sortie machine

Écrire exactement une ligne JSONL par image dans `resultats.jsonl`, sans prose
autour, avec la clé `image` conservée telle quelle :

```json
{ "image": "323-0007.jpg", "text": { "kind": "text", "markdown": "# タイトル\n\n本文" } }
```

Une planche réellement sans texte reçoit `markdown: ""`. Une planche dont le
scan est inaccessible ne reçoit **aucune ligne** : elle reste à reprendre.
N'ajouter ni traduction, ni score inventé, ni appel d'écriture à l'API.

## Contrôle et dépôt Shenron

Le parent vérifie chaque résultat avant tout dépôt :

```bash
bun apps/shenron/site/scripts/databooks.ts verifie /chemin/vers/resultats.jsonl
bun apps/shenron/site/scripts/databooks.ts depose /chemin/vers/lot --simulation
bun apps/shenron/site/scripts/databooks.ts depose /chemin/vers/lot
```

Pour étalonner un sous-agent visuel contre des références déjà relues :

```bash
bun apps/shenron/site/scripts/export-databooks-benchmark.ts --sortie /tmp/dbfr-benchmark --taille 64
bun apps/shenron/site/scripts/score-databooks-ocr.ts /tmp/dbfr-benchmark/benchmark.jsonl /chemin/vers/resultats.jsonl
```

Le dépôt final passe par Shenron : il conserve les gardes de qualité et crée les
révisions réversibles. Aucun sous-agent ne reçoit de jeton ni d'accès direct à
PostgreSQL.
