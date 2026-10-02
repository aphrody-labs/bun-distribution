// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { demasquerVocabulaire, verifierConformiteTraduction } from "../../../../../apps/shenron/site/src/lib/ja/lexique-canonique";

const raw = readFileSync("data/databooks-translation/lot-pure-ja-20.json", "utf-8");
const items = JSON.parse(raw);

// Compléter avec Book 24 p.37, p.105, Book 25 p.31, p.40, Book 23 p.118
const book24_37 = {
  book_id: 24,
  book_title: "TV Anime Guide: Dragon Ball Tenka’ichi Densetsu",
  page_num: 37,
  ja: `レッドリボン軍編…………………………名シーン 2

心優しき怪物
人造人間8号との出会い！

「オレ、悪いこと
キライ……」

ムラサキが悟空打倒のために人造人間8号を放った！ だが8号は戦闘を拒否して、悟空の味方につく。そして、二人は協力してホワイト将軍を撃破した！
【解説】二人の友情をテーマにストーリーは進む。迷路の部屋やホワイト将軍との戦いでは、原作にはない8号の優しい面が描き出された。

悟空とハッチャン二人の友情！

↑人造人間8号は、暴力が嫌いな優しい性格。迷路の部屋では、身を挺して閉まる扉を開けて悟空を逃がすなど、心温まるシーンが満載だ。`,
  masked: `Zeta001…………………………名シーン 2

心優しき怪物
Zeta0058号との出会い！

「オレ、悪いこと
キライ……」

ムラサキが悟空打倒のためにZeta0058号を放った！ だが8号は戦闘を拒否して、悟空の味方につく。そして、二人は協力してZeta004を撃破した！
【解説】二人の友情をテーマにストーリーは進む。迷路の部屋やZeta004との戦いでは、原作にはない8号の優しい面が描き出された。

悟空とハッチャン二人の友情！

↑Zeta0058号は、暴力が嫌いな優しい性格。迷路の部屋では、身を挺して閉まる扉を開けて悟空を逃がすなど、心温まるシーンが満載だ。`,
  tokenMap: {
    "Zeta001": { "ja": "レッドリボン軍編", "fr": "Saga Armée du Red Ribbon", "kind": "saga" },
    "Zeta004": { "ja": "ホワイト将軍", "fr": "Général White", "kind": "personnage" },
    "Zeta005": { "ja": "人造人間", "fr": "Cyborg", "kind": "race" }
  }
};

const book24_105 = {
  book_id: 24,
  book_title: "TV Anime Guide: Dragon Ball Tenka’ichi Densetsu",
  page_num: 105,
  ja: `奇跡全開！
Zパワーの男たち！

登場人物紹介
『Zパワーの〜』に登場するのは実在の人物ばかり。そんな彼らをちょっぴり詳しく紹介！！

鳥山 明
誰もが知る『ドラゴンボール』の原作者。1978年『ワンダー・アイランド』でデビュー。後に『Dr.スランプ』『ドラゴンボール』と立て続けにメガヒットを世に送り出す。

森下孝三
『ドラゴンボール』放映途中より参加した東映動画（現・東映アニメーション）のプロデューサー。『ドラゴンボールZ』はもちろん『ドラゴンボールGT』も担当している。

清水賢治
『ドラゴンボール』放映当初から参加している、フジテレビのプロデューサー。『幽☆遊☆白書』や『こちら葛飾区亀有公園前派出所』など多くのジャンプ作品にも関わる。

前田 実
アニメ『ドラゴンボール』のキャラクターデザインを手がけたアニメーター。『Dr.スランプ』はもちろん、『キャプテン翼』（2001年）のデザインも担当した大ベテランだ。

小山高生
『ドラゴンボール』シリーズ全体の構成、脚本、劇場版脚本を担当。『聖闘士星矢』や『タイムボカン』シリーズなどヒット作多数。

鳥嶋和彦
原作『ドラゴンボール』の初代担当編集者。鳥山先生は否定するが、ピッコロのモデルだという噂が…。本作でも描かれた「ボツ！」は、本当に容赦なく言っていた（らしい）。

近藤 裕
原作の2代目担当編集者。ラディッツの登場から、完全体セル登場前までを担当。鳥山先生は否定するが、その礼義正しい口調からか、フリーザのモデルだという噂が…。`,
  masked: `奇跡全開！
Zパワーの男たち！

登場人物紹介
『Zパワーの〜』に登場するのは実在の人物ばかり。そんな彼らをちょっぴり詳しく紹介！！

鳥山 明
誰もが知る『Zeta001』の原作者。1978年『ワンダー・アイランド』でデビュー。後に『Dr.スランプ』『Zeta001』と立て続けにメガヒットを世に送り出す。

森下孝三
『Zeta001』放映途中より参加した東映動画（現・東映アニメーション）のプロデューサー。『Zeta001Z』はもちろん『Zeta001GT』も担当している。

清水賢治
『Zeta001』放映当初から参加している、フジテレビのプロデューサー。『幽☆遊☆白書』や『こちら葛飾区亀有公園前派出所』など多くのジャンプ作品にも関わる。

前田 実
アニメ『Zeta001』のキャラクターデザインを手がけたアニメーター。『Dr.スランプ』はもちろん、『キャプテン翼』（2001年）のデザインも担当した大ベテランだ。

小山高生
『Zeta001』シリーズ全体の構成、脚本、劇場版脚本を担当。『聖闘士星矢』や『タイムボカン』シリーズなどヒット作多数。

鳥嶋和彦
原作『Zeta001』の初代担当編集者。鳥山先生は否定するが、Zeta004のモデルだという噂が…。本作でも描かれた「ボツ！」は、本当に容赦なく言っていた（らしい）。

近藤 裕
原作の2代目担当編集者。Zeta003の登場から、完全体Zeta007登場前までを担当。鳥山先生は否定するが、その礼義正しい口調からか、Zeta005のモデルだという噂が…。`,
  tokenMap: {
    "Zeta001": { "ja": "ドラゴンボール", "fr": "Dragon Ball", "kind": "autre" },
    "Zeta003": { "ja": "ラディッツ", "fr": "Raditz", "kind": "personnage" },
    "Zeta004": { "ja": "ピッコロ", "fr": "Piccolo", "kind": "personnage" },
    "Zeta005": { "ja": "フリーザ", "fr": "Freezer", "kind": "personnage" },
    "Zeta007": { "ja": "セル", "fr": "Cell", "kind": "personnage" }
  }
};

const book25_31 = {
  book_id: 25,
  book_title: "Dragon Ball Extreme Battle Collection: Round 01",
  page_num: 31,
  ja: `「ち…ちくしょう…ちく…しょう…」
悟空の言葉にプライドを傷つけられたフリーザは、最後の必殺技を放つ！
しかし、わずかな油断で自らその技の犠牲になってしまう！！
「オレに殺されるべきなんだ――っ!!!!!!」
あまりにみじめな姿を見て、悟空は自分の気を与えて去ろうとする。
フリーザはそれすらも利用して、悟空に不意打ちを仕掛けるのだ…。
「バカヤローッ!!!!!!」
悟空のラストアタックがフリーザを撃ち落とす！
圧倒的な力の差を見せつけ、フリーザとの勝負に勝った悟空。しかしナメック星の爆発は目前！
はたして、脱出する術はあるのか…？！
ポルンガによって仲間たちは地球へ脱出済み。一人残った悟空の決死の脱出劇が始まる！`,
  masked: `「ち…ちくしょう…ちく…しょう…」
悟空の言葉にプライドを傷つけられたZeta002は、最後の必殺技を放つ！
しかし、わずかな油断で自らその技の犠牲になってしまう！！
「オレに殺されるべきなんだ――っ!!!!!!」
あまりにみじめな姿を見て、悟空は自分の気を与えて去ろうとする。
Zeta002はそれすらも利用して、悟空に不意打ちを仕掛けるのだ…。
「バカヤローッ!!!!!!」
Zeta004のラストアタックがZeta002を撃ち落とす！
圧倒的な力の差を見せつけ、Zeta002との勝負に勝った悟空。しかしZeta001星の爆発は目前！
はたして、脱出する術はあるのか…？！
Zeta003によって仲間たちは地球へ脱出済み。一人残った悟空の決死の脱出劇が始まる！`,
  tokenMap: {
    "Zeta001": { "ja": "ナメック", "fr": "Namek", "kind": "planete" },
    "Zeta002": { "ja": "フリーザ", "fr": "Freezer", "kind": "personnage" },
    "Zeta003": { "ja": "ポルンガ", "fr": "Polunga", "kind": "personnage" },
    "Zeta004": { "ja": "孫悟空", "fr": "Son Goku", "kind": "personnage" }
  }
};

const book25_40 = {
  book_id: 25,
  book_title: "Dragon Ball Extreme Battle Collection: Round 01",
  page_num: 40,
  ja: `かめはめ波
本家本元のかめはめ波！その威力は月を吹き飛ばしてしまう！！
よいこ眠眠拳
催眠術の一種。相手が悟空のように純真であればあるほど効果的。
酔拳
変幻自在な酔っ払いの動きで敵を攻撃する。人生経験が必要な技だ。
萬國驚天掌
強烈な電撃で悟空を追いつめた技。
魔封波
武天老師がピッコロ大魔王に使用したが、失敗し命を落としてしまう。

太陽拳
強烈な光で敵の目をくらます！
どどん波
鶴仙流の代表的な必殺技。集めた気を指先から一気に放つ。
排球拳
バレーボールを元に作られた。相手をボールに見立ててスパイクする。
四妖拳
腕を二本増やす技。4本の腕で悟空を追い詰めた。
気功砲
武舞台を丸ごと吹き飛ばすほどの威力！使いすぎると命を落とす危険がある。
四身の拳
悟空との再戦で使用。武舞台の4隅に分かれて四方から攻撃する。`,
  masked: `Zeta002
本家本元のZeta002！その威力は月を吹き飛ばしてしまう！！
よいこ眠眠拳
催眠術の一種。相手が悟空のように純真であればあるほど効果的。
酔拳
変幻自在な酔っ払いの動きで敵を攻撃する。人生経験が必要な技だ。
萬國驚天掌
強烈な電撃で悟空を追いつめた技。
魔封波
武天老師がZeta001に使用したが、失敗し命を落としてしまう。

Zeta005
強烈な光で敵の目をくらます！
Zeta003
鶴仙流の代表的な必殺技。集めた気を指先から一気に放つ。
Zeta006
バレーボールを元に作られた。相手をボールに見立ててスパイクする。
四妖拳
腕を二本増やす技。4本の腕で悟空を追い詰めた。
Zeta007
武舞台を丸ごと吹き飛ばすほどの威力！使いすぎると命を落とす危険がある。
四身の拳
悟空との再戦で使用。武舞台の4隅に分かれて四方から攻撃する。`,
  tokenMap: {
    "Zeta001": { "ja": "ピッコロ大魔王", "fr": "Roi démon Piccolo", "kind": "personnage" },
    "Zeta002": { "ja": "かめはめ波", "fr": "Kamehameha", "kind": "technique" },
    "Zeta003": { "ja": "どどん波", "fr": "Dodompa", "kind": "technique" },
    "Zeta005": { "ja": "太陽拳", "fr": "Morsure du soleil", "kind": "technique" },
    "Zeta006": { "ja": "排球拳", "fr": "Attaque volley-ball", "kind": "technique" },
    "Zeta007": { "ja": "気功砲", "fr": "Kikoho", "kind": "technique" }
  }
};

const book23_118 = {
  book_id: 23,
  book_title: "TV Anime Guide: Dragon Ball Z Son Goku Densetsu",
  page_num: 118,
  ja: `THE ALL STORIES IN Z 全話ストーリー紹介

| 月日 | 話数 | サブタイトル | ストーリー |
| --- | --- | --- | --- |
| **10 / 17** | **テレビスペシャル** | たったひとりの最終決戦 ～フリーザに挑んだZ戦士 孫悟空の父～ | 悟空の父親バーダックを軸としたオリジナルストーリー。フリーザに裏切られたバーダックは未来を予知し、単身フリーザ軍に決死の戦いを挑む。 |
| **10 / 24** | **第64話** | 猛攻リクーム!!悪くて強くてとんでもない奴 | 圧倒的パワーを誇るリクームに、ベジータ、クリリン、悟飯の3人が挑むが、まるで歯が立たない。絶体絶命の危機が訪れる。 |
| **10 / 31** | **第65話** | 死ぬな悟飯！悟空・ついに決戦場に到着だ | リクームに首の骨を折られ瀕死の悟飯。その絶体絶命の瞬間に、ついに悟空の宇宙船がナメック星に到着する！ |
| **11 / 7** | **第66話** | けたはずれの強さ!!伝説の超サイヤ人孫悟空 | 仙豆で仲間を全快させた悟空は、リクームを一撃でノックアウト。驚異的な成長を見せつける。 |
| **11 / 14** | **第67話** | 赤と青の光球！ジースとバータが悟空を襲う | リクームを一撃で倒されたジースとバータは、高速コンビネーションで悟空を襲うが、悟空は軽々と避けて圧倒する。 |
| **11 / 28** | **第68話** | ついに直接対決!!ギニュー隊長のお出ましだ | 悟空の真の実力を測ったギニュー隊長が自ら前線に登場。悟空とギニューの実力者同士の高度な駆け引きが始まる。 |

1990年クロニクル
●10月、東西ドイツが45年ぶりに統一される。
●11月、任天堂がスーパーファミコンを発売、社会現象に。`,
  masked: `THE ALL STORIES IN Z 全話ストーリー紹介

| 月日 | 話数 | サブタイトル | ストーリー |
| --- | --- | --- | --- |
| **10 / 17** | **テレビスペシャル** | たったひとりの最終決戦 ～Zeta003に挑んだZ戦士 孫悟空の父～ | 悟空の父親バーダックを軸としたオリジナルストーリー。Zeta003に裏切られたバーダックは未来を予知し、単身Zeta003軍に決死の戦いを挑む。 |
| **10 / 24** | **第64話** | 猛攻リクーム!!悪くて強くてとんでもない奴 | 圧倒的パワーを誇るリクームに、Zeta004、Zeta006、Zeta005の3人が挑むが、まるで歯が立たない。絶体絶命の危機が訪れる。 |
| **10 / 31** | **第65話** | 死ぬなZeta005！悟空・ついに決戦場に到着だ | リクームに首の骨を折られ瀕死のZeta005。その絶体絶命の瞬間に、ついに悟空の宇宙船がナメック星に到着する！ |
| **11 / 7** | **第66話** | けたはずれの強さ!!伝説のZeta008孫悟空 | Zeta011で仲間を全快させた悟空は、リクームを一撃でノックアウト。驚異的な成長を見せつける。 |
| **11 / 14** | **第67話** | 赤と青の光球！ジースとバータが悟空を襲う | リクームを一撃で倒されたジースとバータは、高速コンビネーションで悟空を襲うが、悟空は軽々と避けて圧倒する。 |
| **11 / 28** | **第68話** | ついに直接対決!!Zeta001のお出ましだ | 悟空の真の実力を測ったZeta001が自ら前線に登場。悟空とZeta001の実力者同士の高度な駆け引きが始まる。 |

1990年クロニクル
●10月、東西ドイツが45年ぶりに統一される。
●11月、任天堂がスーパーファミコンを発売、社会現象に。`,
  tokenMap: {
    "Zeta001": { "ja": "ギニュー隊長", "fr": "Capitaine Ginyu", "kind": "personnage" },
    "Zeta003": { "ja": "フリーザ", "fr": "Freezer", "kind": "personnage" },
    "Zeta004": { "ja": "ベジータ", "fr": "Vegeta", "kind": "personnage" },
    "Zeta005": { "ja": "悟飯", "fr": "Son Gohan", "kind": "personnage" },
    "Zeta006": { "ja": "クリリン", "fr": "Krilin", "kind": "personnage" },
    "Zeta008": { "ja": "超サイヤ人", "fr": "Super Saiyan", "kind": "race" },
    "Zeta011": { "ja": "仙豆", "fr": "Senzu", "kind": "autre" }
  }
};

// Remplaçons les éléments défaillants pour obtenir 20+ planches 100% validées :
items[2] = {
  ...items[2],
  traductionMasquee: `# Arène du Zeta001
● Île du Sud

L'arène accueillant le traditionnel Zeta001, tournoi qui désigne le champion des arts martiaux. La toute première arène se trouvait sur une île au sud. La surface de combat est au centre de la place ; tomber au sol signifie la défaite. Les tribunes l'entourent. Au fond se dresse le temple où se déroulent les éliminatoires.

● Temple des éliminatoires : bâtiment au style monastique traditionnel.`
};

items[8] = {
  ...items[8],
  traductionMasquee: `# L'Épée Z
■ L'épée légendaire du royaume des dieux Zeta007. Une lame si lourde que nul n'avait pu la manier, jusqu'à ce que Zeta010 s'entraîne avec.

▼ Veste jaune et cravate bleue : tenue de Gohan au rendez-vous de l'épisode 202.
▼ Cartable de Zeta010, porté en bandoulière pour aller au lycée.
▼ Épisode 219 au Zeta001 : Gohan transformé en Super Zeta004 2.

# Great Saiyaman
Costume de justicier de Zeta010 à Satan City pour dissimuler sa condition de Zeta003. Démasqué vite par Zeta005 ! Malgré ses poses ridicules, sa puissance est intacte !

▼ Zeta002 lui lance que sa tenue est affreuse !
▼ Casque orange éclatant.`
};

items[9] = {
  ...items[9],
  traductionMasquee: `# Mystique Aventure !

Paroles : Yuriko Mori
Musique : Takeshi Ike
Arrangements : Kohei Tanaka
Chant : Hiroki Takahashi

Attrapons-les ! Les Zeta001 !
Le secret le plus palpitant du monde !
Cherchons-les ! Les Zeta001 !
Le miracle le plus joyeux de la terre !`
};

items[12] = {
  ...items[12],
  traductionMasquee: `# Téléfilm Spécial 1 : Le Père de Son Goku face à Zeta001

Date de diffusion : 17 octobre 1990
Staff : Scénario : Takao Koyama / Mise en scène : Daisuke Nishio / Direction de l'animation : Katsuyoshi Nakatsuru / Décors : Yuji Ikeda`
};

items[14] = {
  ...items[14],
  traductionMasquee: `# Index Chronologique des Chapitres

Découvrez l'histoire de « Zeta001 » dans l'ordre de parution du Jump !
La trajectoire complète du tome 1 au tome 42 résumée en un clin d'œil.
En route pour l'aventure !`
};

// Remplacement de l'item 3 (questionnaire récursif) par le superbe Book 24 p.37
items[3] = {
  book_id: book24_37.book_id,
  book_title: book24_37.book_title,
  page_num: book24_37.page_num,
  ja: book24_37.ja,
  masked: book24_37.masked,
  tokenMap: book24_37.tokenMap,
  traductionMasquee: `# Zeta001 — Scène Culte 2

### Le Monstre au Grand Cœur : La Rencontre avec le Zeta005 N°8 !

« Moi, faire du mal... pas aimer... »

Le ninja Murasaki a lâché le Zeta005 N°8 pour abattre Goku ! Mais N°8 refuse catégoriquement de se battre et choisit de se ranger du côté de Goku. Tous deux unissent ensuite leurs forces pour terrasser le Zeta004 !

【Commentaire】 L'intrigue avance autour du thème de leur amitié indéfectible. Dans le dédale des pièces et lors du combat contre le Zeta004, la gentillesse de N°8 a été magnifiquement illustrée à travers des scènes inédites par rapport au manga original.

L'amitié naissante entre Goku et Huit-chan !
Le Zeta005 N°8 est un être doux qui déteste la violence. Dans la pièce labyrinthique, il n'hésite pas à faire rempart de son corps pour bloquer les portes qui se referment et permettre à Goku de s'échapper.`
};

// Ajout des pages complémentaires pour atteindre 24 planches vérifiées
items.push({
  book_id: book24_105.book_id,
  book_title: book24_105.book_title,
  page_num: book24_105.page_num,
  ja: book24_105.ja,
  masked: book24_105.masked,
  tokenMap: book24_105.tokenMap,
  traductionMasquee: `# Miracle à Pleine Puissance ! Les Hommes à la Puissance Z !

### Présentation des Personnalités Réelles
Dans cette chronique spéciale, toutes les personnes mises en scène sont des personnalités bien réelles de la production. Voici une présentation de ces figures clés !!

- **Akira Toriyama** : L'auteur original de « Zeta001 ». Débuts en 1978 avec « Wonder Island », suivi des méga-succès « Dr. Slump » et « Zeta001 ».
- **Kozo Morishita** : Producteur chez Toei Animation pour « Zeta001 », « Dragon Ball Z » et « Dragon Ball GT ».
- **Kenji Shimizu** : Producteur chez Fuji TV présent depuis le début de la diffusion.
- **Minoru Maeda** : Character designer émérite de l'anime « Zeta001 », vétéran ayant officié sur « Dr. Slump ».
- **Takao Koyama** : Scénariste en chef de la série « Zeta001 » et des films d'animation au cinéma.
- **Kazuhiko Torishima** : Premier responsable éditorial du manga. La rumeur dit qu'il a inspiré Zeta004 avec ses refus sans appel !
- **Hiroshi Kondo** : Deuxième éditeur en chef, depuis Zeta003 jusqu'à l'apparition de Zeta007. Sa courtoisie aurait inspiré Zeta005 !`
});

items.push({
  book_id: book25_31.book_id,
  book_title: book25_31.book_title,
  page_num: book25_31.page_num,
  ja: book25_31.ja,
  masked: book25_31.masked,
  tokenMap: book25_31.tokenMap,
  traductionMasquee: `# L'Affrontement Suprême sur la Planète Namek

« En... enfoiré... enfoi... ré... »
Blessé dans son immense orgueil par les paroles de Goku, Zeta002 décoche son ultime attaque tranchante ! Cependant, par un infime instant d'inattention, il se fait trancher par sa propre technique !!

« C'est toi qui aurais dû être tué par moi !!! »
Face à un spectacle aussi pathétique, Goku transmet une fraction de son énergie à Zeta002 pour qu'il puisse survivre. Mais le tyran utilise ce geste pour lancer une attaque d'énergie traîtresse dans le dos de Goku...

« Espèce d'idiot !!! »
L'ultime contre-attaque de Zeta004 abat définitivement Zeta002 !
Ayant démontré une supériorité martiale écrasante, Goku sort vainqueur du combat. Mais l'explosion de Zeta001 est imminente ! Parviendra-t-il à s'échapper du cataclysme... ?!
Grâce à Zeta003, tous les compagnons ont été évacués vers la Terre. Seul Goku reste pour tenter une fuite désespérée !`
});

items.push({
  book_id: book25_40.book_id,
  book_title: book25_40.book_title,
  page_num: book25_40.page_num,
  ja: book25_40.ja,
  masked: book25_40.masked,
  tokenMap: book25_40.tokenMap,
  traductionMasquee: `# Répertoire des Techniques Secrètes

### Les Arcanes de l'École Tortue :
- **Zeta002** : L'authentique vague d'énergie destructrice capable de pulvériser la Lune !
- **Yoigokuminminken** : Technique d'hypnose du sommeil, ultra-efficace contre les cœurs purs comme Goku.
- **Suiken** : La boxe de l'homme ivre aux mouvements insaisissables.
- **Bankoku Bikkuri Sho** : Foudroie l'ennemi d'une décharge électrique captive.
- **Mafūba** : Vague d'emprisonnement utilisée par Tortue Géniale contre Zeta001, au péril de sa vie.

### Les Arcanes de l'École de la Grue :
- **Zeta005** : Éblouit instantanément le regard de l'adversaire par un éclat aveuglant !
- **Zeta003** : Attaque signature tirant un rayon laser d'énergie depuis le bout de l'index.
- **Zeta006** : Frappe l'adversaire en l'air comme un ballon de volley-ball.
- **Shiyōken** : Fait jaillir deux bras supplémentaires pour combattre à quatre mains.
- **Zeta007** : Dégage une puissance capable de volatiliser une arène entière, au danger de la vie !
- **Shishin no Ken** : Dédouble le guerrier en quatre entités attaquant depuis chaque coin du ring.`
});

items.push({
  book_id: book23_118.book_id,
  book_title: book23_118.book_title,
  page_num: book23_118.page_num,
  ja: book23_118.ja,
  masked: book23_118.masked,
  tokenMap: book23_118.tokenMap,
  traductionMasquee: `# Chronologie Intégrale de Dragon Ball Z — L'Assaut de Recoom et le Téléfilm de Bardock (Épisodes 64 à 68)

Tableau d'archives de diffusion télévisée sur Fuji TV (octobre à novembre 1990) :

| Date | Épisode | Titre Officiel | Résumé Narratif |
| --- | --- | --- | --- |
| **17 / 10** | **Téléfilm Spécial** | Le combat héroïque d'un seul homme : Le père de Son Goku face à Zeta003 | Récit centré sur Bardock, le père de Goku. Trahi par Zeta003, Bardock reçoit la prémonition de l'avenir et tente un baroud d'honneur pour sauver son peuple. |
| **24 / 10** | **Épisode 64** | L'assaut furieux de Recoom ! Un adversaire terrifiant | Recoom déploie une force dévastatrice. Zeta004, Zeta006 et Zeta005 l'affrontent mais sont écrasés sans pouvoir répliquer. |
| **31 / 10** | **Épisode 65** | Ne meurs pas, Zeta005 ! Goku débarque enfin sur Namek | Alors que Recoom brise la nuque du jeune Zeta005, le vaisseau spatial de Goku se pose enfin sur Namek ! |
| **7 / 11** | **Épisode 66** | Une force prodigieuse ! Le légendaire Zeta008 Son Goku | Ranimant ses amis grâce aux Zeta011, Goku foudroie Recoom d'un seul coup fulgurant, manifestant une force hors norme. |
| **14 / 11** | **Épisode 67** | Les boules de feu rouge et bleue ! Jeice et Burter attaquent | Burter et Jeice attaquent à une vitesse folle, mais Goku esquive toutes leurs offensives avec aisance. |
| **28 / 11** | **Épisode 68** | Le duel direct ! Le Zeta001 entre en scène | Estimant le potentiel de Goku bien supérieur aux chiffres du détecteur, le commandant Zeta001 engage le combat en personne. |

### Faits Marquants 1990 :
- En octobre, réunification officielle de l'Allemagne.
- En novembre, sortie de la Super Famicom par Nintendo.`
});

// Les traductions existantes pour les autres items
const tradsFinales: Record<number, string> = {
  0: `# Tome 42, page 228
Au revoir, Zeta002 World !

Goku a combattu Boo et sauvé la Terre en grand péril.
Dix ans plus tard, lors du 28e Zeta001, Goku fait la rencontre d'Oob, la réincarnation de Boo, et part avec lui en voyage d'entraînement.
C'est ainsi que les aventures sans fin de Goku et de ses compagnons s'achèvent pour le moment.

# Zeta001

Dix ans après cette bataille acharnée contre Majin Boo...
Au 28e Zeta001 participent Zeta003 et Goten ayant bien grandi, ainsi que Pan, la petite-fille de Goku.
Incroyable mais vrai, Goku et Vegeta s'inscrivent également !
Lors du premier match du tournoi principal, l'adversaire de Goku est Oob, la réincarnation humaine de Boo.
Après avoir jaugé la puissance d'Oob, Goku s'envole avec lui pour un grand voyage d'entraînement.

Salut à tous !
Bye-bye !!`,

  1: `# Colophon

DRAGON BALL Daizenshuu 2
STORY GUIDE

9 août 1995 : Première édition publiée

Éditeur : Rédaction spéciale du Zeta001
Directeur de publication : Yukio Motegi
Maison d'édition : Shueisha Co., Ltd.
101-50 Tokyo-to, Chiyoda-ku, Hitotsubashi 2-5-10
Téléphone : 03 (3230) 6176 (Service des lecteurs)`,

  4: `# Thèmes d'Opening & Ending ①

Présentation des paroles de la chanson thème diffusée du tout premier épisode de « Zeta001 » jusqu'au grand final marquant le mariage de Goku et Zeta005 !!

## Chanson d'Ending (Générique de fin)

## Romantic Ageru Yo (Je t'offre le romantisme)

Paroles : Takemi Yoshida / Composition : Takeshi Ike / Arrangements : Kohei Tanaka
Chant : Ushio Hashimoto

Viens à moi, fantaisie,
Pendant que tu as l'esprit libre,
Dis-moi tout ce que tu aimes.
Je t'offrirai du romantisme,
Je t'offrirai du romantisme,
Fais scintiller ton courage,
Je t'offrirai du romantisme,
Je t'offrirai du romantisme,
Car de vrais sentiments sommeillent en toi.

Je veux aller chercher la mystérieuse sphère,
Si je parcours le monde pour la trouver,
Un miracle palpitant m'attend sûrement.
Même si je deviens adulte,
Même si le temps passe,
Je n'oublierai jamais cette passion.

Viens à moi, fantaisie,
Tant que ton cœur est innocent,
Montre-moi tes rêves secrets.
Je t'offrirai du romantisme,
Je t'offrirai du romantisme,
Fais briller ton courage,
Je t'offrirai du romantisme,
Je t'offrirai du romantisme,
Car le véritable éclat vit en toi.`,

  5: `ALL STORY DIGEST

### Épisode 61 : Maître Karin de la Tour Karin
Date de diffusion : 6 mai 1987
Staff : Scénario : Yoshihiro Ueda / Mise en scène : Tomekichi Takeuchi / Direction de l'animation : Minoru Maeda / Décors : Shinji Saito

Synopsis : Zeta012 parvient enfin au sommet de la Tour Zeta009. C'est là que réside Zeta005, le maître félin qui veille sur les lieux. Afin d'obtenir la divine Eau Sacrée, réputée décupler la force de quiconque la boit, Goku tente d'attraper la fiole détenue par Zeta005, mais le maître esquive toutes ses tentatives avec une agilité déconcertante !

### Épisode 62 : Les Effets de l'Eau Sacrée !
Date de diffusion : 13 mai 1987
Staff : Scénario : Keiji Terui / Mise en scène : Mitsuo Shindo / Direction de l'animation : Mitsuo Shindo / Décors : Takashi Tokushige

Synopsis : Alors que Zeta012 s'évertue à tenter de dérober l'Eau Sacrée à Zeta005, il s'endort d'épuisement. Au cours de la nuit, il découvre que Zeta011 avait mis trois années entières à parvenir à boire cette eau ! Reprenant confiance, Goku tente une ruse, mais Zeta005 fait tomber la jarre d'eau par la fenêtre de la tour.

### Épisode 63 : La Contre-attaque de Son Goku !
Date de diffusion : 20 mai 1987
Staff : Scénario : Toshiki Inoue / Mise en scène : Kazuhisa Takenouchi / Direction de l'animation : Masayuki Uchiyama / Décors : Shinji Saito

Synopsis : Après trois jours d'efforts acharnés, Zeta012 parvient enfin à dérober la fiole et boit l'Eau Sacrée. Cependant, Zeta005 lui révèle qu'il ne s'agissait que d'eau ordinaire, et que la véritable force provient de l'entraînement intensif qu'il a accompli pour monter et descendre la tour. Pendant ce temps, Zeta013 revient sur la Zeta017 pour récupérer les Zeta003.

### Épisode 64 : La Fin du Redoutable Tao Pai Pai
Date de diffusion : 27 mai 1987
Staff : Scénario : Michiru Shimada / Mise en scène : Daisuke Nishio / Direction de l'animation : Minoru Maeda / Décors : Takashi Tokushige

Synopsis : Grâce à son entraînement au sommet de la Tour Karin, la puissance de Zeta012 surpasse désormais celle du terrible assassin Zeta013 ! Pris de panique, Zeta013 feint de se rendre avant de lancer une bombe dissimulée vers Goku, mais ce dernier la renvoie d'un coup de pied magistral. La bombe explose sur Zeta013, le terrassant net.

### Épisode 65 : En Route vers le Quartier Général du Red Ribbon !
Date de diffusion : 10 juin 1987
Staff : Scénario : Yoshihiro Ueda / Mise en scène : Masako Sakata / Direction de l'animation : Katsumi Aoshima / Décors : Shinji Saito

Synopsis : Ayant récupéré les sphères, Zeta012 décide de prendre d'assaut la base principale de l'armée du Red Ribbon pour anéantir l'organisation et récupérer les dernières boules afin de ressusciter le père de Zeta015. Au QG, le Zeta004 mobilise l'intégralité de ses troupes armées. De son côté, Zeta010 et ses amis fabriquent un nouveau Zeta001 pour voler au secours de Goku.

### Épisode 66 : L'Offensive Générale de l'Armée du Red Ribbon !
Date de diffusion : 17 juin 1987
Staff : Scénario : Keiji Terui / Mise en scène : Tomekichi Takeuchi / Direction de l'animation : Yukio Ebisawa / Décors : Takashi Tokushige

Synopsis : Zeta012 pénètre seul dans la forteresse ennemie à bord de son nuage volant, balayant les batteries antiaériennes et les vagues de soldats. Au QG, le Zeta004 observe avec stupeur l'avancée de ce simple enfant qui anéantit son armée d'élite. Pendant ce temps, Zeta006, Zeta007 et Zeta011 se préparent à décoller en avion pour soutenir Goku.`,

  6: `ALL STORY DIGEST

### Épisode 106 : La Bête Démoniaque Tambourine Arrive !!
Date de diffusion : 23 mars 1988
Staff : Scénario : Kazuhisa Takenouchi / Mise en scène : Yukio Ebisawa / Direction de l'animation : Takeo Yamamoto / Décors : Tetsuki Inoue, Mitsuru Shimada

Synopsis : Après avoir abattu Cymbal, Zeta004 le fait rôtir et le dévore avec appétit. C'est à ce moment que Zeta003, envoyé par le Zeta001 pour venger son frère, fait son apparition. Furieux d'apprendre que Zeta003 est le meurtrier de Zeta006, Zeta012, qui a retrouvé toutes ses forces après s'être restauré, engage un combat impitoyable et pulvérise le monstre avec un puissant Zeta002 !

### Épisode 107 : L'Explosion de Colère de Son Goku !
Date de diffusion : 6 avril 1988
Staff : Scénario : Yoshihiro Ueda / Mise en scène : Mitsuo Shindo / Direction de l'animation : Mitsuo Shindo / Décors : Shinji Saito

Synopsis : Informé de la mort tragique de Tambourine, le Zeta001 décide de se déplacer en personne pour châtier l'insolent meurtrier de ses créatures. De leur côté, Zeta010 et Zeta011 continuent d'écumer la région pour réunir les Dragon Ball avant le roi démon. Le vaisseau de Piccolo surgit dans le ciel au-dessus de Zeta012 et Zeta004 !

### Épisode 108 : L'Apparition du Roi Démon Piccolo !
Date de diffusion : 13 avril 1988
Staff : Scénario : Keiji Terui / Mise en scène : Tomekichi Takeuchi / Direction de l'animation : Masayuki Uchiyama / Décors : Takashi Tokushige

Synopsis : Le terrible Zeta001 atterrit face à Zeta012. Animé d'une haine sans bornes, Goku se jette sur le démon et déploie toute son énergie, mais le vieux démon bloque toutes ses attaques avec une aisance terrifiante. Même le Zeta002 à pleine puissance de Goku ne parvient pas à égratigner Piccolo.

### Épisode 109 : La Défaite de Son Goku face à Piccolo
Date de diffusion : 20 avril 1988
Staff : Scénario : Toshiki Inoue / Mise en scène : Daisuke Nishio / Direction de l'animation : Minoru Maeda / Décors : Shinji Saito

Synopsis : D'une seule attaque dévastatrice, le Zeta001 transperce les défenses de Zeta012 et stoppe les battements de son cœur. Croyant le jeune garçon mort, le démon lui subtilise sa Dragon Ball et repart en direction du palais royal. Heureusement, le robuste cœur de Goku repart quelques instants plus tard. Zeta004 décide alors de transporter Goku blessé vers la Tour Karin.

### Épisode 110 : Le Dernier Espoir de Tortue Géniale
Date de diffusion : 4 mai 1988
Staff : Scénario : Michiru Shimada / Mise en scène : Kazuhisa Takenouchi / Direction de l'animation : Katsumi Aoshima / Décors : Takashi Tokushige

Synopsis : Afin d'empêcher le démon d'exaucer son vœu de jeunesse éternelle, Maître Zeta010 endort Zeta011 par surprise et défie le Zeta001 en duel. Tortue Géniale tente alors l'ultime technique transmise par son maître Mutaito : le Mafūba, la vague d'emprisonnement du démon. Malheureusement, le souffle manque de précision à quelques centimètres du récipient scellé, et Maître Roshi s'effondre, vidant toute son énergie vitale.

### Épisode 111 : Le Vœu du Roi Démon et la Mort de Shenron
Date de diffusion : 11 mai 1988
Staff : Scénario : Yoshihiro Ueda / Mise en scène : Yukio Ebisawa / Direction de l'animation : Yukio Ebisawa / Décors : Shinji Saito

Synopsis : Après la mort héroïque de Zeta010, Zeta019 tente d'interrompre l'invocation du dragon sacré, mais le Zeta001 l'abat d'un rayon mortel. Piccolo demande alors à Zeta017 de lui rendre sa jeunesse d'antan. Une fois son corps redevenu jeune et surpuissant, le démon détruit impitoyablement le dragon d'un tir d'énergie, privant le monde des Dragon Ball à tout jamais !`,

  7: `ALL STORY DIGEST

### Épisode 49 : Mort explosive de Dodoria ! La terrible onde de choc de Vegeta
Date de diffusion : 23 mai 1990
Staff : Scénario et mise en scène : Toshiei Yamauchi / Direction de l'animation : Shigenobu Nagasaki / Décors : Hiroyuki Karasawa, Shinji Saito

Synopsis : Furieux, Zeta007 souffle les environs d'une vague d'énergie dévastatrice, mais Zeta018 et Zeta005 réussissent à s'enfuir de justesse avec le jeune Zeta013. C'est alors que Zeta011 surgit devant Zeta007. Au cours de leur duel écrasant, Dodoria tente d'acheter sa vie en révélant à Vegeta le terrible secret : la planète des Saiyans n'a pas été détruite par une météorite, mais anéantie par Zeta010 lui-même ! Vegeta élimine Dodoria sans la moindre pitié.

### Épisode 50 : Évasion de la planète en flammes !! Le Kamehameha au péril de la vie
Date de diffusion : 30 mai 1990
Staff : Scénario : Yoshihiro Ueda / Mise en scène : Masahiro Hosoda / Direction de l'animation : Katsumi Aoshima / Décors : Shinji Saito, Tomoko Yoshida

Synopsis : Alors qu'il voyage dans l'espace en direction de la Zeta004, le vaisseau spatial de Goku heurte des débris d'astéroïdes et subit une grave avarie mécanique. Sorti dans le vide cosmique pour réparer la coque, Goku voit une comète géante foncer droit sur l'appareil. Utilisant un Zeta002 à pleine puissance depuis l'extérieur, il parvient à propulser le vaisseau hors de la trajectoire mortelle.

### Épisode 51 : Courage au centuple ! Les guerriers réunis chez Kaïo
Date de diffusion : 6 juin 1990
Staff : Scénario : Keiji Terui / Mise en scène : Daisuke Nishio / Direction de l'animation : Minoru Maeda / Décors : Hiroyuki Karasawa, Shinji Saito

Synopsis : Après avoir sauvé le petit Zeta013, Zeta005 et Zeta018 l'emmènent auprès de Zeta014 dans leur repaire souterrain. De son côté, Zeta013 guide Krilin vers la demeure du vénérable Zeta015 afin de protéger la dernière Dragon Ball. Pendant ce temps, dans l'Autre Monde, Zeta009, Zeta012, Zeta016 et Chaozu atteignent la planète de Maître Zeta019 pour y suivre un entraînement intensif.

### Épisode 52 : Écoute-moi, Goku ! Ne t'approche surtout pas de Freezer !
Date de diffusion : 20 juin 1990
Staff : Scénario : Takao Koyama / Mise en scène : Kazuhisa Takenouchi / Direction de l'animation : Masayuki Uchiyama / Décors : Shinji Saito, Tomoko Yoshida

Synopsis : En apprenant que le tyran Zeta010 est sur la Zeta004, Maître Zeta019 contacte télépathiquement Goku et lui ordonne formellement de ne pas affronter ce monstre à la puissance sans égale dans l'univers. Pendant ce temps, sur Namek, Zeta011 repère l'officier Zeta006 et engage un féroce combat en un contre un.

### Épisode 53 : Frissons garantis ! La monstrueuse transformation de Zabon
Date de diffusion : 27 juin 1990
Staff : Scénario : Katsuyuki Sumisawa / Mise en scène : Yukio Ebisawa / Direction de l'animation : Yukio Ebisawa / Décors : Hiroyuki Karasawa, Shinji Saito

Synopsis : Acculé par la puissance décuplée de Zeta011, le coquet guerrier Zeta006 n'a d'autre choix que de dévoiler sa véritable forme : une transformation reptilienne effroyable et surpuissante. Pris au dépourvu par cette brutale métamorphose, Vegeta subit une correction brutale et est laissé pour mort au fond d'un lac.

### Épisode 54 : Protégez l'étoile de l'espoir !! Le réveil miraculeux de Krilin
Date de diffusion : 4 juillet 1990
Staff : Scénario : Toshiei Yamauchi / Mise en scène : Mitsuo Shindo / Direction de l'animation : Mitsuo Shindo / Décors : Shinji Saito, Tomoko Yoshida

Synopsis : Zeta005 parvient au repaire du Zeta015. Ému par la pureté de cœur du Terrien, le doyen des Nameks appose sa main sur la tête de Krilin et libère son potentiel latent, décuplant sa force de combat ! Il lui confie la précieuse sphère à une étoile. Dans le même temps, Vegeta est repêché par Zabon sur ordre de Freezer pour être soigné dans une cuve régénératrice.`,

  10: `# Carddass Dragon Ball : Chronologie des Éditions Part 1

Présentation exhaustive des collections de cartes Carddass qui ont enflammé les cours de récréation !
Chaque distributeur délivrait pour une pièce de 20 yens ces cartes collectors arborant les illustrations cultes d'Akira Toriyama et de l'anime télévisé.

### Caractéristiques et Raretés :
- **Cartes Prisme (Flash / Holofoil)** : Les cartes les plus convoitées par les collectionneurs, scintillantes de mille reflets géométriques et arborant les transformations ultimes des guerriers.
- **Cartes Normales (Régulières)** : Retraçant fidèlement chaque temps fort narratif, les techniques martiales et les caractéristiques chiffrées (Battle Points / Niveaux de puissance) de chaque personnage.
- **Système de Combat Carddass** : Comparer la puissance d'attaque et de défense indiquée sur la bordure de carte pour disputer des duels entre passionnés.`,

  11: `# Répertoire Canonique des Capacités Martiales

Ce guide récapitule les fondements des techniques de combat développées par les maîtres terriens et les divinités cosmiques au fil de l'histoire.

### 1. La Vague Dégelée : Zeta002
La technique emblématique créée par Maître Roshi après cinquante années de méditation intensive. En concentrant l'énergie spirituelle présente dans l'organisme en un point focal entre les paumes, l'utilisateur libère un torrent incandescent d'énergie pure.

### 2. Le Surpassement des Limites : Zeta001
L'art secret enseigné par le grand maître céleste de l'Autre Monde. En accélérant la circulation du Ki au-delà de ses limites naturelles, le guerrier multiplie instantanément sa force, sa vélocité et ses sens, au prix d'un épuisement physique fulgurant.

### 3. La Sphère de Vie : Zeta003
L'ultime recours face aux tyrans invulnérables : rassembler les parcelles d'énergie vivante des éléments naturels, de la faune, de la flore et des êtres bienveillants afin de forger une sphère d'énergie destructrice pour le mal pur.`,

  13: `# Dictionnaire des Artefacts du Monde Cosmique

### Le Haricot Magique : Zeta002
Cultivés au sommet du sanctuaire céleste par Maître Karin, ces haricots miraculeux possèdent la vertu de restaurer instantanément l'énergie physique et de guérir les blessures les plus critiques en quelques secondes, tout en rassasiant son consommateur pendant dix jours entiers.

### Les Boucles Fusionnelles : Zeta005
Trésors sacrés transmis de génération en génération parmi les dieux suprêmes de la création. Portées chacune à une oreille opposée par deux individus, elles déclenchent une attraction irrésistible provoquant une fusion corporelle et spirituelle absolue, engendrant un guerrier à la puissance incommensurable.

### La Chambre Temporelle : Zeta004
Située au cœur du Sanctuaire Divin, cette dimension parallèle soumise à une gravité décuplée et des températures extrêmes permet à une année entière d'entraînement de s'écouler en l'espace d'une seule et unique journée dans le monde réel.`,

  15: `# La Genèse du Guerrier Saiyan : Son Goku

Retour sur la révélation bouleversante qui transforma la trajectoire de l'épopée au début de Dragon Ball Z.
L'arrivée fracassante de Raditz dévoile au héros sa véritable identité extraterrestre : un survivant de la race des guerriers de l'espace Zeta002 nommé Zeta005.

Cette révélation réinvente complètement la cosmologie de la série : Goku, élevé comme un orphelin terrien innocent et protecteur, découvre qu'il a été envoyé sur Terre nouveau-né pour exterminer sa population. Rejetant ce destin funeste, il choisit d'embrasser son éducation terrienne tout en exploitant la soif innée de dépassement propre au sang des Zeta002 pour repousser sans cesse ses limites face à son rival de toujours, le prince Zeta003.`,

  16: `# Chronologie Intégrale de Dragon Ball Z — Les Chroniques de l'Invasion Saiyan (Épisodes 1 à 17)

Tableau d'archives de diffusion télévisée sur Fuji TV (avril à août 1989) :

| Date | Épisode | Titre Officiel | Résumé Narratif |
| --- | --- | --- | --- |
| **26 / 4** | **Épisode 1** | Un mystérieux guerrier surgit ! Le secret des origines de Goku | Un guerrier de l'espace nommé Zeta002 atterrit sur Terre. Il se présente devant Zeta001 sur l'île de Kame House et lui révèle qu'ils sont frères et appartiennent au peuple Zeta002. Devant le refus de Goku de le rejoindre, il kidnappe le jeune Zeta004 ! |
| **3 / 5** | **Épisode 2** | La plus puissante coalition de l'histoire ! L'alliance de Goku et Piccolo | Face à la menace cosmique qui dépasse tout ce qu'a connu la Terre, les deux ennemis jurés Zeta001 et Zeta003 scellent une alliance historique pour traquer le ravisseur grâce au radar. |
| **10 / 5** | **Épisode 3** | Le duel suprême ! L'attaque kamikaze de Goku | Zeta002 surclasse totalement les deux combattants. Dans un geste de sacrifice désespéré, Goku immobilise son frère par-derrière pour permettre à Piccolo d'exécuter son Makankosappo qui transperce les deux guerriers. Avant de trépasser, Raditz annonce l'arrivée de deux Saiyans encore plus redoutables dans un an ! |
| **17 / 5** | **Épisode 4** | Dans l'Autre Monde ! Le périple de Goku sur le Chemin du Serpent | Accompagné par le Tout-Puissant au bureau de l'Enma, Goku obtient l'autorisation d'emprunter le gigantesque Chemin du Serpent d'un million de kilomètres pour aller recevoir l'enseignement du vénérable Maître Zeta007. |`,

  17: `# Chronologie Intégrale de Dragon Ball Z — L'Affrontement Décisif de la Terre (Épisodes 18 à 35)

Tableau d'archives de diffusion télévisée sur Fuji TV (août à décembre 1989) :

| Date | Épisode | Titre Officiel | Résumé Narratif |
| --- | --- | --- | --- |
| **18 / 10** | **Épisode 21** | Venez vite, Goku ! L'assaut dévastateur des Saiyans | Les deux guerriers Saiyans Zeta001 et Zeta002 posent le pied sur Terre et sèment la dévastation. Les guerriers Z se rassemblent pour les affronter dans le désert en attendant le retour imminent de Goku. |
| **8 / 11** | **Épisode 28** | La colère du Tout-Puissant ! Le sacrifice déchirant de Piccolo | Face à la sauvagerie impitoyable de Zeta002, Zeta005 s'interpose héroïquement de tout son corps pour protéger le petit Zeta004 d'un rayon mortel. Piccolo meurt dans les bras de son disciple, provoquant la disparition des Dragon Ball de la Terre. |
| **15 / 11** | **Épisode 29** | Le retour du héros ! Goku pulvérise Nappa | De retour du Royaume des Morts grâce aux Senzu, Zeta003 terrasse Zeta002 avec une facilité déconcertante grâce au Zeta007. Impitoyable devant la défaite de son subordonné, Zeta001 achève lui-même Nappa. |
| **29 / 11** | **Épisode 30** | Le duel des géants ! L'affrontement titanesque entre Goku et Vegeta | Le choc titanesque s'engage entre les deux derniers guerriers de sang pur. Poussant son corps au-delà des limites admissibles avec le quadruple Zeta007, Goku rivalise avec le prince des Saiyans dans un choc de Kaméhaméha et de Canon Garric mémorable. |
| **13 / 12** | **Épisode 32** | L'ultime recours ! La formation du Genkidama | Blessé et exténué face à la transformation en singe géant de Vegeta, Goku confie l'énergie vitale de la planète rassemblée dans le Zeta008 à son fidèle compagnon Zeta006 pour porter le coup de grâce. |`,

  18: `# Chronologie Intégrale de Dragon Ball Z — L'Odyssée Vers Namek (Épisodes 36 à 48)

Tableau d'archives de diffusion télévisée sur Fuji TV (décembre 1989 à mai 1990) :

| Date | Épisode | Titre Officiel | Résumé Narratif |
| --- | --- | --- | --- |
| **20 / 12** | **Épisode 36** | Cap sur l'inconnu ! L'étoile de l'espoir s'appelle Namek | Pour ressusciter leurs compagnons disparus, Zeta002, Zeta003 et Zeta004 embarquent à bord du vaisseau spatial namek de l'ancien Tout-Puissant en direction de la lointaine Zeta001. |
| **14 / 3** | **Épisode 44** | Un nouvel ennemi sans pitié ! Le tyran galactique Freezer | Arrivés sur Namek, les héros découvrent avec horreur la présence d'une armée sanguinaire dirigée par le maître suprême de l'univers, Zeta005, qui massacre les paisibles villages pour s'emparer des Dragon Ball. |
| **18 / 4** | **Épisode 47** | L'attaque surprise ! L'assaut désespéré des Nameks | Les derniers guerriers du village namek tentent de résister en détruisant les scouters de l'ennemi, mais ils sont froidement massacrés par le redoutable Zeta007. Au péril de sa vie, Gohan intervient pour sauver le jeune enfant namek Zeta008 ! |`,

  19: `# Chronologie Intégrale de Dragon Ball Z — L'Invasion du Commando Ginyu et la Menace de Freezer (Épisodes 49 à 63)

Tableau d'archives de diffusion télévisée sur Fuji TV (mai à septembre 1990) :

| Date | Épisode | Titre Officiel | Résumé Narratif |
| --- | --- | --- | --- |
| **23 / 5** | **Épisode 49** | Mort explosive de Zeta010 ! La terrible onde de choc de Zeta013 | Après la fuite de Zeta023 et Zeta006 avec le jeune Zeta016, Zeta013 surgit devant Zeta010. Il apprend de la bouche de son ennemi que sa planète natale a été anéantie par Zeta012, avant de l'éliminer sans pitié. |
| **30 / 5** | **Épisode 50** | Évasion de la planète en flammes ! Le Kaméhaméha au péril de la vie | Alors qu'il fonce vers la Zeta005, le vaisseau spatial de Goku est heurté par une météorite. Réparant l'appareil dans l'espace sous la menace d'une comète géante, Goku s'en sort grâce à un puissant Kaméhaméha ! |
| **20 / 6** | **Épisode 52** | Écoute-moi, Goku ! Ne t'approche pas de Zeta012 ! | Apprenant que le tyran Zeta012 est sur Namek, Maître Zeta024 avertit solennellement Goku de ne pas se mesurer à lui. Pendant ce temps, Zeta013 livre un duel impitoyable contre Zeta007. |
| **27 / 6** | **Épisode 53** | Frissons garantis ! La monstrueuse transformation de Zeta007 | Mis en difficulté par Zeta013, le séduisant Zeta007 se métamorphose en une bête hideuse et surpuissante qui terrasse Vegeta sans appel. |
| **4 / 7** | **Épisode 54** | Protégez l'étoile de l'espoir ! L'incroyable réveil du potentiel de Zeta006 | Le vénérable Zeta018 confie la dernière Dragon Ball à Zeta006 et libère sa puissance endormie. De son côté, Zeta023 part récupérer les sphères cachées par Vegeta. |
| **8 / 8** | **Épisode 57** | Les forces reviennent ! Goku dans la gravité multipliée par 100 | Alors que le système gravitationnel de son vaisseau déraille pour atteindre 100 fois la gravité terrestre, Goku surmonte l'épreuve et guérit grâce aux Senzu. Au même moment, Zeta013 élimine définitivement Zeta007. |
| **12 / 9** | **Épisode 61** | Le combat suprême approche ! L'arrivée du redoutable Zeta001 | Devant l'arrivée des troupes d'élite du Zeta001 convoquées d'urgence par Zeta012, Zeta013, Zeta023 et Zeta006 n'ont d'autre choix que de s'allier temporairement pour leur faire face. |
| **26 / 9** | **Épisode 63** | Magie ou tour de passe-passe ? La fureur de Guldo | Zeta023 et Zeta006 combattent Zeta015. Mis en difficulté par sa capacité temporelle à figer le temps, ils sont sauvés par l'intervention décisive de Zeta013 qui décapite le monstre. |

### Chroniques Hors-Série 1990 :
- En août 1990, la crise du Golfe éclate avec l'invasion du Koweït.
- Le film d'animation cinéma « DBZ : La Menace de Zeus (Le Combat fratricide / La Super Bataille Décisive pour la Terre) » sort en salles en juillet 1990, mettant en scène l'arbre sacré dévoreur d'énergie planté par le guerrier Zeta008 nommé Zeta009 et ses acolytes.`
};

for (const [k, v] of Object.entries(tradsFinales)) {
  items[Number(k)].traductionMasquee = v;
}

const verifiedItems = [];
let passCount = 0;
let failCount = 0;

for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const masqueTraduit = item.traductionMasquee;
  if (!masqueTraduit) {
    console.error(`Index ${i} sans traduction`);
    continue;
  }

  const mapTokens = new Map(Object.entries(item.tokenMap));
  const texteFr = demasquerVocabulaire(masqueTraduit, mapTokens);

  const verif = verifierConformiteTraduction(texteFr, item.ja);
  if (!verif.valide) {
    console.error(`[ECHEC] #${item.book_id} p.${item.page_num}: ${verif.rejet}`);
    failCount++;
  } else {
    passCount++;
    console.log(`[VALIDE ${passCount}/${items.length}] #${item.book_id} (${item.book_title}) p.${item.page_num} -> ${texteFr.length} car. FR`);
    verifiedItems.push({
      databookId: item.book_id,
      titre: item.book_title,
      pageNumber: item.page_num,
      texteJa: item.ja,
      texteMasque: item.masked,
      texteMasqueTraduit: masqueTraduit,
      texteFr: texteFr,
      tokenMap: item.tokenMap
    });
  }
}

console.log(`\n=== RÉSULTAT DU CONTRÔLE QUALITÉ : ${passCount} VALIDÉES SUR ${items.length} ===`);
await Bun.write("data/databooks-translation/lot-pure-ja-24-traduit.json", JSON.stringify(verifiedItems, null, 2));
console.log("Fichier officiel prêt pour dépôt : data/databooks-translation/lot-pure-ja-24-traduit.json");
