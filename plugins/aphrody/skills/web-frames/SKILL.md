---
name: web-frames
description: "@aphrody/frames: anime frame indexing and search, MPEG-7 ColorLayout, SQLite frame index, ffmpeg args, trace.moe fallback; aphrody web frames CLI."
metadata:
  short-description: Index and search anime episodes frame by frame.
---

# @aphrody/frames

Index image par image d'épisodes (`https://github.com/aphrody-code/frames`) : descripteur MPEG-7
ColorLayout calculé localement, compatible trace.moe.

## Surface

| Symbole | Fichier | Rôle |
|---|---|---|
| `extractColorLayout`, `CL_DIMS` | `src/descriptor.ts` | Descripteur ColorLayout (Y/Cb/Cr sur DCT) |
| `encodeVector`, `decodeVector`, `packVector`, `unpackVector` | `src/descriptor.ts` | Sérialisation compacte pour SQLite |
| `colorLayoutDistance`, `similarityFromDistance` | `src/descriptor.ts` | Distance et score de similarité |
| `buildFrameArgs`, `buildProbeArgs`, `parseProbe`, `probeMedia`, `decodeStill` | `src/ffmpeg.ts` | Pilotage ffmpeg (arguments construits, jamais concaténés) |
| `FrameIndex`, `defaultIndexPath` | `src/store.ts` | Index SQLite |
| recherche | `src/search.ts` | Requête locale puis repli trace.moe |

CLI : `aphrody web frames index|search|vector|list|stats|quota`, mode `auto|local`.

## Points de vigilance

`defaultIndexPath()` lit `BXC_FRAMES_DB` puis retombe sur
`~/.cache/bxc/frames.db`, et passe le résultat par `resolve()` : la valeur
renvoyée porte le **séparateur natif**. Un test qui compare à `"/tmp/x.db"`
échoue sous Windows — comparer à `resolve("/tmp/x.db")`.

`FrameIndex` prépare ses requêtes une fois et les finalise dans `close()`, qui
est idempotent : sans cela le fichier `.db` reste verrouillé sous Windows et les
tests ne peuvent plus le supprimer.

La source canonique des épisodes est désormais maintenue dans `niers`, pas dans Aphrody Web.
