# Lexique japonais — graphies vérifiées

Toutes les graphies de ce document ont été **comptées dans le corpus** des
databooks de dragonballfr.com le 2026-08-22 (plus de 6 000 planches
transcrites). Le nombre entre parenthèses est le nombre d'occurrences : il
mesure l'attestation, pas l'importance.

Une graphie absente d'ici n'est pas fausse pour autant — vérifie-la :

```bash
curl -s "https://dragonballfr.com/api/databooks/search?q=$(printf '%s' 'TERME' | jq -sRr @uri)&limit=3" | jq '.total'
```

## Personnages

| Japonais         | Français       | Corpus |
| ---------------- | -------------- | ------ |
| `孫悟空`         | Son Goku       | 1 507  |
| `カカロット`     | Kakarot        | 115    |
| `ベジータ`       | Vegeta         | 2 686  |
| `ピッコロ`       | Piccolo        | 1 770  |
| `フリーザ`       | Freezer        | 2 400  |
| `セル`           | Cell           | 2 214  |
| `魔人ブウ`       | Majin Boo      | 686    |
| `トランクス`     | Trunks         | 1 202  |
| `ブルマ`         | Bulma          | 1 086  |
| `クリリン`       | Krilin         | 1 025  |
| `孫悟飯`         | Son Gohan      | 420    |
| `天津飯`         | Tenshinhan     | 652    |
| `ヤムチャ`       | Yamcha         | 543    |
| `亀仙人`         | Tortue Géniale | 321    |
| `武天老師`       | Maître Roshi   | 29     |
| `神龍`           | Shenron        | 524    |
| `ギニュー特戦隊` | Commando Ginyu | 78     |

Note : `亀仙人` (« l'ermite tortue ») et `武天老師` désignent le même personnage.
Le premier domine largement dans les databooks.

## Peuples, lieux, états

| Japonais         | Français          | Corpus |
| ---------------- | ----------------- | ------ |
| `ドラゴンボール` | Dragon Ball       | 3 104  |
| `サイヤ人`       | Saiyan            | 3 009  |
| `超サイヤ人`     | Super Saiyan      | 1 627  |
| `ナメック星`     | Namek             | 896    |
| `人造人間`       | Cyborg / Androïde | 780    |
| `界王様`         | Kaïo              | 44     |

`人造人間` se traduit littéralement « humain artificiel ». Le français officiel
hésite entre « cyborg » et « androïde » selon les éditions — vérifie la forme
retenue dans le wiki avant de trancher.

## Techniques

Renseignées en base et attestées dans le corpus :

| Japonais       | Français         | Corpus |
| -------------- | ---------------- | ------ |
| `かめはめ波`   | Kamehameha       | 570    |
| `超かめはめ波` | Super Kamehameha | 14     |
| `元気玉`       | Genkidama        | 215    |
| `超元気玉`     | Super Genkidama  | 24     |
| `瞬間移動`     | Téléportation    | 207    |
| `界王拳`       | Kaiô-ken         | 133    |
| `龍拳`         | Poing du dragon  | 120    |
| `残像拳`       | Image rémanente  | 60     |
| `気功砲`       | Kikôhô           | 41     |
| `魔貫光殺砲`   | Makankôsappô     | 37     |
| `気円斬`       | Kienzan          | 37     |
| `ギャリック砲` | Galick Gun       | 28     |
| `魔閃光`       | Masenkô          | 21     |
| `操気弾`       | Sôkidan          | 3      |

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
| « le poing du roi »     | **Kaiô-ken** (`界王拳` traduit littéralement) |
| « une vague de coups »  | **Kamehameha**                                |

Les deux dernières lignes sont le motif à retenir : une technique dont le nom
est composé de kanji se fait **traduire littéralement** au lieu d'être
translittérée. `界王拳` = `界王` (roi des mondes) + `拳` (poing) — d'où « poing du
roi », grammaticalement correct et complètement faux.
