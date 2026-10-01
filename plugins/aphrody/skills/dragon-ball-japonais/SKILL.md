---
name: dragon-ball-japonais
description: "Vérifie le japonais Dragon Ball, les graphies, le rōmaji et les traductions depuis le corpus et le lexique Dragonballfr; consulte les sources."
---

# Japonais Dragon Ball — vocabulaire, lexique, traduction

Le japonais de Dragon Ball ne se traite pas comme du japonais courant, et c'est
la seule chose à retenir avant de commencer : **son vocabulaire n'est dans aucun
dictionnaire**. `かめはめ波`, `界王拳`, `ギャリック砲`, `ベジータ` sont absents de
JMdict comme d'IPADIC. Un modèle de traduction généraliste rend donc
`孫悟空は界王拳を使った` par « Son-gu a utilisé le poing du roi » — grammaire
juste, sens perdu.

D'où cette skill : le lexique de dragonballfr.com associe chaque graphie
japonaise à sa forme française **officielle**, et les databooks fournissent le
corpus qui permet de vérifier au lieu de deviner.

## La règle qui prime sur toutes les autres

**Vérifier une graphie dans le corpus avant de l'affirmer.** Un nom japonais de
fiction ne se déduit ni de la prononciation, ni de la romanisation : il s'écrit
d'une façon précise, souvent en mêlant kana et kanji (`かめはめ波` — trois
hiragana puis un kanji, pas `カメハメ波` ni `亀破波`).

La vérification est directe : si la graphie apparaît dans les planches
transcrites, elle est attestée. Sinon, dis que tu n'es pas sûr.

```bash
# La graphie est-elle réellement écrite dans les databooks ?
curl -s "https://dragonballfr.com/api/databooks/search?q=%E7%95%8C%E7%8E%8B%E6%8B%B3&limit=3" \
  | jq '{total, fiches, ou: [.items[] | {titre, planche: .numero}]}'
```

Fréquences mesurées sur le corpus (2026-08-22) : `かめはめ波` 570×, `元気玉` 215×,
`瞬間移動` 207×, `界王拳` 133×, `龍拳` 120×, `ギャリック砲` 28×.

## Chercher dans le japonais réel

`/api/databooks/search` cherche **dans le texte des planches**, japonais compris.
C'est un index trigramme et non une recherche plein texte : le japonais n'ayant
pas d'espaces, `to_tsvector` en fait un lexème unique et ne trouve rien à
l'intérieur d'un mot. Les trigrammes découpent par caractères et n'ont pas ce
défaut.

```bash
# Un passage japonais, avec l'ouvrage et le numéro de planche
curl -s "https://dragonballfr.com/api/databooks/search?q=$(printf '%s' 'ギニュー特戦隊' | jq -sRr @uri)&limit=5" \
  | jq '.items[] | {titre, planche: .numero, extrait: .texte[0:120]}'
```

Ne cherche pas un terme de moins de trois signes : l'index ne peut pas s'y
appliquer, et le résultat sera bruité.

## Obtenir la forme française officielle

Le wiki est la source. `name_ja` porte la graphie japonaise, `name` la forme
française retenue — celle qu'il faut employer en traduction.

```bash
# Recherche transverse : renvoie name + name_ja pour chaque entité trouvée
curl -s "https://bot.dragonballfr.com/api/public/wiki/search?q=Vegeta&limit=5" \
  | jq '.characters[] | {name, name_ja}'
```

L'API publique du wiki est sur `bot.dragonballfr.com/api/public`, sans
authentification. Ne passe pas par `dragonballfr.com/api/bot-user/…` : ces
routes-là exigent une session.

Couverture mesurée le 2026-09-12 : 1 023 personnages, 187 techniques, 47
planètes et 8 races portent une graphie japonaise utilisable. Les techniques
restent la lacune connue — 808 des 825 n'ont aucun nom japonais, essentiellement
des compétences de jeux vidéo sans graphie canonique.

## Traduire

Traduis **en protégeant le vocabulaire du domaine**. La méthode qui fonctionne,
mesurée :

1. repérer dans le texte les termes présents au lexique ;
2. les remplacer par des marqueurs neutres ;
3. traduire le texte masqué ;
4. réinjecter la forme française officielle.

Le marqueur qui tient dépend du moteur, et cela se vérifie plutôt que se
suppose. Mesuré le 2026-09-12 : sur Google (par bxc), `⟦0⟧` traverse intact et
**suit la grammaire de la langue cible** — « Le ⟦0⟧ de ⟦1⟧ » ressort en
« ⟦1⟧ の ⟦0⟧ ». Sur NLLB en local, le même marqueur se fait réécrire ou perdre,
et seuls des noms propres latins courts et improbables (`Zeta`, `Yuni`) passent.

L'écart est net sur les mêmes phrases :

|                                  | Sans protection                               | Avec                                         |
| -------------------------------- | --------------------------------------------- | -------------------------------------------- |
| `孫悟空は界王拳を使った`         | Son-gu a utilisé le poing du roi              | **Son Goku** a utilisé le **Kaiô-ken**       |
| `ベジータはサイヤ人の王子だ`     | Végitta est le prince des Saïyas              | **Vegeta** est le prince des **Saiyans**     |
| `ピッコロとクリリンが地球を守る` | Les picolo et les crillins protègent la Terre | **Piccolo** et **Krilin** protègent la Terre |

Toujours **masquer du plus long au plus court** : sinon `サイヤ` mord sur
`サイヤ人` et laisse un `人` orphelin.

## La chaîne outillée du dépôt

Rien de tout cela ne se refait à la main : le dépôt porte les trois pièces.

| Pièce | Où | Ce qu'elle fait |
| --- | --- | --- |
| Lexique hors ligne | `apps/site/messages/glossary.json` | 1 316 noms construits depuis nos tables par `scripts/i18n-glossary-build.ts`, avec la graphie japonaise quand elle existe |
| Masquage / restitution | `apps/site/src/lib/i18n/glossary.ts` | `protect`, `restore`, `spell` ; un jeton perdu par le moteur revient dans `missing` et la phrase est refusée |
| Moteur sans clé | `bxc google translate` | une phrase en ligne de commande, ou un LOT par l'émulateur d'API sur `127.0.0.1:8089` |

```bash
# Un lot de segments en un seul appel — c'est ce qui rend 12 000 planches tenable
bun ~/bxc/src/cli/index.ts google translate --serve &
curl -s -X POST http://127.0.0.1:8089/language/translate/v2 \
  -H 'Content-Type: application/json' \
  -d '{"q":["孫悟空は界王拳を使った"],"source":"ja","target":"fr"}' \
  | jq -r '.data.translations[].translatedText'

# La boucle complète sur les planches de databooks : file, masquage, juge, dépôt signé
bun apps/site/scripts/traduction-boucle.ts --lots 1 --moteur google      # à blanc
```

Deux gardes de cette chaîne méritent d'être connues, parce qu'elles viennent
d'erreurs réelles. La casse distingue le nom du mot commun : Toriyama a nommé ses
personnages d'après l'épicerie, et protéger « acide » figerait un adjectif
ordinaire. Et quand deux fiches revendiquent le même nom avec des graphies
différentes — Vegeta le prince et Vegeta la planète, romanisée `Bejiita-sei` —
aucune n'est retenue : le terme retombe sur sa forme française.

## Ce dont il faut se méfier

**Les transcriptions sont automatiques, donc bruitées.** Sur le corpus mesuré,
`ブルマ` est lu `フルマ`, `ピッコロ` lu `ビッコロ`, `ブロリー` lu `プロリー` — et
`ドラゴンボール` lui-même est mal lu 95 fois. Une graphie isolée trouvée dans une
seule planche peut être une erreur de lecture ; une graphie répétée dans
plusieurs ouvrages est fiable.

Le champ `name_ja` du wiki n'est pas normalisé : il empile parfois variantes et
rōmaji dans la même cellule (`ザマスの意思, Zamasu no Ishi, 無限ザマス`). Éclate sur
les virgules et ne garde que ce qui contient réellement du japonais.

Enfin, les points médians varient d'une source à l'autre — `・` (U+30FB), `･`
(U+FF65), `·` (U+00B7). `ミスター・ポポ` et `ミスターポポ` désignent le même
personnage : compare en les retirant.

## Références

- `references/lexique.md` — graphies vérifiées, jeux de mots de Toriyama, pièges
  de translittération
- `references/outils.md` — chaîne de traitement du dépôt (kuromoji, JMdict,
  scripts d'analyse) pour qui travaille sur le code
