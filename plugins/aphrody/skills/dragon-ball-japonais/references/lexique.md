# Lexique japonais — graphies vérifiées

> **S'applique quand :** tu cites une graphie japonaise de ce lexique et que `https://dragonballfr.com/api/databooks/search` est joignable pour la revérifier. **Sinon :** présente la graphie comme « attestée le 2026-08-22, non revérifiée » ou laisse-la vide.

Toutes les graphies de ce document ont été **comptées dans le corpus** des
databooks de dragonballfr.com le 2026-08-22 (plus de 6 000 planches
transcrites). La colonne « Corpus » est le nombre d'occurrences à cette date : il
mesure l'attestation, pas l'importance, et il augmente (la transcription
continue ; le 2026-10-01, `かめはめ波` donnait 737 au lieu de 570). Seuls les
ordres de grandeur sont réutilisables : revérifie avec la commande ci-dessous.

Une graphie absente d'ici n'est pas fausse pour autant — vérifie-la :

```bash
curl -s "https://dragonballfr.com/api/databooks/search?q=$(printf '%s' 'TERME' | jq -sRr @uri)&limit=3" | jq '.total'
```

## Comment lire la colonne « Wiki `name` »

Elle donne le champ `name` de la fiche du wiki (`/api/public/wiki/search`)
dont `name_ja` contient la graphie, relevé le 2026-10-01. « non trouvé » veut
dire que cette recherche n'a rien renvoyé : n'invente alors aucune forme
française, vérifie dans le wiki. Une même graphie peut avoir plusieurs fiches
(variantes, futur, jeux) ; prends la fiche qui correspond au support cité.

## Personnages

| Japonais         | Wiki `name` (2026-10-01)               | Corpus |
| ---------------- | -------------------------------------- | ------ |
| `孫悟空`         | Son Goku (aussi « Goku »)              | 1 507  |
| `カカロット`     | non trouvé                             | 115    |
| `ベジータ`       | Vegeta                                 | 2 686  |
| `ピッコロ`       | Piccolo                                | 1 770  |
| `フリーザ`       | Freezer                                | 2 400  |
| `セル`           | Cell                                   | 2 214  |
| `魔人ブウ`       | « Majin Boo » et « Majin Buu » (deux fiches) | 686 |
| `トランクス`     | Trunks                                 | 1 202  |
| `ブルマ`         | Bulma                                  | 1 086  |
| `クリリン`       | Krilin                                 | 1 025  |
| `孫悟飯`         | Gohan                                  | 420    |
| `天津飯`         | Tenshinhan                             | 652    |
| `ヤムチャ`       | Yamcha                                 | 543    |
| `亀仙人`         | « Master Roshi » et « Kamé Sennin » (deux fiches) | 321 |
| `武天老師`       | non trouvé                             | 29     |
| `神龍`           | Shenron                                | 524    |
| `ギニュー特戦隊` | non trouvé (le wiki a `ギニュー隊長` : « Ginyu ») | 78 |

Note : `亀仙人` (« l'ermite tortue ») et `武天老師` désignent le même personnage
(le wiki n'a pas de fiche `武天老師` le 2026-10-01) ; le premier domine largement
dans le corpus.

## Peuples, lieux, états

| Japonais         | Wiki `name` (2026-10-01) | Corpus |
| ---------------- | ------------------------ | ------ |
| `ドラゴンボール` | non trouvé               | 3 104  |
| `サイヤ人`       | Saiyan                   | 3 009  |
| `超サイヤ人`     | non trouvé               | 1 627  |
| `ナメック星`     | non trouvé               | 896    |
| `人造人間`       | fiches « Android 17 », « Android 16 » (`人造人間17号`, `人造人間16号`) | 780 |
| `界王様`         | non trouvé               | 44     |

`人造人間` se traduit littéralement « humain artificiel ». Le français hésite
entre « cyborg » et « androïde » selon les éditions — vérifie la forme retenue
dans le wiki avant de trancher.

## Techniques

Renseignées en base et attestées dans le corpus :

| Japonais       | Wiki `name` (2026-10-01) | Corpus |
| -------------- | ------------------------ | ------ |
| `かめはめ波`   | Kamehameha               | 570    |
| `超かめはめ波` | Super Kamehameha         | 14     |
| `元気玉`       | Genkidama                | 215    |
| `超元気玉`     | Super Genkidama          | 24     |
| `瞬間移動`     | Téléportation            | 207    |
| `界王拳`       | Kaioken                  | 133    |
| `龍拳`         | non trouvé               | 120    |
| `残像拳`       | Image rémanente          | 60     |
| `気功砲`       | Kikoho                   | 41     |
| `魔貫光殺砲`   | Makankosappo             | 37     |
| `気円斬`       | Kienzan                  | 37     |
| `ギャリック砲` | Canon Garric             | 28     |
| `魔閃光`       | Masenko                  | 21     |
| `操気弾`       | Sokidan                  | 3      |

**Piège d'écriture** : `かめはめ波` mêle trois hiragana et un kanji. Ni
`カメハメ波`, ni `亀破波`, ni tout en kana. De même `気円斬` s'écrit en kanji, pas
`キエンザン`.

## Jeux de mots de Toriyama

Presque tous les noms sont des calembours, par familles. C'est une lecture
**établie de longue date**, pas une donnée de notre base — utile pour
comprendre, à ne pas présenter comme sourcée par le wiki.

- **Légumes** (Saiyans) : Vegeta ← _vegetable_ ; Kakarot ← _carrot_ ;
  Raditz ← _radish_ ; Nappa ← `菜っ葉` (feuilles vertes) ; Broly ← _broccoli_.
  « Saiyan » lui-même est l'anagramme de `やさい` (_yasai_, légume).
- **Sous-vêtements** (famille Briefs) : Bulma ← _bloomers_ ; Trunks ← caleçon ;
  Dr Briefs ← slip.
- **Produits laitiers** (Commando Ginyu) : `ギニュー` ← `牛乳` (_gyūnyū_, lait) ;
  Butter, Recoome ← _cream_, Jeece ← _cheese_, Guldo ← _yogurt_.
- **Froid** (famille de Freezer) : Freezer, Cooler, King Cold.
- **Limaces** (Namek) : `ナメック` ← `ナメクジ` (_namekuji_, limace).

## Pièges de translittération

Les modèles généralistes translittèrent au son et se trompent :

| Sortie fautive courante | Forme correcte                                |
| ----------------------- | --------------------------------------------- |
| Végitta, Vegita         | **Vegeta**                                    |
| Frézza, Freeza          | **Freezer** (français officiel)               |
| Son-gu, Songoku         | **Son Goku**                                  |
| Saïya, Saïyas           | **Saiyan** / **Saiyans**                      |
| « le poing du roi »     | **Kaioken** (`界王拳`, forme du wiki ; traduit littéralement par erreur) |
| « une vague de coups »  | **Kamehameha**                                |

Les deux dernières lignes sont le motif à retenir : une technique dont le nom
est composé de kanji se fait **traduire littéralement** au lieu d'être
translittérée. `界王拳` = `界王` (roi des mondes) + `拳` (poing) — d'où « poing du
roi », grammaticalement correct et complètement faux.
