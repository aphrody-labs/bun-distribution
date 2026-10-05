/**
 * Transcriptions de databooks — noms propres Dragon Ball mal lus.
 *
 * Module autonome, volontairement séparé de `databooks-ocr-corrections.ts` :
 * il ne traite qu'UNE classe de défaut, la confusion entre une consonne
 * sourde et sa sonore (ou sa semi-sonore) sur un **nom propre**. Le dakuten
 * est deux petits traits en haut à droite d'un kana ; sur du texte imprimé
 * petit, c'est ce que le modèle de vision rate le plus. Sur un mot courant le
 * dictionnaire tranche ; sur `ブロリー` il n'a rien à dire, et la faute passe.
 *
 * # D'où vient cette table
 *
 * Elle n'a pas été écrite de mémoire — la mémoire est exactement ce qui
 * fabrique des noms plausibles et faux. Elle a été **dérivée** :
 *
 *   1. lecture des graphies japonaises officielles du wiki (`name_ja` des
 *      tables `bot.db_characters`, `db_planets`, `db_races`, `db_sagas`,
 *      `db_techniques`) — 779 graphies, dont 286 en katakana pur d'au moins
 *      quatre kana ;
 *   2. génération de toute variante obtenue en basculant **un seul** kana
 *      dans son groupe sourde/sonore/semi-sonore (ハ/バ/パ, ヒ/ビ/ピ, カ/ガ,
 *      サ/ザ, タ/ダ, ウ/ヴ…) — 788 variantes ;
 *   3. rejet automatique de toute variante qui est elle-même un mot de JMdict
 *      (464 819 graphies) ou une graphie officielle du wiki ;
 *   4. comptage de ce qui reste sur les 11 255 planches transcrites ;
 *   5. **lecture des occurrences réelles**, une par une pour les paires rares,
 *      exhaustivement pour celles qui touchent plus de trois planches.
 *
 * L'étape 3 n'est pas décorative : elle a écarté `ジャンパ` (le blouson) qui
 * visait `シャンパ` (Champa), `スラック` qui visait `スラッグ` (Slug),
 * `ドルビー` (Dolby) qui visait `トルビー`, `マルガリータ` (le cocktail),
 * `ニューズ`, `バスター`, `サーロイン`, `ブラバン`, `ブレーク`, `ターフル`,
 * `シブレット`, `プローズ`. Douze pièges, tous des mots japonais réels qu'une
 * règle par distance aurait réécrits en noms de personnages.
 *
 * L'étape 5 en a écarté huit de plus, que ni le dictionnaire ni la fréquence
 * ne pouvaient attraper — cf. REFUSÉES plus bas.
 *
 * # La garde qui décide de tout
 *
 * Une substitution n'a lieu que si la forme fautive est **un mot entier** :
 * ni le caractère qui précède ni celui qui suit ne peut être un katakana. Le
 * japonais ne sépare pas ses mots par des espaces, il les délimite par le
 * changement d'écriture ; sans cette borne, corriger reviendrait à parier sur
 * l'endroit où le mot commence.
 *
 * C'est cette borne qui protège `ベジタブル` — le passage où les databooks
 * expliquent que Végéta vient de « vegetable ». Une règle `ベジタ → ベジータ`
 * ancrée sur une sous-chaîne détruirait précisément l'explication qui la
 * justifie. Le cas est figé par un test de non-régression, avec les deux
 * textes réels du corpus (#24 p.47 et #6 p.48).
 *
 * Le point médian `・`, lui, compte comme une frontière et non comme un
 * katakana : c'est un séparateur de mots, et le refuser ferait manquer
 * `ミニ・シャネンバ` sans rien protéger.
 *
 * # REFUSÉES, et pourquoi
 *
 * Huit paires mesurées dans le corpus ne sont PAS dans la table. Chacune avait
 * une fréquence exploitable ; aucune n'avait de preuve d'illégitimité :
 *
 *   - `ドキトキ` → `トキトキ` (3×) : contre-exemple #212 « ドキトキのお楽しみ抽選会 » : c'est ドキドキ, pas Tokitoki.
 *   - `トキドキ` → `トキトキ` (1×) : contre-exemple #304 (V Jump 1997) « トキドキするね » : ときどき/ドキドキ, et Tokitoki date de 2015.
 *   - `ドギドキ` → `ドギドギ` (1×) : à un kana de ドキドキ autant que de ドギドギ ; 1 occurrence ne lève pas l'ambiguïté.
 *   - `ガンバー` → `カンバー` (1×) : contre-exemple #19 p.265 : titre de jeu de 1992, treize ans avant Cumber.
 *   - `シャンティ` → `シャンディ` (6×) : シャンディ jamais attesté dans le corpus (0×) et unique contexte illisible.
 *   - `カステル` → `ガステル` (1×) : カステル est un nom étranger courant (Castel) ; contexte dégradé, 1 occurrence.
 *   - `ビックバンアタック` → `ビッグバンアタック` (1×) : ビック est une graphie japonaise attestée de « big » (ビックカメラ) : variante éditoriale plausible.
 *   - `ジャコ・ティリメンテンピポッシ` → `ジャコ・ティリメンテンピボッシ` (1×) : cible jamais attestée (0×) et graphie canonique du nom long incertaine.
 *
 * Le critère commun de ces refus : on ne peut pas montrer que la forme lue est
 * impossible. Une correction fausse sur un corpus public coûte plus cher que
 * les quinze occurrences qu'elle aurait rattrapées.
 *
 * # Ce que ce module ne fait pas
 *
 * Rien sur les confusions ソ/ン et シ/ツ (≈50 % de faux positifs mesurés :
 * `ヤシ`, `ミート`, `キラー` sont justes), rien sur `一`→`ー` (95 % de
 * légitime : `一味`, `一家`, `一同`), rien sur les furigana, les boucles du
 * modèle ni la mise en page — d'autres modules s'en chargent. Et aucune image
 * n'est relue : tout se décide sur le texte.
 */

/**
 * Forme du rapport de règle, identique à celle de
 * `databooks-ocr-corrections.ts` — dupliquée plutôt qu'importée pour que ce
 * module reste indépendant du pipeline principal, dont l'union de codes est
 * fermée et appartient à un autre périmètre.
 */
export interface RapportRegle {
	code: "noms-propres";
	corrections: number;
}

/** Une graphie mal lue et sa forme juste, avec ce qui la prouve. */
export interface FauteNomPropre {
	/** La graphie telle que le modèle l'a rendue. */
	lu: string;
	/** La graphie officielle, celle du wiki. */
	correct: string;
	/** Le libellé français officiel — sert à retrouver l'entité au relecteur. */
	fr: string;
	/** Le kana en cause, sous la forme « lu/correct ». */
	confusion: string;
	/** Occurrences de `lu` dans le corpus, mesurées le 2026-08-25. */
	occurrences: number;
	/** Planches distinctes portant `lu`. */
	planches: number;
	/**
	 * Occurrences de `correct` dans le MÊME corpus. C'est la colonne qui
	 * tranche : elle montre que le terme y vit réellement, donc que la forme
	 * lue en est une lecture et non un mot venu d'ailleurs. Une cible à zéro
	 * n'est retenue que si le contexte l'identifie sans équivoque — une liste
	 * nominative d'ouvrage, où les noms voisins sont tous justes.
	 */
	attesteJuste: number;
	/**
	 * Suffixes qui rendent la forme lue légitime, et interdisent alors la
	 * substitution.
	 *
	 * Sert au cas où une graphie fautive est AUSSI un emprunt réel employé
	 * ailleurs dans le corpus. Une seule entrée en a besoin, et chaque
	 * suffixe correspond à une occurrence relevée, pas à une précaution
	 * imaginée.
	 */
	interdits?: readonly string[];
}

/**
 * Les 183 paires retenues, triées par fréquence décroissante.
 *
 * Chaque commentaire porte le comptage réel : occurrences de la forme lue,
 * planches et ouvrages touchés, et attestation de la forme juste dans le même
 * corpus.
 *
 * # Pourquoi la première version en manquait la moitié
 *
 * La table a d'abord été bâtie avec 86 paires, et il y manquait `プロリー`,
 * `ビッコロ`, `フルマ`, `ドラゴンボール` — soit les noms les plus attestés du
 * corpus. Quatre causes distinctes, toutes mesurées avant d'être corrigées :
 *
 *   1. **La frontière du chercheur n'était pas celle du correcteur.** Le
 *      script de découverte comptait le point médian comme un katakana
 *      bloquant, alors que le module le tient pour une frontière. Toutes les
 *      occurrences propres de `プロリー` sont bordées d'un `・` : le comptage
 *      rendait **zéro**, et la paire était écartée en silence. C'est le seul
 *      vrai défaut des quatre, et le plus instructif — un filtre de découverte
 *      plus strict que la règle qu'il alimente ne se voit pas, il fait juste
 *      disparaître des résultats.
 *   2. **Le seuil de quatre kana.** `ブルマ` en compte trois : jamais candidate.
 *      Abaissé à trois, au prix d'une vigilance accrue (c'est lui qui a fait
 *      remonter `ゲール` et `シレン`, deux faux positifs, cf. plus bas).
 *   3. **Le périmètre du lexique.** `ドラゴンボール` n'est ni un personnage, ni
 *      une planète, ni une race, ni une saga, ni une technique : il n'a pas de
 *      `name_ja`. Les mots katakana des titres japonais (`title_ja` des
 *      databooks, films, jeux, tomes et épisodes) sont désormais une seconde
 *      source — 161 graphies de plus.
 *   4. **La substitution à longueur égale.** `ベジタ` et `ベジータ` n'ont pas la
 *      même longueur : c'est une voyelle longue omise, pas un dakuten. Hors de
 *      la classe traitée ici, et laissé tel quel.
 *
 * # Ce que le seuil abaissé a fait remonter, et qu'il a fallu refuser
 *
 * Trois kana suffisent à tomber sur un nom qui n'a rien à voir. Deux cas ont
 * été arrêtés par la lecture des contextes, et par elle seule :
 *
 *   - `ゲール` → `ケール` (6 occurrences) : c'est **Gale**, garde du corps dans
 *     « DBGT », pas Kale de « DBS ». La planche porte sa traduction française
 *     à côté, « Sheera & Gale ».
 *   - `シレン` → `ジレン` (8 occurrences) : c'est **風来のシレン**, le jeu de
 *     Chunsoft cité dans les V-Jump de 1996 à 2000 — vingt ans avant que Jiren
 *     n'existe.
 *
 * Ni JMdict ni la fréquence ne pouvaient les attraper : ce sont des noms
 * propres, et leur cible est solidement attestée par ailleurs.
 */
export const NOMS_PROPRES_MAL_LUS: FauteNomPropre[] = [
	// ---------------------------------------------------------------
	// Les quatre paires que le crible JMdict masquait.
	//
	// Le crible dictionnaire s'applique AVANT la lecture des contextes :
	// ce qu'il écarte ne se voit jamais. C'est le même défaut que le
	// comptage à zéro, à un autre étage — un filtre en amont qui supprime
	// des candidats sans laisser de trace.
	//
	// Reprise des 52 formes qu'il avait écartées : 35 sont attestées dans
	// le corpus, et 31 d'entre elles lui donnent raison — `パーツ` y est
	// toujours « pièces » (オーラのパーツ, 眼球パーツ, ネジなどのパーツ),
	// `ゼット` toujours le Z de la série, `リーグ` toujours une ligue,
	// `ピート` toujours le mécanicien de « Dub & Peter 1 ». Deux ont même
	// une preuve chronologique : `ジャンパ` est une fiche de technique du
	// Daizenshuu 7, paru en 1996, quand Champa date de 2015 ; `シータ` est
	// un `ベジータ` amputé, sous le titre latin « VEGETA ».
	//
	// Restent ces quatre-là, où le dictionnaire ne protégeait pas un mot
	// réel mais masquait un nom propre.
	// ---------------------------------------------------------------
	// Slug — ク/グ. 52 occurrences sur 19 planches, 12 ouvrages ; スラッグ attesté 123×.
	// Le seul cas où la forme lue est parfois légitime : le Dragon Ball
	// Fortune Book (#82 p.65) est un horoscope financier, et y parle de
	// « slack » — récession, 不況, 底値. Ses trois occurrences sont mises
	// hors d'atteinte par `interdits`. Les dix-neuf autres planches sont
	// toutes le super-Namek du film 4 : 超ナメック星人スラック, スラック味
	// (pour スラッグ一味), et la fiche 【スラック】 du Daizenshuu 7.
	{
		lu: "スラック",
		correct: "スラッグ",
		fr: "Slug",
		confusion: "ク/グ",
		occurrences: 52,
		planches: 19,
		attesteJuste: 123,
		interdits: ["を楽しく", "による"],
	},
	// Super Saiyan God — ト/ド. 16 occurrences sur 11 planches, 10 ouvrages ; ゴッド attesté 311×.
	// Toutes les occurrences sont 超サイヤ人ゴッド ou ゴッドかめはめ波 :
	// aucune exception trouvée.
	{
		lu: "ゴット",
		correct: "ゴッド",
		fr: "ゴッド",
		confusion: "ト/ド",
		occurrences: 16,
		planches: 11,
		attesteJuste: 311,
	},
	// Ossu — ズ/ス. 10 occurrences sur 7 planches, 7 ouvrages ; オッス attesté 46×.
	// Le salut de Goku, et le titre du TV special de 2008 : オッス！オラ悟空,
	// オッス！帰ってきた孫悟空と仲間たち. Jamais « odds » dans le corpus.
	{
		lu: "オッズ",
		correct: "オッス",
		fr: "オッス",
		confusion: "ズ/ス",
		occurrences: 10,
		planches: 7,
		attesteJuste: 46,
	},
	// Jeese — シ/ジ. 4 occurrences sur 4 planches, 4 ouvrages ; ジース attesté 47×.
	// Les quatre sont le membre du commando Ginyu, nommé à côté des siens :
	// シースとバータ, HG7-21 シース C HG7-22 バータ.
	{
		lu: "シース",
		correct: "ジース",
		fr: "Jeese",
		confusion: "シ/ジ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 47,
	},
	// Goku Black — コ/ゴ. 182 occurrences sur 7 planches, 6 ouvrages ; ゴクウブラック attesté 80× dans le même corpus.
	{
		lu: "コクウブラック",
		correct: "ゴクウブラック",
		fr: "Goku Black",
		confusion: "コ/ゴ",
		occurrences: 182,
		planches: 7,
		attesteJuste: 80,
	},
	// Puerh — ブ/プ. 19 occurrences sur 15 planches, 12 ouvrages ; プーアル attesté 19× dans le même corpus.
	{
		lu: "ブーアル",
		correct: "プーアル",
		fr: "Puerh",
		confusion: "ブ/プ",
		occurrences: 19,
		planches: 15,
		attesteJuste: 19,
	},
	// Gogeta (DBZ/GT) — シ/ジ. 16 occurrences sur 8 planches, 8 ouvrages ; ゴジータ attesté 340× dans le même corpus.
	{
		lu: "ゴシータ",
		correct: "ゴジータ",
		fr: "Gogeta (DBZ/GT)",
		confusion: "シ/ジ",
		occurrences: 16,
		planches: 8,
		attesteJuste: 340,
	},
	// Garlic — カ/ガ. 14 occurrences sur 5 planches, 5 ouvrages ; ガーリック attesté 265× dans le même corpus.
	{
		lu: "カーリック",
		correct: "ガーリック",
		fr: "Garlic",
		confusion: "カ/ガ",
		occurrences: 14,
		planches: 5,
		attesteJuste: 265,
	},
	// Zarbon — サ/ザ. 13 occurrences sur 7 planches, 6 ouvrages ; ザーボン attesté 100× dans le même corpus.
	{
		lu: "サーボン",
		correct: "ザーボン",
		fr: "Zarbon",
		confusion: "サ/ザ",
		occurrences: 13,
		planches: 7,
		attesteJuste: 100,
	},
	// Janemba — シ/ジ. 12 occurrences sur 6 planches, 5 ouvrages ; ジャネンバ attesté 128× dans le même corpus.
	{
		lu: "シャネンバ",
		correct: "ジャネンバ",
		fr: "Janemba",
		confusion: "シ/ジ",
		occurrences: 12,
		planches: 6,
		attesteJuste: 128,
	},
	// Paikûhan — バ/パ. 10 occurrences sur 7 planches, 7 ouvrages ; パイクーハン attesté 61× dans le même corpus.
	{
		lu: "バイクーハン",
		correct: "パイクーハン",
		fr: "Paikûhan",
		confusion: "バ/パ",
		occurrences: 10,
		planches: 7,
		attesteJuste: 61,
	},
	// Ptéranodon — ブ/プ. 9 occurrences sur 3 planches, 2 ouvrages ; プテラノドン attesté 1× dans le même corpus.
	{
		lu: "ブテラノドン",
		correct: "プテラノドン",
		fr: "Ptéranodon",
		confusion: "ブ/プ",
		occurrences: 9,
		planches: 3,
		attesteJuste: 1,
	},
	// Berserker (Race de Freezer) — パ/バ. 8 occurrences sur 4 planches, 4 ouvrages ; バーサーカー attesté 20× dans le même corpus.
	{
		lu: "パーサーカー",
		correct: "バーサーカー",
		fr: "Berserker (Race de Freezer)",
		confusion: "パ/バ",
		occurrences: 8,
		planches: 4,
		attesteJuste: 20,
	},
	// Broly (DBZ) — フ/ブ. 8 occurrences sur 6 planches, 5 ouvrages ; ブロリー attesté 1030× dans le même corpus.
	{
		lu: "フロリー",
		correct: "ブロリー",
		fr: "Broly (DBZ)",
		confusion: "フ/ブ",
		occurrences: 8,
		planches: 6,
		attesteJuste: 1030,
	},
	// Babidi — テ/デ. 7 occurrences sur 4 planches, 4 ouvrages ; バビディ attesté 323× dans le même corpus.
	{
		lu: "バビティ",
		correct: "バビディ",
		fr: "Babidi",
		confusion: "テ/デ",
		occurrences: 7,
		planches: 4,
		attesteJuste: 323,
	},
	// Bubbles — パ/バ. 7 occurrences sur 5 planches, 4 ouvrages ; バブルス attesté 37× dans le même corpus.
	{
		lu: "パブルス",
		correct: "バブルス",
		fr: "Bubbles",
		confusion: "パ/バ",
		occurrences: 7,
		planches: 5,
		attesteJuste: 37,
	},
	// Bibidi — テ/デ. 7 occurrences sur 4 planches, 4 ouvrages ; ビビディ attesté 51× dans le même corpus.
	{
		lu: "ビビティ",
		correct: "ビビディ",
		fr: "Bibidi",
		confusion: "テ/デ",
		occurrences: 7,
		planches: 4,
		attesteJuste: 51,
	},
	// Poutine — ブ/プ. 7 occurrences sur 2 planches, 2 ouvrages ; プティン attesté 2× dans le même corpus.
	{
		lu: "ブティン",
		correct: "プティン",
		fr: "Poutine",
		confusion: "ブ/プ",
		occurrences: 7,
		planches: 2,
		attesteJuste: 2,
	},
	// Freezer (futur) — サ/ザ. 7 occurrences sur 5 planches, 5 ouvrages ; フリーザ attesté 2754× dans le même corpus.
	{
		lu: "フリーサ",
		correct: "フリーザ",
		fr: "Freezer (futur)",
		confusion: "サ/ザ",
		occurrences: 7,
		planches: 5,
		attesteJuste: 2754,
	},
	// Zangya — サ/ザ. 6 occurrences sur 6 planches, 3 ouvrages ; ザンギャ attesté 17× dans le même corpus.
	{
		lu: "サンギャ",
		correct: "ザンギャ",
		fr: "Zangya",
		confusion: "サ/ザ",
		occurrences: 6,
		planches: 6,
		attesteJuste: 17,
	},
	// Ebifurya — ピ/ビ. 5 occurrences sur 5 planches, 5 ouvrages ; エビフリャー attesté 4× dans le même corpus.
	{
		lu: "エピフリャー",
		correct: "エビフリャー",
		fr: "Ebifurya",
		confusion: "ピ/ビ",
		occurrences: 5,
		planches: 5,
		attesteJuste: 4,
	},
	// Gravy — ク/グ. 5 occurrences sur 1 planches, 1 ouvrages ; グレイビー attesté 8× dans le même corpus.
	{
		lu: "クレイビー",
		correct: "グレイビー",
		fr: "Gravy",
		confusion: "ク/グ",
		occurrences: 5,
		planches: 1,
		attesteJuste: 8,
	},
	// Sharpner — ブ/プ. 5 occurrences sur 5 planches, 5 ouvrages ; シャプナー attesté 5× dans le même corpus.
	{
		lu: "シャブナー",
		correct: "シャプナー",
		fr: "Sharpner",
		confusion: "ブ/プ",
		occurrences: 5,
		planches: 5,
		attesteJuste: 5,
	},
	// Tapikar — ビ/ピ. 5 occurrences sur 3 planches, 2 ouvrages ; タピカー attesté 2× dans le même corpus.
	{
		lu: "タビカー",
		correct: "タピカー",
		fr: "Tapikar",
		confusion: "ビ/ピ",
		occurrences: 5,
		planches: 3,
		attesteJuste: 2,
	},
	// Bardock — タ/ダ. 5 occurrences sur 3 planches, 3 ouvrages ; バーダック attesté 510× dans le même corpus.
	{
		lu: "バータック",
		correct: "バーダック",
		fr: "Bardock",
		confusion: "タ/ダ",
		occurrences: 5,
		planches: 3,
		attesteJuste: 510,
	},
	// Babidi — ハ/バ. 5 occurrences sur 4 planches, 4 ouvrages ; バビディ attesté 323× dans le même corpus.
	{
		lu: "ハビディ",
		correct: "バビディ",
		fr: "Babidi",
		confusion: "ハ/バ",
		occurrences: 5,
		planches: 4,
		attesteJuste: 323,
	},
	// Poutine — フ/プ. 5 occurrences sur 3 planches, 3 ouvrages ; プティン attesté 2× dans le même corpus.
	{
		lu: "フティン",
		correct: "プティン",
		fr: "Poutine",
		confusion: "フ/プ",
		occurrences: 5,
		planches: 3,
		attesteJuste: 2,
	},
	// Raditz — テ/デ. 5 occurrences sur 2 planches, 2 ouvrages ; ラディッツ attesté 230× dans le même corpus.
	{
		lu: "ラティッツ",
		correct: "ラディッツ",
		fr: "Raditz",
		confusion: "テ/デ",
		occurrences: 5,
		planches: 2,
		attesteJuste: 230,
	},
	// Champa — バ/パ. 4 occurrences sur 4 planches, 4 ouvrages ; シャンパ attesté 95× dans le même corpus.
	{
		lu: "シャンバ",
		correct: "シャンパ",
		fr: "Champa",
		confusion: "バ/パ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 95,
	},
	// Barman — パ/バ. 4 occurrences sur 2 planches, 1 ouvrages ; バーテンダー attesté 1× dans le même corpus.
	{
		lu: "パーテンダー",
		correct: "バーテンダー",
		fr: "Barman",
		confusion: "パ/バ",
		occurrences: 4,
		planches: 2,
		attesteJuste: 1,
	},
	// Frog — ク/グ. 4 occurrences sur 1 planches, 1 ouvrages ; フーログ attesté 2× dans le même corpus.
	{
		lu: "フーロク",
		correct: "フーログ",
		fr: "Frog",
		confusion: "ク/グ",
		occurrences: 4,
		planches: 1,
		attesteJuste: 2,
	},
	// Froze — ス/ズ. 4 occurrences sur 3 planches, 3 ouvrages ; フローズ attesté 7× dans le même corpus.
	{
		lu: "フロース",
		correct: "フローズ",
		fr: "Froze",
		confusion: "ス/ズ",
		occurrences: 4,
		planches: 3,
		attesteJuste: 7,
	},
	// Bonyû — ポ/ボ. 4 occurrences sur 1 planches, 1 ouvrages ; ボニュー attesté 2× dans le même corpus.
	{
		lu: "ポニュー",
		correct: "ボニュー",
		fr: "Bonyû",
		confusion: "ポ/ボ",
		occurrences: 4,
		planches: 1,
		attesteJuste: 2,
	},
	// Gotenks — デ/テ. 3 occurrences sur 2 planches, 2 ouvrages ; ゴテンクス attesté 399× dans le même corpus.
	{
		lu: "ゴデンクス",
		correct: "ゴテンクス",
		fr: "Gotenks",
		confusion: "デ/テ",
		occurrences: 3,
		planches: 2,
		attesteJuste: 399,
	},
	// Bourbon — ポ/ボ. 3 occurrences sur 2 planches, 1 ouvrages ; バーボン attesté 4× dans le même corpus.
	{
		lu: "バーポン",
		correct: "バーボン",
		fr: "Bourbon",
		confusion: "ポ/ボ",
		occurrences: 3,
		planches: 2,
		attesteJuste: 4,
	},
	// Paragus (DBS) — バ/パ. 3 occurrences sur 3 planches, 3 ouvrages ; パラガス attesté 199× dans le même corpus.
	{
		lu: "バラガス",
		correct: "パラガス",
		fr: "Paragus (DBS)",
		confusion: "バ/パ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 199,
	},
	// Big bang — ピ/ビ. 3 occurrences sur 2 planches, 1 ouvrages ; ビッグバンアタック attesté 18× dans le même corpus.
	{
		lu: "ピッグバンアタック",
		correct: "ビッグバンアタック",
		fr: "Big bang",
		confusion: "ピ/ビ",
		occurrences: 3,
		planches: 2,
		attesteJuste: 18,
	},
	// Pinich — ビ/ピ. 3 occurrences sur 3 planches, 2 ouvrages ; ピニッジ attesté 3× dans le même corpus.
	{
		lu: "ビニッジ",
		correct: "ピニッジ",
		fr: "Pinich",
		confusion: "ビ/ピ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 3,
	},
	// Vegetto — ペ/ベ. 3 occurrences sur 3 planches, 3 ouvrages ; ベジット attesté 288× dans le même corpus.
	{
		lu: "ペジット",
		correct: "ベジット",
		fr: "Vegetto",
		confusion: "ペ/ベ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 288,
	},
	// Yajirobé (futur) — シ/ジ. 3 occurrences sur 3 planches, 3 ouvrages ; ヤジロベー attesté 134× dans le même corpus.
	{
		lu: "ヤシロベー",
		correct: "ヤジロベー",
		fr: "Yajirobé (futur)",
		confusion: "シ/ジ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 134,
	},
	// Acqua — グ/ク. 2 occurrences sur 1 planches, 1 ouvrages ; アークア attesté 6× dans le même corpus.
	{
		lu: "アーグア",
		correct: "アークア",
		fr: "Acqua",
		confusion: "グ/ク",
		occurrences: 2,
		planches: 1,
		attesteJuste: 6,
	},
	// Apple — ブ/プ. 2 occurrences sur 2 planches, 2 ouvrages ; アプール attesté 12× dans le même corpus.
	{
		lu: "アブール",
		correct: "アプール",
		fr: "Apple",
		confusion: "ブ/プ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 12,
	},
	// Idâsa — タ/ダ. 2 occurrences sur 1 planches, 1 ouvrages ; イダーサ attesté 6× dans le même corpus.
	{
		lu: "イターサ",
		correct: "イダーサ",
		fr: "Idâsa",
		confusion: "タ/ダ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 6,
	},
	// Captain Chicken — ブ/プ. 2 occurrences sur 1 planches, 1 ouvrages ; キャプテン・チキン attesté 2× dans le même corpus.
	{
		lu: "キャブテン・チキン",
		correct: "キャプテン・チキン",
		fr: "Captain Chicken",
		confusion: "ブ/プ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 2,
	},
	// Goku Black — フ/ブ. 2 occurrences sur 2 planches, 2 ouvrages ; ゴクウブラック attesté 80× dans le même corpus.
	{
		lu: "ゴクウフラック",
		correct: "ゴクウブラック",
		fr: "Goku Black",
		confusion: "フ/ブ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 80,
	},
	// Goku Black — プ/ブ. 2 occurrences sur 2 planches, 2 ouvrages ; ゴクウブラック attesté 80× dans le même corpus.
	{
		lu: "ゴクウプラック",
		correct: "ゴクウブラック",
		fr: "Goku Black",
		confusion: "プ/ブ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 80,
	},
	// Jimizu — ス/ズ. 2 occurrences sur 2 planches, 1 ouvrages ; ジーミズ attesté 1× dans le même corpus.
	{
		lu: "ジーミス",
		correct: "ジーミズ",
		fr: "Jimizu",
		confusion: "ス/ズ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 1,
	},
	// Bibidi — ヒ/ビ. 2 occurrences sur 2 planches, 2 ouvrages ; ビビディ attesté 51× dans le même corpus.
	{
		lu: "ヒビディ",
		correct: "ビビディ",
		fr: "Bibidi",
		confusion: "ヒ/ビ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 51,
	},
	// Bujin — フ/ブ. 2 occurrences sur 2 planches, 2 ouvrages ; ブージン attesté 21× dans le même corpus.
	{
		lu: "フージン",
		correct: "ブージン",
		fr: "Bujin",
		confusion: "フ/ブ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 21,
	},
	// Blueberry — ペ/ベ. 2 occurrences sur 1 planches, 1 ouvrages ; ブールベリ attesté 3× dans le même corpus.
	{
		lu: "ブールペリ",
		correct: "ブールベリ",
		fr: "Blueberry",
		confusion: "ペ/ベ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 3,
	},
	// Vegeta (SDBH) — ダ/タ. 2 occurrences sur 1 planches, 1 ouvrages ; ベジータ attesté 3577× dans le même corpus.
	{
		lu: "ベジーダ",
		correct: "ベジータ",
		fr: "Vegeta (SDBH)",
		confusion: "ダ/タ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 3577,
	},
	// Mr. Satan — ダ/タ. 2 occurrences sur 1 planches, 1 ouvrages ; ミスター・サタン attesté 229× dans le même corpus.
	{
		lu: "ミスター・サダン",
		correct: "ミスター・サタン",
		fr: "Mr. Satan",
		confusion: "ダ/タ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 229,
	},
	// Mechikabra — フ/ブ. 2 occurrences sur 2 planches, 2 ouvrages ; メチカブラ attesté 65× dans le même corpus.
	{
		lu: "メチカフラ",
		correct: "メチカブラ",
		fr: "Mechikabra",
		confusion: "フ/ブ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 65,
	},
	// Anguila — キ/ギ. 1 occurrence sur 1 planche, 1 ouvrage ; アンギラ attesté 12× dans le même corpus.
	{
		lu: "アンキラ",
		correct: "アンギラ",
		fr: "Anguila",
		confusion: "キ/ギ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 12,
	},
	// Obotchaman — ポ/ボ. 1 occurrence sur 1 planche, 1 ouvrage ; オボッチャマン attesté 4× dans le même corpus.
	{
		lu: "オポッチャマン",
		correct: "オボッチャマン",
		fr: "Obotchaman",
		confusion: "ポ/ボ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 4,
	},
	// Catopesra — ベ/ペ. 1 occurrence sur 1 planche, 1 ouvrage ; カトペスラ attesté 2× dans le même corpus.
	{
		lu: "カトベスラ",
		correct: "カトペスラ",
		fr: "Catopesra",
		confusion: "ベ/ペ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 2,
	},
	// Caterpy — ビ/ピ. 1 occurrence sur 1 planche, 1 ouvrage ; キャタピー attesté 3× dans le même corpus.
	{
		lu: "キャタビー",
		correct: "キャタピー",
		fr: "Caterpy",
		confusion: "ビ/ピ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 3,
	},
	// Grégory — ク/グ. 1 occurrence sur 1 planche, 1 ouvrage ; グレゴリー attesté 20× dans le même corpus.
	{
		lu: "クレゴリー",
		correct: "グレゴリー",
		fr: "Grégory",
		confusion: "ク/グ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 20,
	},
	// Sauzer — サ/ザ. 1 occurrence sur 1 planche, 1 ouvrage ; サウザー attesté 29× dans le même corpus.
	{
		lu: "サウサー",
		correct: "サウザー",
		fr: "Sauzer",
		confusion: "サ/ザ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 29,
	},
	// Janemba — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; ジャネンバ attesté 128× dans le même corpus.
	{
		lu: "ジャネンパ",
		correct: "ジャネンバ",
		fr: "Janemba",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 128,
	},
	// Baby Janenba — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ジャネンバベビー attesté 2× dans le même corpus.
	{
		lu: "ジャネンバベピー",
		correct: "ジャネンバベビー",
		fr: "Baby Janenba",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 2,
	},
	// Baby Janenba — ペ/ベ. 1 occurrence sur 1 planche, 1 ouvrage ; ジャネンバベビー attesté 2× dans le même corpus.
	{
		lu: "ジャネンバペビー",
		correct: "ジャネンバベビー",
		fr: "Baby Janenba",
		confusion: "ペ/ベ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 2,
	},
	// Zircol — シ/ジ. 1 occurrence sur 1 planche, 1 ouvrage ; ジルコル attesté 0× dans le même corpus.
	{
		lu: "シルコル",
		correct: "ジルコル",
		fr: "Zircol",
		confusion: "シ/ジ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 0,
	},
	// Spopovitch — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; スポポビッチ attesté 69× dans le même corpus.
	{
		lu: "スポポピッチ",
		correct: "スポポビッチ",
		fr: "Spopovitch",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 69,
	},
	// Tapikar — ダ/タ. 1 occurrence sur 1 planche, 1 ouvrage ; タピカー attesté 2× dans le même corpus.
	{
		lu: "ダピカー",
		correct: "タピカー",
		fr: "Tapikar",
		confusion: "ダ/タ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 2,
	},
	// Dr Mu — ト/ド. 1 occurrence sur 1 planche, 1 ouvrage ; ドクター・ミュー attesté 49× dans le même corpus.
	{
		lu: "トクター・ミュー",
		correct: "ドクター・ミュー",
		fr: "Dr Mu",
		confusion: "ト/ド",
		occurrences: 1,
		planches: 1,
		attesteJuste: 49,
	},
	// Totappo — ド/ト. 1 occurrence sur 1 planche, 1 ouvrage ; トテッポ attesté 11× dans le même corpus.
	{
		lu: "ドテッポ",
		correct: "トテッポ",
		fr: "Totappo",
		confusion: "ド/ト",
		occurrences: 1,
		planches: 1,
		attesteJuste: 11,
	},
	// Dodoria — ト/ド. 1 occurrence sur 1 planche, 1 ouvrage ; ドドリア attesté 74× dans le même corpus.
	{
		lu: "トドリア",
		correct: "ドドリア",
		fr: "Dodoria",
		confusion: "ト/ド",
		occurrences: 1,
		planches: 1,
		attesteJuste: 74,
	},
	// Dodoria — ト/ド. 1 occurrence sur 1 planche, 1 ouvrage ; ドドリア attesté 74× dans le même corpus.
	{
		lu: "ドトリア",
		correct: "ドドリア",
		fr: "Dodoria",
		confusion: "ト/ド",
		occurrences: 1,
		planches: 1,
		attesteJuste: 74,
	},
	// Trunks — ド/ト. 1 occurrence sur 1 planche, 1 ouvrage ; トランクス attesté 1578× dans le même corpus.
	{
		lu: "ドランクス",
		correct: "トランクス",
		fr: "Trunks",
		confusion: "ド/ト",
		occurrences: 1,
		planches: 1,
		attesteJuste: 1578,
	},
	// Torbie — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; トルビー attesté 12× dans le même corpus.
	{
		lu: "トルピー",
		correct: "トルビー",
		fr: "Torbie",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 12,
	},
	// Dorodabo — ト/ド. 1 occurrence sur 1 planche, 1 ouvrage ; ドロダボ attesté 9× dans le même corpus.
	{
		lu: "トロダボ",
		correct: "ドロダボ",
		fr: "Dorodabo",
		confusion: "ト/ド",
		occurrences: 1,
		planches: 1,
		attesteJuste: 9,
	},
	// Dorodabo — タ/ダ. 1 occurrence sur 1 planche, 1 ouvrage ; ドロダボ attesté 9× dans le même corpus.
	{
		lu: "ドロタボ",
		correct: "ドロダボ",
		fr: "Dorodabo",
		confusion: "タ/ダ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 9,
	},
	// Neko Majin Z — シ/ジ. 1 occurrence sur 1 planche, 1 ouvrage ; ネコマジン attesté 216× dans le même corpus.
	{
		lu: "ネコマシン",
		correct: "ネコマジン",
		fr: "Neko Majin Z",
		confusion: "シ/ジ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 216,
	},
	// Bourbon — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; バーボン attesté 4× dans le même corpus.
	{
		lu: "パーボン",
		correct: "バーボン",
		fr: "Bourbon",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 4,
	},
	// Bio Broly — フ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; バイオブロリー attesté 16× dans le même corpus.
	{
		lu: "バイオフロリー",
		correct: "バイオブロリー",
		fr: "Bio Broly",
		confusion: "フ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 16,
	},
	// Papperoni — バ/パ. 1 occurrence sur 1 planche, 1 ouvrage ; パパロニ attesté 0× dans le même corpus.
	{
		lu: "パバロニ",
		correct: "パパロニ",
		fr: "Papperoni",
		confusion: "バ/パ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 0,
	},
	// Babidi — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; バビディ attesté 323× dans le même corpus.
	{
		lu: "バピディ",
		correct: "バビディ",
		fr: "Babidi",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 323,
	},
	// Bubbles — プ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; バブルス attesté 37× dans le même corpus.
	{
		lu: "バプルス",
		correct: "バブルス",
		fr: "Bubbles",
		confusion: "プ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 37,
	},
	// Videl — ヒ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ビーデル attesté 340× dans le même corpus.
	{
		lu: "ヒーデル",
		correct: "ビーデル",
		fr: "Videl",
		confusion: "ヒ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 340,
	},
	// Hirudegân — カ/ガ. 1 occurrence sur 1 planche, 1 ouvrage ; ヒルデガーン attesté 156× dans le même corpus.
	{
		lu: "ヒルデカーン",
		correct: "ヒルデガーン",
		fr: "Hirudegân",
		confusion: "カ/ガ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 156,
	},
	// Piroshki — ヒ/ピ. 1 occurrence sur 1 planche, 1 ouvrage ; ピロシキ attesté 11× dans le même corpus.
	{
		lu: "ヒロシキ",
		correct: "ピロシキ",
		fr: "Piroshki",
		confusion: "ヒ/ピ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 11,
	},
	// Piroshki — ビ/ピ. 1 occurrence sur 1 planche, 1 ouvrage ; ピロシキ attesté 11× dans le même corpus.
	{
		lu: "ビロシキ",
		correct: "ピロシキ",
		fr: "Piroshki",
		confusion: "ビ/ピ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 11,
	},
	// Puerh — フ/プ. 1 occurrence sur 1 planche, 1 ouvrage ; プーアル attesté 19× dans le même corpus.
	{
		lu: "フーアル",
		correct: "プーアル",
		fr: "Puerh",
		confusion: "フ/プ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 19,
	},
	// Blueberry — プ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; ブールベリ attesté 3× dans le même corpus.
	{
		lu: "プールベリ",
		correct: "ブールベリ",
		fr: "Blueberry",
		confusion: "プ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 3,
	},
	// Bubibinman — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ブビビンマン attesté 0× dans le même corpus.
	{
		lu: "ブビピンマン",
		correct: "ブビビンマン",
		fr: "Bubibinman",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 0,
	},
	// Freezer (futur) — ブ/フ. 1 occurrence sur 1 planche, 1 ouvrage ; フリーザ attesté 2754× dans le même corpus.
	{
		lu: "ブリーザ",
		correct: "フリーザ",
		fr: "Freezer (futur)",
		confusion: "ブ/フ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 2754,
	},
	// Methiop — フ/プ. 1 occurrence sur 1 planche, 1 ouvrage ; メチオープ attesté 0× dans le même corpus.
	{
		lu: "メチオーフ",
		correct: "メチオープ",
		fr: "Methiop",
		confusion: "フ/プ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 0,
	},
	// Mohican — ビ/ヒ. 1 occurrence sur 1 planche, 1 ouvrage ; モヒカン attesté 5× dans le même corpus.
	{
		lu: "モビカン",
		correct: "モヒカン",
		fr: "Mohican",
		confusion: "ビ/ヒ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 5,
	},
	// Rhumush — ジ/シ. 1 occurrence sur 1 planche, 1 ouvrage ; ラムーシ attesté 7× dans le même corpus.
	{
		lu: "ラムージ",
		correct: "ラムーシ",
		fr: "Rhumush",
		confusion: "ジ/シ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 7,
	},
	// ペンギン — ベ/ペ. 67 occurrences sur 53 planches, 17 ouvrages ; ペンギン attesté 56× dans le même corpus.
	{
		lu: "ベンギン",
		correct: "ペンギン",
		fr: "ペンギン",
		confusion: "ベ/ペ",
		occurrences: 67,
		planches: 53,
		attesteJuste: 56,
	},
	// ドラゴンボールヒーローズ — ス/ズ. 44 occurrences sur 36 planches, 29 ouvrages ; ドラゴンボールヒーローズ attesté 182× dans le même corpus.
	{
		lu: "ドラゴンボールヒーロース",
		correct: "ドラゴンボールヒーローズ",
		fr: "ドラゴンボールヒーローズ",
		confusion: "ス/ズ",
		occurrences: 44,
		planches: 36,
		attesteJuste: 182,
	},
	// ゴッド — コ/ゴ. 42 occurrences sur 21 planches, 18 ouvrages ; ゴッド attesté 269× dans le même corpus.
	{
		lu: "コッド",
		correct: "ゴッド",
		fr: "ゴッド",
		confusion: "コ/ゴ",
		occurrences: 42,
		planches: 21,
		attesteJuste: 269,
	},
	// Broly (DBZ) — プ/ブ. 25 occurrences sur 9 planches, 7 ouvrages ; ブロリー attesté 1002× dans le même corpus.
	{
		lu: "プロリー",
		correct: "ブロリー",
		fr: "Broly (DBZ)",
		confusion: "プ/ブ",
		occurrences: 25,
		planches: 9,
		attesteJuste: 1002,
	},
	// ブルー — フ/ブ. 22 occurrences sur 9 planches, 6 ouvrages ; ブルー attesté 199× dans le même corpus.
	{
		lu: "フルー",
		correct: "ブルー",
		fr: "ブルー",
		confusion: "フ/ブ",
		occurrences: 22,
		planches: 9,
		attesteJuste: 199,
	},
	// ドラゴンボール — ポ/ボ. 20 occurrences sur 11 planches, 11 ouvrages ; ドラゴンボール attesté 3855× dans le même corpus.
	{
		lu: "ドラゴンポール",
		correct: "ドラゴンボール",
		fr: "ドラゴンボール",
		confusion: "ポ/ボ",
		occurrences: 20,
		planches: 11,
		attesteJuste: 3855,
	},
	// ダーブラ — タ/ダ. 17 occurrences sur 13 planches, 10 ouvrages ; ダーブラ attesté 155× dans le même corpus.
	{
		lu: "ターブラ",
		correct: "ダーブラ",
		fr: "ダーブラ",
		confusion: "タ/ダ",
		occurrences: 17,
		planches: 13,
		attesteJuste: 155,
	},
	// ザマス — サ/ザ. 13 occurrences sur 9 planches, 6 ouvrages ; ザマス attesté 95× dans le même corpus.
	{
		lu: "サマス",
		correct: "ザマス",
		fr: "ザマス",
		confusion: "サ/ザ",
		occurrences: 13,
		planches: 9,
		attesteJuste: 95,
	},
	// ゼットソード — セ/ゼ. 13 occurrences sur 10 planches, 7 ouvrages ; ゼットソード attesté 37× dans le même corpus.
	{
		lu: "セットソード",
		correct: "ゼットソード",
		fr: "ゼットソード",
		confusion: "セ/ゼ",
		occurrences: 13,
		planches: 10,
		attesteJuste: 37,
	},
	// ドラゴンボール — ト/ド. 13 occurrences sur 11 planches, 7 ouvrages ; ドラゴンボール attesté 3855× dans le même corpus.
	{
		lu: "トラゴンボール",
		correct: "ドラゴンボール",
		fr: "ドラゴンボール",
		confusion: "ト/ド",
		occurrences: 13,
		planches: 11,
		attesteJuste: 3855,
	},
	// ポルンガ — ボ/ポ. 13 occurrences sur 10 planches, 6 ouvrages ; ポルンガ attesté 97× dans le même corpus.
	{
		lu: "ボルンガ",
		correct: "ポルンガ",
		fr: "ポルンガ",
		confusion: "ボ/ポ",
		occurrences: 13,
		planches: 10,
		attesteJuste: 97,
	},
	// グレートサイヤマン — ク/グ. 11 occurrences sur 10 planches, 9 ouvrages ; グレートサイヤマン attesté 168× dans le même corpus.
	{
		lu: "クレートサイヤマン",
		correct: "グレートサイヤマン",
		fr: "グレートサイヤマン",
		confusion: "ク/グ",
		occurrences: 11,
		planches: 10,
		attesteJuste: 168,
	},
	// ブラック — フ/ブ. 11 occurrences sur 4 planches, 3 ouvrages ; ブラック attesté 117× dans le même corpus.
	{
		lu: "フラック",
		correct: "ブラック",
		fr: "ブラック",
		confusion: "フ/ブ",
		occurrences: 11,
		planches: 4,
		attesteJuste: 117,
	},
	// ゼニー — セ/ゼ. 10 occurrences sur 5 planches, 4 ouvrages ; ゼニー attesté 58× dans le même corpus.
	{
		lu: "セニー",
		correct: "ゼニー",
		fr: "ゼニー",
		confusion: "セ/ゼ",
		occurrences: 10,
		planches: 5,
		attesteJuste: 58,
	},
	// Bulma — フ/ブ. 10 occurrences sur 5 planches, 5 ouvrages ; ブルマ attesté 1302× dans le même corpus.
	{
		lu: "フルマ",
		correct: "ブルマ",
		fr: "Bulma",
		confusion: "フ/ブ",
		occurrences: 10,
		planches: 5,
		attesteJuste: 1302,
	},
	// ゴールデンフリーザ — コ/ゴ. 9 occurrences sur 4 planches, 3 ouvrages ; ゴールデンフリーザ attesté 65× dans le même corpus.
	{
		lu: "コールデンフリーザ",
		correct: "ゴールデンフリーザ",
		fr: "ゴールデンフリーザ",
		confusion: "コ/ゴ",
		occurrences: 9,
		planches: 4,
		attesteJuste: 65,
	},
	// ジャンプ — ブ/プ. 9 occurrences sur 2 planches, 2 ouvrages ; ジャンプ attesté 1804× dans le même corpus.
	{
		lu: "ジャンブ",
		correct: "ジャンプ",
		fr: "ジャンプ",
		confusion: "ブ/プ",
		occurrences: 9,
		planches: 2,
		attesteJuste: 1804,
	},
	// スーパードラゴンボールヒーローズ — コ/ゴ. 9 occurrences sur 2 planches, 2 ouvrages ; スーパードラゴンボールヒーローズ attesté 216× dans le même corpus.
	{
		lu: "スーパードラコンボールヒーローズ",
		correct: "スーパードラゴンボールヒーローズ",
		fr: "スーパードラゴンボールヒーローズ",
		confusion: "コ/ゴ",
		occurrences: 9,
		planches: 2,
		attesteJuste: 216,
	},
	// ブルー — プ/ブ. 9 occurrences sur 4 planches, 4 ouvrages ; ブルー attesté 199× dans le même corpus.
	{
		lu: "プルー",
		correct: "ブルー",
		fr: "ブルー",
		confusion: "プ/ブ",
		occurrences: 9,
		planches: 4,
		attesteJuste: 199,
	},
	// Baby — ペ/ベ. 9 occurrences sur 7 planches, 5 ouvrages ; ベビー attesté 320× dans le même corpus.
	{
		lu: "ペビー",
		correct: "ベビー",
		fr: "Baby",
		confusion: "ペ/ベ",
		occurrences: 9,
		planches: 7,
		attesteJuste: 320,
	},
	// スーパードラゴンボールヒーローズ — ス/ズ. 8 occurrences sur 7 planches, 7 ouvrages ; スーパードラゴンボールヒーローズ attesté 216× dans le même corpus.
	{
		lu: "スーパードラゴンボールヒーロース",
		correct: "スーパードラゴンボールヒーローズ",
		fr: "スーパードラゴンボールヒーローズ",
		confusion: "ス/ズ",
		occurrences: 8,
		planches: 7,
		attesteJuste: 216,
	},
	// ドラゴンボールヒーローズ — ポ/ボ. 8 occurrences sur 4 planches, 4 ouvrages ; ドラゴンボールヒーローズ attesté 182× dans le même corpus.
	{
		lu: "ドラゴンポールヒーローズ",
		correct: "ドラゴンボールヒーローズ",
		fr: "ドラゴンボールヒーローズ",
		confusion: "ポ/ボ",
		occurrences: 8,
		planches: 4,
		attesteJuste: 182,
	},
	// Ghourd — ト/ド. 7 occurrences sur 5 planches, 5 ouvrages ; グルド attesté 59× dans le même corpus.
	{
		lu: "グルト",
		correct: "グルド",
		fr: "Ghourd",
		confusion: "ト/ド",
		occurrences: 7,
		planches: 5,
		attesteJuste: 59,
	},
	// ドラゴンボールスーパー — バ/パ. 7 occurrences sur 7 planches, 7 ouvrages ; ドラゴンボールスーパー attesté 21× dans le même corpus.
	{
		lu: "ドラゴンボールスーバー",
		correct: "ドラゴンボールスーパー",
		fr: "ドラゴンボールスーパー",
		confusion: "バ/パ",
		occurrences: 7,
		planches: 7,
		attesteJuste: 21,
	},
	// Basil — パ/バ. 7 occurrences sur 2 planches, 2 ouvrages ; バジル attesté 7× dans le même corpus.
	{
		lu: "パジル",
		correct: "バジル",
		fr: "Basil",
		confusion: "パ/バ",
		occurrences: 7,
		planches: 2,
		attesteJuste: 7,
	},
	// Beerus — ヒ/ビ. 7 occurrences sur 5 planches, 5 ouvrages ; ビルス attesté 550× dans le même corpus.
	{
		lu: "ヒルス",
		correct: "ビルス",
		fr: "Beerus",
		confusion: "ヒ/ビ",
		occurrences: 7,
		planches: 5,
		attesteJuste: 550,
	},
	// Rezun — ス/ズ. 7 occurrences sur 7 planches, 7 ouvrages ; レズン attesté 6× dans le même corpus.
	{
		lu: "レスン",
		correct: "レズン",
		fr: "Rezun",
		confusion: "ス/ズ",
		occurrences: 7,
		planches: 7,
		attesteJuste: 6,
	},
	// Karin — ガ/カ. 6 occurrences sur 5 planches, 1 ouvrage ; カリン attesté 355× dans le même corpus.
	{
		lu: "ガリン",
		correct: "カリン",
		fr: "Karin",
		confusion: "ガ/カ",
		occurrences: 6,
		planches: 5,
		attesteJuste: 355,
	},
	// ギニュー — キ/ギ. 6 occurrences sur 4 planches, 4 ouvrages ; ギニュー attesté 287× dans le même corpus.
	{
		lu: "キニュー",
		correct: "ギニュー",
		fr: "ギニュー",
		confusion: "キ/ギ",
		occurrences: 6,
		planches: 4,
		attesteJuste: 287,
	},
	// Gotenks — コ/ゴ. 6 occurrences sur 2 planches, 2 ouvrages ; ゴテンクス attesté 406× dans le même corpus.
	{
		lu: "コテンクス",
		correct: "ゴテンクス",
		fr: "Gotenks",
		confusion: "コ/ゴ",
		occurrences: 6,
		planches: 2,
		attesteJuste: 406,
	},
	// ジャンプ — シ/ジ. 6 occurrences sur 5 planches, 5 ouvrages ; ジャンプ attesté 1804× dans le même corpus.
	{
		lu: "シャンプ",
		correct: "ジャンプ",
		fr: "ジャンプ",
		confusion: "シ/ジ",
		occurrences: 6,
		planches: 5,
		attesteJuste: 1804,
	},
	// Butta — パ/バ. 6 occurrences sur 6 planches, 5 ouvrages ; バータ attesté 52× dans le même corpus.
	{
		lu: "パータ",
		correct: "バータ",
		fr: "Butta",
		confusion: "パ/バ",
		occurrences: 6,
		planches: 6,
		attesteJuste: 52,
	},
	// ブイジャンプ — フ/ブ. 6 occurrences sur 5 planches, 5 ouvrages ; ブイジャンプ attesté 136× dans le même corpus.
	{
		lu: "フイジャンプ",
		correct: "ブイジャンプ",
		fr: "ブイジャンプ",
		confusion: "フ/ブ",
		occurrences: 6,
		planches: 5,
		attesteJuste: 136,
	},
	// ドッカンバトル — ト/ド. 5 occurrences sur 1 planche, 1 ouvrage ; ドッカンバトル attesté 91× dans le même corpus.
	{
		lu: "トッカンバトル",
		correct: "ドッカンバトル",
		fr: "ドッカンバトル",
		confusion: "ト/ド",
		occurrences: 5,
		planches: 1,
		attesteJuste: 91,
	},
	// Pasta — バ/パ. 5 occurrences sur 2 planches, 1 ouvrage ; パスタ attesté 15× dans le même corpus.
	{
		lu: "バスタ",
		correct: "パスタ",
		fr: "Pasta",
		confusion: "バ/パ",
		occurrences: 5,
		planches: 2,
		attesteJuste: 15,
	},
	// Piccolo — ビ/ピ. 5 occurrences sur 4 planches, 4 ouvrages ; ピッコロ attesté 2327× dans le même corpus.
	{
		lu: "ビッコロ",
		correct: "ピッコロ",
		fr: "Piccolo",
		confusion: "ビ/ピ",
		occurrences: 5,
		planches: 4,
		attesteJuste: 2327,
	},
	// レジェンズ — ス/ズ. 5 occurrences sur 5 planches, 5 ouvrages ; レジェンズ attesté 30× dans le même corpus.
	{
		lu: "レジェンス",
		correct: "レジェンズ",
		fr: "レジェンズ",
		confusion: "ス/ズ",
		occurrences: 5,
		planches: 5,
		attesteJuste: 30,
	},
	// レッドリボン — ポ/ボ. 5 occurrences sur 2 planches, 2 ouvrages ; レッドリボン attesté 229× dans le même corpus.
	{
		lu: "レッドリポン",
		correct: "レッドリボン",
		fr: "レッドリボン",
		confusion: "ポ/ボ",
		occurrences: 5,
		planches: 2,
		attesteJuste: 229,
	},
	// ドッカンバトル — パ/バ. 4 occurrences sur 4 planches, 3 ouvrages ; ドッカンバトル attesté 91× dans le même corpus.
	{
		lu: "ドッカンパトル",
		correct: "ドッカンバトル",
		fr: "ドッカンバトル",
		confusion: "パ/バ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 91,
	},
	// ドラゴンボール — ホ/ボ. 4 occurrences sur 4 planches, 4 ouvrages ; ドラゴンボール attesté 3855× dans le même corpus.
	{
		lu: "ドラゴンホール",
		correct: "ドラゴンボール",
		fr: "ドラゴンボール",
		confusion: "ホ/ボ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 3855,
	},
	// Nappa — バ/パ. 4 occurrences sur 3 planches, 2 ouvrages ; ナッパ attesté 250× dans le même corpus.
	{
		lu: "ナッバ",
		correct: "ナッパ",
		fr: "Nappa",
		confusion: "バ/パ",
		occurrences: 4,
		planches: 3,
		attesteJuste: 250,
	},
	// Neizu — ス/ズ. 4 occurrences sur 4 planches, 4 ouvrages ; ネイズ attesté 11× dans le même corpus.
	{
		lu: "ネイス",
		correct: "ネイズ",
		fr: "Neizu",
		confusion: "ス/ズ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 11,
	},
	// パオズ — バ/パ. 4 occurrences sur 3 planches, 3 ouvrages ; パオズ attesté 12× dans le même corpus.
	{
		lu: "バオズ",
		correct: "パオズ",
		fr: "パオズ",
		confusion: "バ/パ",
		occurrences: 4,
		planches: 3,
		attesteJuste: 12,
	},
	// Hirudegân — テ/デ. 4 occurrences sur 2 planches, 2 ouvrages ; ヒルデガーン attesté 166× dans le même corpus.
	{
		lu: "ヒルテガーン",
		correct: "ヒルデガーン",
		fr: "Hirudegân",
		confusion: "テ/デ",
		occurrences: 4,
		planches: 2,
		attesteJuste: 166,
	},
	// Vegeta (SDBH) — ペ/ベ. 4 occurrences sur 4 planches, 4 ouvrages ; ベジータ attesté 3629× dans le même corpus.
	{
		lu: "ペジータ",
		correct: "ベジータ",
		fr: "Vegeta (SDBH)",
		confusion: "ペ/ベ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 3629,
	},
	// レッドリボン — ホ/ボ. 4 occurrences sur 4 planches, 4 ouvrages ; レッドリボン attesté 229× dans le même corpus.
	{
		lu: "レッドリホン",
		correct: "レッドリボン",
		fr: "レッドリボン",
		confusion: "ホ/ボ",
		occurrences: 4,
		planches: 4,
		attesteJuste: 229,
	},
	// Oob — フ/ブ. 3 occurrences sur 3 planches, 2 ouvrages ; ウーブ attesté 133× dans le même corpus.
	{
		lu: "ウーフ",
		correct: "ウーブ",
		fr: "Oob",
		confusion: "フ/ブ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 133,
	},
	// Gokua — コ/ゴ. 3 occurrences sur 3 planches, 3 ouvrages ; ゴクア attesté 19× dans le même corpus.
	{
		lu: "コクア",
		correct: "ゴクア",
		fr: "Gokua",
		confusion: "コ/ゴ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 19,
	},
	// ジャッキー — シ/ジ. 3 occurrences sur 2 planches, 1 ouvrage ; ジャッキー attesté 159× dans le même corpus.
	{
		lu: "シャッキー",
		correct: "ジャッキー",
		fr: "ジャッキー",
		confusion: "シ/ジ",
		occurrences: 3,
		planches: 2,
		attesteJuste: 159,
	},
	// ドラゴンボールスーパー — コ/ゴ. 3 occurrences sur 3 planches, 3 ouvrages ; ドラゴンボールスーパー attesté 21× dans le même corpus.
	{
		lu: "ドラコンボールスーパー",
		correct: "ドラゴンボールスーパー",
		fr: "ドラゴンボールスーパー",
		confusion: "コ/ゴ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 21,
	},
	// ドラゴンボールヒーローズ — ビ/ヒ. 3 occurrences sur 3 planches, 3 ouvrages ; ドラゴンボールヒーローズ attesté 182× dans le même corpus.
	{
		lu: "ドラゴンボールビーローズ",
		correct: "ドラゴンボールヒーローズ",
		fr: "ドラゴンボールヒーローズ",
		confusion: "ビ/ヒ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 182,
	},
	// Baby — ピ/ビ. 3 occurrences sur 2 planches, 2 ouvrages ; ベビー attesté 320× dans le même corpus.
	{
		lu: "ベピー",
		correct: "ベビー",
		fr: "Baby",
		confusion: "ピ/ビ",
		occurrences: 3,
		planches: 2,
		attesteJuste: 320,
	},
	// Bongo — コ/ゴ. 3 occurrences sur 3 planches, 2 ouvrages ; ボンゴ attesté 10× dans le même corpus.
	{
		lu: "ボンコ",
		correct: "ボンゴ",
		fr: "Bongo",
		confusion: "コ/ゴ",
		occurrences: 3,
		planches: 3,
		attesteJuste: 10,
	},
	// Cooler — グ/ク. 2 occurrences sur 2 planches, 2 ouvrages ; クウラ attesté 212× dans le même corpus.
	{
		lu: "グウラ",
		correct: "クウラ",
		fr: "Cooler",
		confusion: "グ/ク",
		occurrences: 2,
		planches: 2,
		attesteJuste: 212,
	},
	// ジャンプ — フ/プ. 2 occurrences sur 2 planches, 2 ouvrages ; ジャンプ attesté 1804× dans le même corpus.
	{
		lu: "ジャンフ",
		correct: "ジャンプ",
		fr: "ジャンプ",
		confusion: "フ/プ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 1804,
	},
	// スーパードラゴンボールヒーローズ — バ/パ. 2 occurrences sur 2 planches, 2 ouvrages ; スーパードラゴンボールヒーローズ attesté 216× dans le même corpus.
	{
		lu: "スーバードラゴンボールヒーローズ",
		correct: "スーパードラゴンボールヒーローズ",
		fr: "スーパードラゴンボールヒーローズ",
		confusion: "バ/パ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 216,
	},
	// ダーブラ — プ/ブ. 2 occurrences sur 1 planche, 1 ouvrage ; ダーブラ attesté 155× dans le même corpus.
	{
		lu: "ダープラ",
		correct: "ダーブラ",
		fr: "ダーブラ",
		confusion: "プ/ブ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 155,
	},
	// ドッカンバトル — ハ/バ. 2 occurrences sur 2 planches, 2 ouvrages ; ドッカンバトル attesté 91× dans le même corpus.
	{
		lu: "ドッカンハトル",
		correct: "ドッカンバトル",
		fr: "ドッカンバトル",
		confusion: "ハ/バ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 91,
	},
	// ドラゴンボールスーパー — ポ/ボ. 2 occurrences sur 2 planches, 2 ouvrages ; ドラゴンボールスーパー attesté 21× dans le même corpus.
	{
		lu: "ドラゴンポールスーパー",
		correct: "ドラゴンボールスーパー",
		fr: "ドラゴンボールスーパー",
		confusion: "ポ/ボ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 21,
	},
	// Pansie — バ/パ. 2 occurrences sur 2 planches, 1 ouvrage ; パンジ attesté 25× dans le même corpus.
	{
		lu: "バンジ",
		correct: "パンジ",
		fr: "Pansie",
		confusion: "バ/パ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 25,
	},
	// Bibidi — ピ/ビ. 2 occurrences sur 1 planche, 1 ouvrage ; ビビディ attesté 62× dans le même corpus.
	{
		lu: "ピビディ",
		correct: "ビビディ",
		fr: "Bibidi",
		confusion: "ピ/ビ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 62,
	},
	// Pilaf — ビ/ピ. 2 occurrences sur 1 planche, 1 ouvrage ; ピラフ attesté 380× dans le même corpus.
	{
		lu: "ビラフ",
		correct: "ピラフ",
		fr: "Pilaf",
		confusion: "ビ/ピ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 380,
	},
	// ブイジャンプ — ブ/プ. 2 occurrences sur 2 planches, 2 ouvrages ; ブイジャンプ attesté 136× dans le même corpus.
	{
		lu: "ブイジャンブ",
		correct: "ブイジャンプ",
		fr: "ブイジャンプ",
		confusion: "ブ/プ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 136,
	},
	// ブイジャンプ — プ/ブ. 2 occurrences sur 2 planches, 2 ouvrages ; ブイジャンプ attesté 136× dans le même corpus.
	{
		lu: "プイジャンプ",
		correct: "ブイジャンプ",
		fr: "ブイジャンプ",
		confusion: "プ/ブ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 136,
	},
	// Fin — プ/フ. 2 occurrences sur 2 planches, 2 ouvrages ; フィン attesté 24× dans le même corpus.
	{
		lu: "プィン",
		correct: "フィン",
		fr: "Fin",
		confusion: "プ/フ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 24,
	},
	// ブヨン — プ/ブ. 2 occurrences sur 1 planche, 1 ouvrage ; ブヨン attesté 27× dans le même corpus.
	{
		lu: "プヨン",
		correct: "ブヨン",
		fr: "ブヨン",
		confusion: "プ/ブ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 27,
	},
	// ヘタッピマンガ — カ/ガ. 2 occurrences sur 2 planches, 1 ouvrage ; ヘタッピマンガ attesté 33× dans le même corpus.
	{
		lu: "ヘタッピマンカ",
		correct: "ヘタッピマンガ",
		fr: "ヘタッピマンガ",
		confusion: "カ/ガ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 33,
	},
	// ペンギン — キ/ギ. 2 occurrences sur 1 planche, 1 ouvrage ; ペンギン attesté 56× dans le même corpus.
	{
		lu: "ペンキン",
		correct: "ペンギン",
		fr: "ペンギン",
		confusion: "キ/ギ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 56,
	},
	// Bongo — ポ/ボ. 2 occurrences sur 1 planche, 1 ouvrage ; ボンゴ attesté 10× dans le même corpus.
	{
		lu: "ポンゴ",
		correct: "ボンゴ",
		fr: "Bongo",
		confusion: "ポ/ボ",
		occurrences: 2,
		planches: 1,
		attesteJuste: 10,
	},
	// Yakon — ゴ/コ. 2 occurrences sur 2 planches, 2 ouvrages ; ヤコン attesté 40× dans le même corpus.
	{
		lu: "ヤゴン",
		correct: "ヤコン",
		fr: "Yakon",
		confusion: "ゴ/コ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 40,
	},
	// Yajirobé (futur) — ペ/ベ. 2 occurrences sur 2 planches, 2 ouvrages ; ヤジロベー attesté 143× dans le même corpus.
	{
		lu: "ヤジロペー",
		correct: "ヤジロベー",
		fr: "Yajirobé (futur)",
		confusion: "ペ/ベ",
		occurrences: 2,
		planches: 2,
		attesteJuste: 143,
	},
	// Oob — プ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; ウーブ attesté 133× dans le même corpus.
	{
		lu: "ウープ",
		correct: "ウーブ",
		fr: "Oob",
		confusion: "プ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 133,
	},
	// ゴールデンフリーザ — テ/デ. 1 occurrence sur 1 planche, 1 ouvrage ; ゴールデンフリーザ attesté 65× dans le même corpus.
	{
		lu: "ゴールテンフリーザ",
		correct: "ゴールデンフリーザ",
		fr: "ゴールデンフリーザ",
		confusion: "テ/デ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 65,
	},
	// Gogeta (DBZ/GT) — コ/ゴ. 1 occurrence sur 1 planche, 1 ouvrage ; ゴジータ attesté 364× dans le même corpus.
	{
		lu: "コジータ",
		correct: "ゴジータ",
		fr: "Gogeta (DBZ/GT)",
		confusion: "コ/ゴ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 364,
	},
	// Gowasu (futur) — コ/ゴ. 1 occurrence sur 1 planche, 1 ouvrage ; ゴワス attesté 14× dans le même corpus.
	{
		lu: "コワス",
		correct: "ゴワス",
		fr: "Gowasu (futur)",
		confusion: "コ/ゴ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 14,
	},
	// ザマス — ズ/ス. 1 occurrence sur 1 planche, 1 ouvrage ; ザマス attesté 95× dans le même corpus.
	{
		lu: "ザマズ",
		correct: "ザマス",
		fr: "ザマス",
		confusion: "ズ/ス",
		occurrences: 1,
		planches: 1,
		attesteJuste: 95,
	},
	// Tambourine — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; タンバリン attesté 85× dans le même corpus.
	{
		lu: "タンパリン",
		correct: "タンバリン",
		fr: "Tambourine",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 85,
	},
	// Dende — テ/デ. 1 occurrence sur 1 planche, 1 ouvrage ; デンデ attesté 139× dans le même corpus.
	{
		lu: "テンデ",
		correct: "デンデ",
		fr: "Dende",
		confusion: "テ/デ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 139,
	},
	// ドラゴンボールヒーローズ — ホ/ボ. 1 occurrence sur 1 planche, 1 ouvrage ; ドラゴンボールヒーローズ attesté 182× dans le même corpus.
	{
		lu: "ドラゴンホールヒーローズ",
		correct: "ドラゴンボールヒーローズ",
		fr: "ドラゴンボールヒーローズ",
		confusion: "ホ/ボ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 182,
	},
	// Bardock — ハ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; バーダック attesté 455× dans le même corpus.
	{
		lu: "ハーダック",
		correct: "バーダック",
		fr: "Bardock",
		confusion: "ハ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 455,
	},
	// Bardock — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; バーダック attesté 455× dans le même corpus.
	{
		lu: "パーダック",
		correct: "バーダック",
		fr: "Bardock",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 455,
	},
	// Bio Broly — プ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; バイオブロリー attesté 17× dans le même corpus.
	{
		lu: "バイオプロリー",
		correct: "バイオブロリー",
		fr: "Bio Broly",
		confusion: "プ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 17,
	},
	// Babidi — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; バビディ attesté 346× dans le même corpus.
	{
		lu: "パビディ",
		correct: "バビディ",
		fr: "Babidi",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 346,
	},
	// Videl — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ビーデル attesté 347× dans le même corpus.
	{
		lu: "ピーデル",
		correct: "ビーデル",
		fr: "Videl",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 347,
	},
	// Piano — ビ/ピ. 1 occurrence sur 1 planche, 1 ouvrage ; ピアノ attesté 9× dans le même corpus.
	{
		lu: "ビアノ",
		correct: "ピアノ",
		fr: "Piano",
		confusion: "ビ/ピ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 9,
	},
	// ビッグバンミッション — パ/バ. 1 occurrence sur 1 planche, 1 ouvrage ; ビッグバンミッション attesté 10× dans le même corpus.
	{
		lu: "ビッグパンミッション",
		correct: "ビッグバンミッション",
		fr: "ビッグバンミッション",
		confusion: "パ/バ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 10,
	},
	// ビッグバンミッション — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ビッグバンミッション attesté 10× dans le même corpus.
	{
		lu: "ピッグバンミッション",
		correct: "ビッグバンミッション",
		fr: "ビッグバンミッション",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 10,
	},
	// Bido — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ビドー attesté 13× dans le même corpus.
	{
		lu: "ピドー",
		correct: "ビドー",
		fr: "Bido",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 13,
	},
	// Beerus — ズ/ス. 1 occurrence sur 1 planche, 1 ouvrage ; ビルス attesté 550× dans le même corpus.
	{
		lu: "ビルズ",
		correct: "ビルス",
		fr: "Beerus",
		confusion: "ズ/ス",
		occurrences: 1,
		planches: 1,
		attesteJuste: 550,
	},
	// Beerus — ピ/ビ. 1 occurrence sur 1 planche, 1 ouvrage ; ビルス attesté 550× dans le même corpus.
	{
		lu: "ピルス",
		correct: "ビルス",
		fr: "Beerus",
		confusion: "ピ/ビ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 550,
	},
	// ブヨン — フ/ブ. 1 occurrence sur 1 planche, 1 ouvrage ; ブヨン attesté 27× dans le même corpus.
	{
		lu: "フヨン",
		correct: "ブヨン",
		fr: "ブヨン",
		confusion: "フ/ブ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 27,
	},
	// Botamo — ポ/ボ. 1 occurrence sur 1 planche, 1 ouvrage ; ボタモ attesté 5× dans le même corpus.
	{
		lu: "ポタモ",
		correct: "ボタモ",
		fr: "Botamo",
		confusion: "ポ/ボ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 5,
	},
	// ポルンガ — ホ/ポ. 1 occurrence sur 1 planche, 1 ouvrage ; ポルンガ attesté 97× dans le même corpus.
	{
		lu: "ホルンガ",
		correct: "ポルンガ",
		fr: "ポルンガ",
		confusion: "ホ/ポ",
		occurrences: 1,
		planches: 1,
		attesteJuste: 97,
	},
];

/**
 * Une agglutination : la même faute de dakuten, mais collée à ses voisins.
 *
 * La garde de frontière refuse ces occurrences, et c'est délibéré — elle ne
 * peut pas savoir où le mot commence quand rien ne le sépare du suivant. Le
 * reliquat qu'elle laisse a donc été mesuré (38 occurrences sur les 86 paires)
 * puis tranché **à la main**, une par une, avec le contexte sous les yeux.
 *
 * Chaque entrée est ancrée sur sa chaîne complète, voisins compris : c'est ce
 * qui remplace la frontière. `パーサーカー` seul serait dangereux — il est une
 * sous-chaîne de `スーパーボンバーマン`, où la garde a évité sept régressions ;
 * `ベジットパーサーカー` ne l'est pas.
 *
 * Deux entrées ne corrigent que la part démontrable de leur planche, et
 * laissent le reste au relecteur — ce module répare des dakuten, il n'insère
 * ni ne supprime de caractère :
 *
 *   - `フリーサアミリー` devient `フリーザアミリー` et non `フリーザファミリー` :
 *     le `フ` de « ファミリー » a bien été mangé, mais `フリーザファミリー`
 *     n'apparaît **nulle part** dans le corpus (0 occurrence), donc rien
 *     n'atteste ce composé et le restituer serait le supposer ;
 *   - `バイカフロリー` devient `バイカブロリー` : la carte est vraisemblablement
 *     `バイオブロリー` (19 occurrences ailleurs), mais la confusion `カ`/`オ`
 *     n'est pas un dakuten et n'a pas de preuve propre.
 *
 * Dans les deux cas le nom redevient trouvable par la recherche, ce qui est le
 * bénéfice réel, sans qu'aucun caractère écrit ne soit supposé.
 */
export interface AgglutinationValidee {
	/** La chaîne agglutinée, telle qu'elle figure dans le corpus. */
	lu: string;
	/** Ce qu'elle doit devenir. */
	correct: string;
	/** Où elle a été lue — pour que le relecteur retrouve la planche. */
	planche: string;
	/** Ce qui prouve la lecture. */
	note: string;
}

/**
 * Les 17 agglutinations tranchées à la main, sur les 38 mesurées sur les 86 premières paires.
 *
 * Les 21 autres sont refusées, et le refus est aussi documenté que
 * l'acceptation :
 *
 *   - `スーパーボンバーマン` ×7 — `パーボン` y est une sous-chaîne du titre de
 *     Hudson. La garde générale les avait déjà écartées : c'est la preuve la
 *     plus nette qu'elle n'est pas décorative.
 *   - `シャネンバク` ×6 (#33 p.15) — la planche est hallucinée de bout en bout
 *     (« 超サイMANの骨格にそばせた体 »), et le `ク` final n'a aucune explication.
 *   - `ターレースサーボン` (#12 p.191) — même cas : « 地獄の獄の獄の獄に », le
 *     modèle a déraillé, et Turles ne croise jamais Zarbon.
 *   - `フロリースペichy` (#120 p.4) — planche corrompue plus largement
 *     (« スペichy » pour « スペシャル »).
 *   - `フロリーカ` (#102 p.4) — le `カ` qui suit peut appartenir à un mot coupé.
 *   - `フリーサン` (#116 p.9) — c'est très probablement Freezer, mais rien ne
 *     dit ce que devient le `ン` : le supprimer serait décider à la place du
 *     relecteur.
 */
export const AGGLUTINATIONS_VALIDEES_A_LA_MAIN: AgglutinationValidee[] = [
	// Le duo du 22e Tenkaichi. La même planche écrit « ウバとプーアルのコIN »
	// vingt caractères plus loin : la forme juste est là, à côté de la fautive.
	{
		lu: "ウバブーアル",
		correct: "ウバプーアル",
		planche: "#2 p.218",
		note: "プーアル juste sur la même planche",
	},
	// Liste de cartes du jeu Famicom, où chaque nom est écrit deux fois de
	// suite : « 仙豆せんず仙豆せんずバトル », « 龍ポルンガポルンガバトル ».
	{
		lu: "化ブーアルブーアル",
		correct: "化プーアルプーアル",
		planche: "#320 p.26",
		note: "le motif de la liste répète chaque nom",
	},
	// Film 11 : « le Super Saiyan légendaire réapparaît ». La même planche
	// écrit `バイオブロリー` en toutes lettres deux lignes plus bas.
	{
		lu: "超サイヤンフロリー",
		correct: "超サイヤンブロリー",
		planche: "#18 p.138",
		note: "バイオブロリー juste sur la même planche",
	},
	// Carte SDBH HJ7-41. Seul le dakuten est corrigé : voir la docstring.
	{
		lu: "バイカフロリー",
		correct: "バイカブロリー",
		planche: "#195 p.15",
		note: "カ/オ laissé au relecteur",
	},
	// Chronologie du Daizenshuu 7 : en 764, Trunks tue Freezer et son père.
	{
		lu: "トランクスフリーサ親子",
		correct: "トランクスフリーザ親子",
		planche: "#4 p.30",
		note: "chronologie de l'an 764",
	},
	// Film 12. Seul le dakuten est corrigé : voir la docstring.
	{
		lu: "フリーサアミリー",
		correct: "フリーザアミリー",
		planche: "#33 p.40",
		note: "フ de ファミリー laissé au relecteur",
	},
	// Tableaux de statistiques SDBH : « <personnage><type de combat> HP パワー
	// ガード <technique> ». Le corpus écrit ailleurs `孫悟空バーサーカー` et
	// `バトルタイプバーサーカー` exactement collés de la même façon — c'est le
	// format du tableau, pas une lecture douteuse.
	{
		lu: "ベジットパーサーカー",
		correct: "ベジットバーサーカー",
		planche: "#169 p.12",
		note: "tableau de stats SDBH",
	},
	{
		lu: "バトルタイプパーサーカー",
		correct: "バトルタイプバーサーカー",
		planche: "#171 p.4",
		note: "バトルタイプバーサーカー attesté collé ailleurs",
	},
	{
		lu: "アンギラパーサーカー",
		correct: "アンギラバーサーカー",
		planche: "#245 p.17",
		note: "tableau de stats SDBH",
	},
	{
		lu: "トワパーサーカー",
		correct: "トワバーサーカー",
		planche: "#194 p.16",
		note: "tableau de stats SDBH",
	},
	{
		lu: "ゼノパーサーカー",
		correct: "ゼノバーサーカー",
		planche: "#194 p.16",
		note: "tableau de stats SDBH (ダーブラ:ゼノ)",
	},
	{
		lu: "ミラパーサーカー",
		correct: "ミラバーサーカー",
		planche: "#194 p.16",
		note: "tableau de stats SDBH",
	},
	// Même format, colonne « type de carte » : « 魔神プティン » en HERO, avec
	// アイシクルイリュージョン pour technique.
	{
		lu: "ブティンヒーロー",
		correct: "プティンヒーロー",
		planche: "#174 p.14",
		note: "tableau de stats SDBH",
	},
	// Équipe de l'univers 6 : Hit et Champa. La planche écrit `破壊神シャンパ`
	// correctement trois lignes plus bas.
	{
		lu: "操リリシャンバ",
		correct: "操リリシャンパ",
		planche: "#189 p.15",
		note: "シャンパ juste sur la même planche",
	},
	// « le chef de l'empire des ténèbres Mechikabra entre en action ».
	{
		lu: "トップメチカフラ",
		correct: "トップメチカブラ",
		planche: "#178 p.19",
		note: "暗黒帝国のトップ = Mechikabra",
	},
	// Tableau de stats noyé dans un bruit répété (« アリヒイ » ×4) ; la ligne
	// voisine porte `トクター・リポ`, donc bien une colonne de docteurs.
	{
		lu: "イトクター・ミュー",
		correct: "イドクター・ミュー",
		planche: "#234 p.3",
		note: "tableau de stats, colonne de personnages",
	},
	// Légende dupliquée : « ▲Mohican — le concurrent qui a affronté Mohican ».
	{
		lu: "モビカンモビカン",
		correct: "モヒカンモヒカン",
		planche: "#18 p.224",
		note: "légende dupliquée du 21e Tenkaichi",
	},
];

/** Le bloc katakana d'Unicode, prolongateur et point médian compris. */
const KATAKANA = /[゠-ヿｦ-ﾟ]/;

/**
 * Le point médian sépare les composants d'un nom étranger (`ミスター・サタン`).
 * C'est une frontière de mot, pas une lettre : le compter comme un katakana
 * ferait manquer `ミニ・シャネンバ` sans protéger quoi que ce soit.
 */
const SEPARATEUR = "・";

/**
 * Le caractère termine-t-il un mot katakana ?
 *
 * Le bord du texte et le point médian valent frontière ; tout autre katakana,
 * non. Le prolongateur reste bloquant : il fait partie du mot, et sans lui
 * une forme courte mordrait dans une forme allongée.
 */
function frontiere(c: string | undefined): boolean {
	return c === undefined || c === SEPARATEUR || !KATAKANA.test(c);
}

/**
 * Formes longues d'abord, pour qu'une entrée courte n'ampute pas une entrée
 * longue qui la contiendrait (`フロリー` dans `バイオフロリー`). La frontière
 * katakana suffirait ici, mais l'ordre doit être garanti plutôt que fortuit.
 */
const ORDRE: FauteNomPropre[] = [...NOMS_PROPRES_MAL_LUS].toSorted((a, b) => b.lu.length - a.lu.length);

/** Même précaution pour les chaînes agglutinées, qui peuvent s'emboîter. */
const ORDRE_AGGLUTINE: AgglutinationValidee[] = [...AGGLUTINATIONS_VALIDEES_A_LA_MAIN].toSorted(
	(a, b) => b.lu.length - a.lu.length
);

/** Une substitution effectuée, telle qu'un relecteur doit pouvoir la revoir. */
export interface RemplacementNomPropre {
	lu: string;
	correct: string;
	/** Nombre de fois où cette paire a joué dans le texte. */
	n: number;
	/** Vrai si la substitution vient de la table d'agglutinations. */
	agglutine?: true;
}

/**
 * Applique la table et rend le détail paire par paire.
 *
 * Les agglutinations passent **en premier** : elles portent sur des chaînes
 * que la garde de frontière refuse, et une fois remplacées elles ne laissent
 * derrière elles que des graphies justes, sur lesquelles le balayage gardé
 * n'a plus rien à faire. L'ordre inverse marcherait tout autant, mais celui-ci
 * se raconte : d'abord ce qu'on a tranché à la main, ensuite ce que la règle
 * sait faire seule.
 *
 * Balayage caractère par caractère plutôt que `String.replace` : il faut
 * connaître le caractère qui précède ET celui qui suit à chaque candidat, et
 * une expression régulière à double regard aurait imposé d'échapper des
 * graphies qui, elles, n'ont rien à échapper. Les katakana restent dans le
 * plan de base d'Unicode, donc l'avancée par unité UTF-16 ne peut couper aucun
 * de ces mots ; une paire de substitution rencontrée ailleurs est recopiée
 * telle quelle, moitié par moitié, sans altération.
 */
export function detaillerNomsPropres(texte: string): {
	texte: string;
	corrections: number;
	details: RemplacementNomPropre[];
} {
	let corrections = 0;
	const comptes = new Map<string, RemplacementNomPropre>();

	// 1. Les chaînes agglutinées, tranchées à la main. Chacune est ancrée sur
	//    ses voisins, ce qui remplace la frontière.
	let entree = texte;
	for (const a of ORDRE_AGGLUTINE) {
		if (!entree.includes(a.lu)) continue;
		const morceaux = entree.split(a.lu);
		const n = morceaux.length - 1;
		entree = morceaux.join(a.correct);
		corrections += n;
		comptes.set(a.lu, { lu: a.lu, correct: a.correct, n, agglutine: true });
	}

	// 2. Le balayage gardé, sur mots entiers.
	let sortie = "";
	let i = 0;
	while (i < entree.length) {
		let trouve: FauteNomPropre | undefined;
		if (frontiere(i > 0 ? entree[i - 1] : undefined)) {
			trouve = ORDRE.find(
				(f) =>
					entree.startsWith(f.lu, i) &&
					frontiere(entree[i + f.lu.length]) &&
					!f.interdits?.some((suffixe) => entree.startsWith(suffixe, i + f.lu.length))
			);
		}
		if (trouve) {
			sortie += trouve.correct;
			i += trouve.lu.length;
			corrections++;
			const deja = comptes.get(trouve.lu);
			if (deja) deja.n++;
			else comptes.set(trouve.lu, { lu: trouve.lu, correct: trouve.correct, n: 1 });
			continue;
		}
		sortie += entree[i];
		i++;
	}

	return { texte: sortie, corrections, details: [...comptes.values()] };
}

/**
 * Corrige les noms propres mal lus d'une transcription.
 *
 * Pure et idempotente : aucune forme juste de l'une ou l'autre table n'est
 * elle-même une forme fautive, donc un second passage ne change rien (figé par
 * un test).
 */
export function corrigerNomsPropres(texte: string): { texte: string; rapport: RapportRegle[] } {
	const { texte: sortie, corrections } = detaillerNomsPropres(texte);
	return { texte: sortie, rapport: [{ code: "noms-propres", corrections }] };
}
