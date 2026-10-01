---
name: dragon-ball-canon
description: "Vérifie la canonicité Dragon Ball selon la hiérarchie sourcée de dragonballfr.com et cite l’édition, la source et l’année. Pour toute question « canon ou non ? »."
---

# Canon Dragon Ball — arbitre sourcé

Le site tranche la canonicité avec une **doctrine éditée à la main** (rangs,
règles, sujets tranchés) et un **corpus de preuves ingéré 24h/24** : les
déclarations d'Akira Toriyama (interviews Daizenshuu, introductions des
tankōbon, Super Exciting Guide, Dragon Ball Forever) et les planches de
databooks transcrites puis traduites par le site. Aucun modèle de langage,
aucun wiki de fans, aucune requête sortante n'intervient dans le verdict.

## Les cinq rangs (autorité décroissante)

| Rang                   | Ce qu'il range                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| `CANON_ABSOLU`         | Manga original des 42 tomes, Jaco, Minus, ce que Toriyama a écrit lui-même |
| `CANON_SUPERVISE`      | Manga DBS, films Battle of Gods / Broly / Super Hero, Daima                 |
| `EXTENSION_OFFICIELLE` | Daizenshuu, Super Exciting Guide, Chōzenshū (supervisés ou préfacés)        |
| `NON_CANON_DERIVE`     | Fillers DB/DBZ, films vintage Toei, DBGT, jeux, SDBH                        |
| `APOCRYPHE_FANON`      | Rumeurs, fausses interviews, AF, Multiverse                                 |

Quand une source de rang inférieur contredit le manga, c'est elle qui a tort.

## Comment interroger

```bash
# Verdict + preuves pour une affirmation
curl -s "https://dragonballfr.com/api/canon?q=Broly+est-il+canon" | jq '{tier: .verdict.tier, score: .verdict.score, origine: .verdict.origine, verdict: .verdict.verdict}'

# Les déclarations de Toriyama et les planches citées
curl -s "https://dragonballfr.com/api/canon?q=Broly+est-il+canon" | jq '.references[] | {source, year, textFr}'

# La doctrine elle-même (rangs, règles, sujets tranchés)
curl -s "https://dragonballfr.com/api/canon" | jq '.entries[] | {title, tier}'

# Parcourir le corpus de preuves
curl -s "https://dragonballfr.com/api/canon/references?q=Kaioken&provenance=databooks&limit=5" | jq '.items[] | {source, href}'
```

Via le MCP local `aphrody-mcp` : outils `dragonball.canon_check` (verdict)
et `dragonball.canon_references` (corpus). Les noms complets et les schémas
sont ceux retournés par `tools/list`.

## Lire un verdict

- `origine` dit d'où vient le verdict : `entry:<id>` (sujet tranché à la main),
  `heuristic:<id>` (famille de formulations : « filler », « manga original »),
  `fallback` (**la doctrine ne sait pas**). Sur `fallback`, ne pas inventer un
  rang : dire que le sujet n'est pas tranché et citer les `references` s'il y
  en a.
- `references[]` : chaque item porte `text` (original, souvent anglais
  Kanzenshuu ou japonais), `textFr` (traduction relue), `source`, `year`,
  `href` (le scan de la planche quand c'est un databook). **Cite la source et
  l'année**, jamais « Toriyama a dit » sans référence.
- `planches[]` : image, transcription japonaise, traduction, ancre
  `/wiki/databooks/{id}#planche-{n}` — la pièce à conviction à un clic.
- `fiches[]` : les fiches du wiki qui parlent du sujet.
- `score` (0-100) est le degré d'autorité du rang, pas une probabilité.

## Règles de réponse

1. Réponds avec le rang, puis la raison, puis les preuves citées.
2. Distingue toujours manga (Toriyama), anime (Toei), databooks (Shueisha,
   supervisés) et jeux : un fait peut être vrai dans l'anime et absent du manga.
3. Une déclaration d'auteur n'est pas un verdict : elle est la phrase imprimée
   sur laquelle on tranche. Présente-la comme telle.
4. Jamais Fandom, jamais Reddit, jamais une « interview » sans source imprimée.
5. Si la question mélange plusieurs sujets, pose une question par sujet.

## Ressources liées

- Skill `dragon-ball` : RAG, wiki structuré, manga, `references/api.md` (section Canon).
- Skill `dragon-ball-japonais` : lexique et graphies officielles pour lire les planches citées.
- Page publique : https://dragonballfr.com/wiki/canon — éditeur : `/admin/canon`.
