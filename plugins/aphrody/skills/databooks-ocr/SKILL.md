---
name: databooks-ocr
description: "Transcrit visuellement les pages de databooks Dragon Ball en japonais; suit le pipeline OCR et exige une revue avant dépôt."
---

# OCR visuel des databooks

Cette skill fait d'un sous-agent Claude ou Codex un **lecteur visuel** de
planches, pas un générateur de texte japonais plausible. Le MCP Dragon Ball est
en lecture seule : il sert à contextualiser une lecture, jamais à remplacer le
scan. Shenron reste l'unique validateur et écrivain du corpus.

## Entrée

Prendre soit un lot créé par :

```bash
bun apps/site/scripts/export-databooks-ocr.ts --sortie /chemin/vers/lots --taille 4
```

soit une file de relecture créée par :

```bash
bun apps/site/scripts/planches-a-relire.ts --classe remplacement --limite 4 --json
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
3. Quand une graphie Dragon Ball reste ambiguë, interroger `databooks_search`
   ou `databooks_get` via le MCP pour chercher des occurrences comparables.
   Une occurrence existante est un indice, jamais une preuve qui autorise à
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
bun apps/site/scripts/databooks.ts verifie /chemin/vers/resultats.jsonl
bun apps/site/scripts/databooks.ts depose /chemin/vers/lot --simulation
bun apps/site/scripts/databooks.ts depose /chemin/vers/lot
```

Pour étalonner un sous-agent visuel contre des références déjà relues :

```bash
bun apps/site/scripts/export-databooks-benchmark.ts --sortie /tmp/dbfr-benchmark --taille 64
bun apps/site/scripts/score-databooks-ocr.ts /tmp/dbfr-benchmark/benchmark.jsonl /chemin/vers/resultats.jsonl
```

Le dépôt final passe par Shenron : il conserve les gardes de qualité et crée les
révisions réversibles. Aucun sous-agent ne reçoit de jeton ni d'accès direct à
PostgreSQL.
