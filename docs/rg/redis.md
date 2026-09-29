# Redis — une instance, un registre de bases

Le VPS n'a **qu'un seul serveur Redis** : `127.0.0.1:6379`, unité
`redis-server.service`, configuration `/etc/redis/redis.conf`. Il n'y a jamais
eu de « Redis Rose Griffon » et de « Redis Achilléa » à fusionner — les deux
parlaient déjà au même processus. Ce qui manquait, c'est le registre de ce qui
vit dans quelle base logique, et une base par service plutôt que le fourre-tout
de la base par défaut.

## Registre

| Base | Propriétaire | Préfixes de clés | Volume constaté (20/09/2026) |
| ---: | --- | --- | ---: |
| 0 | *héritage — à ne plus utiliser pour du neuf* | `dbz:message:`, `dbz:user:`, `dbz:channel:` (projet Dragon Ball), `vector:inazuma-news:` | ~897 000 |
| 1 | Rose Griffon (`rg-bot`, site, `rg-cron`) — `REDIS_URL=redis://127.0.0.1:6379/1` | `vector:inazuma-news:` | ~32 000 |
| 2 | **Achilléa** (`achillea-bot`, files BullMQ) | `achillea:` | files transitoires |
| 3 | Index des fichiers CPK d'Inazuma Eleven (`apps/website/src/lib/cpk`) | `iev:file:`, `iev:tex:`, `iev:cpk:`, `iev:chara:` | ~3 900 |
| 4 | Atlas de symboles du RE toolkit | `atlas:addr:`, `atlas:sym:` | ~92 000 |
| 9 | Tests d'Achilléa | `achillea:` | volatile |

## Pourquoi Achilléa a changé de base

`apps/achillea-bot/src/configs/redis.ts` posait `db: 0` en production : la base
**par défaut**, celle où atterrit tout client qui n'en précise aucune. Elle
contenait déjà 900 000 clés appartenant à d'autres projets, et les trois files
d'Achilléa y portaient les noms les plus génériques possibles — `bull:main`,
`bull:clan`, `bull:sanctions`. N'importe quel autre service BullMQ du même
serveur les aurait prises pour les siennes, et une purge décidée ailleurs les
emportait.

Achilléa écrit désormais dans la base **2**, avec le préfixe BullMQ
`achillea` : même si deux services se retrouvaient un jour sur la même base,
leurs files resteraient distinctes.

La bascule s'est faite sans perte : les trois files étaient vides
(`wait`/`active`/`delayed` à zéro) au moment du changement, et les jobs de
BullMQ sont transitoires par nature.

## Ce qui reste à traiter

- **La base 0 porte des clés `dbz:*`**, c'est-à-dire des données du projet
  Dragon Ball, dont la doctrine d'hébergement veut qu'elles vivent sur le
  serveur `dbfr` et non ici. Ce n'est pas une urgence d'exploitation, mais
  l'anomalie est réelle et ce n'est pas au dépôt `rg` de la corriger.
- **`vector:inazuma-news:` existe dans les bases 0 ET 1.** Deux copies du même
  index vectoriel, dont une dans la base par défaut. À trancher : laquelle fait
  foi.

## Commandes utiles

```bash
redis-cli INFO keyspace                      # volumétrie par base
redis-cli -n 2 --scan --count 500 | head     # échantillon des clés d'Achilléa
redis-cli -n 2 LLEN achillea:main:wait       # profondeur d'une file
```
