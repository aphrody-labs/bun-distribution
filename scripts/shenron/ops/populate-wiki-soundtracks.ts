#!/usr/bin/env bun
/**
 * populate-wiki-soundtracks.ts — Insertion canonique des génériques, endings et musiques cultes
 * dans bot.db_soundtracks (Toei Animation / Columbia Music / Akira Toriyama).
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

const SOUNDTRACKS = [
	{
		id: 10,
		slug: "romantic-ageru-yo",
		title: "Romantic Ageru yo",
		title_ja: "ロマンティックあげるよ",
		title_romaji: "Romantikku Ageru yo",
		track_type: "ending",
		series: "Dragon Ball",
		artist: "Ushio Hashimoto",
		composer: "Takeshi Ike",
		lyricist: "Takemi Yoshida",
		episodes_range: "Épisodes 1 à 153 (Dragon Ball)",
		release_year: 1986,
		description: "Générique de fin originel et poétique de toute la première série Dragon Ball. Mélodie nostalgique célébrant la jeunesse, l'insouciance et la recherche des rêves au soleil couchant.",
		article: `**Romantic Ageru yo** (ロマンティックあげるよ, *Romantikku Ageru yo*, « Je te donnerai de la romance ») est le premier et unique générique de clôture de la série animée originale *Dragon Ball*.\n\n## Un classique intemporel\n\nInterprété avec douceur par **Ushio Hashimoto** sur une mélodie inoubliable de **Takeshi Ike**, ce morceau a accompagné les spectateurs japonais du 26 février 1986 au 19 avril 1989 sur Fuji TV. Les images du générique dépeignent une jeune **Bulma** pensive observant la pluie à travers la fenêtre, puis contemplant le crépuscule en route vers de nouveaux horizons, incarnant l'émerveillement et la part sentimentale du voyage.\n\nLe single connut un immense succès commercial et reste l'un des titres les plus repris et aimés de la discographie Dragon Ball.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball", kind: "canon", label: "Générique de clôture officiel Toei Animation (1986-1989)" }
		]),
		visible: true
	},
	{
		id: 11,
		slug: "detekoi-tobikiri-zenkai-power",
		title: "Detekoi Tobikiri ZENKAI Power!",
		title_ja: "でてこいとびきりZENKAIパワー!",
		title_romaji: "Detekoi Tobikiri Zenkai Pawā!",
		track_type: "ending",
		series: "Dragon Ball Z",
		artist: "MANNA",
		composer: "Takeshi Ike",
		lyricist: "Naruhisa Arakawa",
		episodes_range: "Épisodes 1 à 199 (DBZ)",
		release_year: 1989,
		description: "Premier générique de clôture mythique de Dragon Ball Z mettant en scène le petit Son Gohan dans des mondes féeriques. Célèbre pour son message secret encodé en audio inversé au tout début du morceau.",
		article: `**Detekoi Tobikiri ZENKAI Power!** (でてこいとびきりZENKAIパワー!, *Detekoi Tobikiri Zenkai Pawā!*) est le premier générique de fin de *Dragon Ball Z*.\n\n## Le secret audio inversé\n\nLe morceau s'ouvre par une séquence sonore intrigante et mystérieuse. Il s'agit en réalité d'un message masqué enregistré à l'envers par le producteur musical **Kenji Shimizu** qui déclare : *« Ah, ce fut difficile d'enregistrer tout ça ! Bravo à l'équipe ! »* (*Ah, kono kyoku wo tsukuru no wa taihen datta !*).\n\n## Gohan au cœur de la fête\n\nLe clip d'animation met en vedette **Son Gohan** encore tout petit, galopant sur des gâteaux géants, grimpant sur le dos de Shenron et dansant avec les guerriers Z sous forme de figurines amicales. La chanson diffuse une énergie communicative joyeuse qui contrebalance la tension dramatique des sagas Saiyans et Freezer.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-z", kind: "canon", label: "Nippon Columbia — Single officiel DBZ (1989)" }
		]),
		visible: true
	},
	{
		id: 12,
		slug: "bokutachi-wa-tenshi-datta",
		title: "Bokutachi wa Tenshi Datta (We Were Angels)",
		title_ja: "僕達は天使だった",
		title_romaji: "Bokutachi wa Tenshi Datta",
		track_type: "ending",
		series: "Dragon Ball Z",
		artist: "Hironobu Kageyama",
		composer: "Chiho Kiyooka",
		lyricist: "Yukinojo Mori",
		episodes_range: "Épisodes 200 à 291 (DBZ)",
		release_year: 1993,
		description: "Second générique de fin de Dragon Ball Z, sublimé par la voix émouvante de Hironobu Kageyama. Symbole du passage de flambeau entre Gokū et ses fils et conclusion majestueuse de la saga Majin Boo.",
		article: `**Bokutachi wa Tenshi Datta** (僕達は天使だった, littéralement « Nous étions des anges ») est le chef-d'œuvre de clôture de *Dragon Ball Z*.\n\n## Une élégie d'adieu\n\nComposé par **Chiho Kiyooka** sur des paroles inspirées de **Yukinojo Mori**, le morceau est chanté avec une intensité bouleversante par le maître **Hironobu Kageyama**. Le visuel d'animation présente Son Gokū affublé d'une auréole et d'ailes d'ange blanches veillant depuis l'Au-delà sur sa famille, tandis que Gohan, Goten, Trunks et Vegeta poursuivent leur vie terrestre.\n\nLe titre est joué lors des derniers instants du 291e et ultime épisode de *Dragon Ball Z*, laissant une empreinte émotionnelle indélébile dans l'histoire de la culture manga mondiale.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-z", kind: "canon", label: "Nippon Columbia — DBZ Hit Song Collection (1993)" }
		]),
		visible: true
	},
	{
		id: 13,
		slug: "chozetsu-dynamic",
		title: "Chōzetsu☆Dynamic!",
		title_ja: "超絶☆ダイナミック!",
		title_romaji: "Chōzetsu Dainamikku!",
		track_type: "opening",
		series: "Dragon Ball Super",
		artist: "Kazuya Yoshii (The Yellow Monkey)",
		composer: "Kazuya Yoshii",
		lyricist: "Yukinojo Mori",
		episodes_range: "Épisodes 1 à 76 (Dragon Ball Super)",
		release_year: 2015,
		description: "Générique d'ouverture marquant le grand retour historique de Dragon Ball après 18 ans d'absence. Énergie pop-rock moderne célébrant le renouveau de la saga sous la plume d'Akira Toriyama.",
		article: `**Chōzetsu☆Dynamic!** (超絶☆ダイナミック!, *Chōzetsu Dainamikku!*) signe la renaissance de la franchise en 2015 avec l'arrivée de *Dragon Ball Super*.\n\n## Le retour du roi\n\nComposé et interprété par le rockeur emblématique **Kazuya Yoshii** (leader du groupe culte The Yellow Monkey), le titre bénéficie du retour aux affaires de **Yukinojo Mori**, l'auteur des textes de *Cha-La Head-Cha-La* et *We Gotta Power*. La chanson capture l'excitation des nouveaux mondes, l'ascension des dieux de la destruction et le dépassement perpétuel des limites martiales.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-super", kind: "canon", label: "Nippon Columbia — Single DBS (2015)" }
		]),
		visible: true
	},
	{
		id: 14,
		slug: "kyukyoku-no-battle",
		title: "Kyūkyoku no Battle (Ultimate Battle)",
		title_ja: "究極の聖戦",
		title_romaji: "Kyūkyoku no Battle",
		track_type: "insert_song",
		series: "Dragon Ball Super",
		artist: "Akira Kushida",
		composer: "ZENTA",
		lyricist: "Yukinojo Mori",
		episodes_range: "Épisodes 110, 116, 129, 130, 131 (DBS)",
		release_year: 2017,
		description: "Chanson d'insertion explosive accompagnant l'éveil et la maîtrise de l'Ultra Instinct (Migatte no Gokui) de Son Gokū face à Jiren dans le Tournoi du Pouvoir. Devenue un phénomène mondial dès sa première diffusion.",
		article: `**Kyūkyoku no Battle** (究極の聖戦, *Kyūkyoku no Batoru*, « La Sainte Bataille Ultime »), plus connue sous le refrain « Ka Ka Kachi Daze », est la chanson de combat la plus retentissante de l'ère moderne de *Dragon Ball*.\n\n## L'hymne de l'Ultra Instinct\n\nInterprétée par la voix de légende du tokusatsu **Akira Kushida** (*Space Sheriff Gavan*, *Kinnikuman*), cette chanson rock aux cuivres frénétiques intervient lors de l'épisode 110 lorsque Gokū renaît de l'explosion du Genkidama avec les yeux argentés de l'Ultra Instinct. Les accords de guitare accompagnent chacun des esquives réflexes imperceptibles de Gokū, galvanisant les spectateurs du monde entier.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-super", kind: "canon", label: "Dragon Ball Super Original Soundtrack Vol. 2 (2018)" }
		]),
		visible: true
	},
	{
		id: 15,
		slug: "hitori-janai",
		title: "Hitori Janai",
		title_ja: "ひとりじゃない",
		title_romaji: "Hitori Janai",
		track_type: "ending",
		series: "Dragon Ball GT",
		artist: "DEEN",
		composer: "Tetsurō Oda",
		lyricist: "Shuichi Ikemori",
		episodes_range: "Épisodes 1 à 26 (Dragon Ball GT)",
		release_year: 1996,
		description: "Premier générique de clôture émouvant de Dragon Ball GT interprété par le groupe DEEN. Accompagne le voyage spatial initiatique de Gokū enfant, Trunks et Pan à la recherche des Dragon Balls aux étoiles noires.",
		article: `**Hitori Janai** (ひとりじゃない, « Tu n'es pas seul ») est le premier ending de *Dragon Ball GT*.\n\n## Une mélodie de voyage stellaire\n\nÉcrit par **Shuichi Ikemori** et composé par le prolifique **Tetsurō Oda**, ce morceau pop-rock doux et chaleureux illustre les bivouacs nocturnes de l'équipage du vaisseau Tako, les paysages des planètes inconnues et les moments de camaraderie entre Gokū, Trunks et Pan. Le single a été certifié disque de platine au Japon avec plus de 400 000 exemplaires vendus.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-gt", kind: "canon", label: "B-Gram Records — Single DEEN (1996)" }
		]),
		visible: true
	},
	{
		id: 16,
		slug: "dont-you-see",
		title: "Don't You See!",
		title_ja: "Don't you see!",
		title_romaji: "Don't You See!",
		track_type: "ending",
		series: "Dragon Ball GT",
		artist: "ZARD (Izumi Sakai)",
		composer: "Seiichiro Kuribayashi",
		lyricist: "Izumi Sakai",
		episodes_range: "Épisodes 27 à 41 (Dragon Ball GT)",
		release_year: 1996,
		description: "Second ending mythique de Dragon Ball GT chanté par la regrettée icône pop Izumi Sakai (ZARD). Considéré comme l'une des plus belles mélodies de l'histoire des adaptations animées.",
		article: `**Don't You See!** est le second ending emblématique de *Dragon Ball GT*.\n\n## L'empreinte d'Izumi Sakai\n\nLa chanteuse et poétesse **Izumi Sakai**, leader charismatique de la formation **ZARD** (qui avait déjà composé les paroles de *Dan Dan Kokoro Hikareteku*), livre ici une performance vocale d'une pureté cristalline. Le clip montre un Gokū solitaire marchant sous les gratte-ciels pluvieux, observant les reflets dans les flaques d'eau, dans une tonalité mélancolique et poignante. Le single s'est écoulé à plus de 600 000 copies, atteignant la première place du classement hebdomadaire de l'Oricon.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-gt", kind: "canon", label: "B-Gram Records — Single ZARD (1996)" }
		]),
		visible: true
	},
	{
		id: 17,
		slug: "blue-velvet",
		title: "Blue Velvet",
		title_ja: "Blue Velvet",
		title_romaji: "Burū Berubetto",
		track_type: "ending",
		series: "Dragon Ball GT",
		artist: "Shizuka Kudo",
		composer: "Hatake (Sharam Q)",
		lyricist: "Shizuka Kudo",
		episodes_range: "Épisodes 42 à 50 (Dragon Ball GT)",
		release_year: 1997,
		description: "Troisième ending de Dragon Ball GT interprété par la superstar Shizuka Kudo sur une composition rock de Hatake. Rythme entraînant et refrain sensuel accompagnant la saga Super C-17.",
		article: `**Blue Velvet** est le troisième générique de fin de *Dragon Ball GT*.\n\n## Rock énergique et passion\n\nComposé par **Hatake**, le célèbre guitariste du groupe rock **Sharam Q**, et magnifié par le timbre grave et puissant de **Shizuka Kudo**, le morceau tranche avec la mélancolie des génériques précédents par une basse nerveuse et des riffs acérés. Il ponctue les affrontements acharnés contre les damnés évadés des Enfers et la bataille contre le redoutable Super C-17.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-gt", kind: "canon", label: "Pony Canyon — Single Shizuka Kudo (1997)" }
		]),
		visible: true
	},
	{
		id: 18,
		slug: "sabitsuita-machine-gun",
		title: "Sabitsuita Machine Gun de Ima o Uchinukō",
		title_ja: "錆びついたマシンガンで今を撃ち抜こう",
		title_romaji: "Sabitsuita Mashin Gan de Ima o Uchinukō",
		track_type: "ending",
		series: "Dragon Ball GT",
		artist: "WANDS",
		composer: "Miho Komatsu",
		lyricist: "Miho Komatsu",
		episodes_range: "Épisodes 51 à 64 (Dragon Ball GT)",
		release_year: 1997,
		description: "Quatrième et ultime générique de clôture de Dragon Ball GT composé par Miho Komatsu et chanté par le groupe de rock WANDS. Thème final des adieux de Son Gokū partant sur le dos de Shenron.",
		article: `**Sabitsuita Machine Gun de Ima o Uchinukō** (錆びついたマシンガンで今を撃ち抜こう, « Transperçons le présent avec une mitrailleuse rouillée ») est le dernier ending de *Dragon Ball GT*.\n\n## L'adieu légendaire de Gokū\n\nComposé par la compositrice et pianiste **Miho Komatsu** et interprété par **WANDS**, le morceau baigne les ultimes combats contre les sept Dragons Maléfiques nés de la corruption des Dragon Balls. Dans l'épisode 64, le morceau se mêle aux rétrospectives des amitiés de toute une vie (Kirin, Kamé Sennin, Piccolo, Vegeta), alors que Gokū s'endort sur le dos du grand dragon vert qui s'envole vers les cieux infinis.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-gt", kind: "canon", label: "B-Gram Records — Single WANDS (1997)" }
		]),
		visible: true
	},
	{
		id: 19,
		slug: "dragon-soul",
		title: "Dragon Soul",
		title_ja: "Dragon Soul",
		title_romaji: "Doragon Sōru",
		track_type: "opening",
		series: "Dragon Ball Kai",
		artist: "Takayoshi Tanimoto",
		composer: "Takayoshi Tanimoto",
		lyricist: "Yuriko Mori",
		episodes_range: "Épisodes 1 à 98 (Dragon Ball Kai)",
		release_year: 2009,
		description: "Opening officiel du remake remasterisé haute définition Dragon Ball Kai. Rythme effréné et cuivres éclatants saluant les 20 ans de la diffusion originale de Dragon Ball Z.",
		article: `**Dragon Soul** (ドラゴン・ソウル) est l'hymne d'ouverture composé spécialement pour *Dragon Ball Kai*, la version restaurée et resserrée au plus près du manga d'Akira Toriyama sans les épisodes de remplissage.\n\n## L'énergie de Takayoshi Tanimoto\n\nChanté par **Takayoshi Tanimoto** (également célèbre pour l'opening de *Gash Bell*), le morceau s'ouvre sur les tambours de guerre et les clameurs des Saiyans. Il est décliné en plusieurs versions et solos, et devient le symbole musical de la nouvelle génération d'amateurs de Dragon Ball des années 2010.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-kai", kind: "canon", label: "Columbia Music Entertainment — Single DB Kai (2009)" }
		]),
		visible: true
	},
	{
		id: 20,
		slug: "yeah-break-care-break",
		title: "Yeah! Break! Care! Break!",
		title_ja: "ヤ・ブ・レ・カ・ブ・レ",
		title_romaji: "Yeah! Break! Care! Break!",
		track_type: "ending",
		series: "Dragon Ball Kai",
		artist: "Takayoshi Tanimoto",
		composer: "Takafumi Iwasaki",
		lyricist: "Yuriko Mori",
		episodes_range: "Épisodes 1 à 54 (Dragon Ball Kai)",
		release_year: 2009,
		description: "Premier générique de fin survolté de Dragon Ball Kai. Jeu de mots vocal virtuose sur l'expression japonaise 'Yaburekabure' (l'audace du désespoir face au danger).",
		article: `**Yeah! Break! Care! Break!** (ヤブレカブレ, *Yaburekabure*) est l'ending des sagas Saiyans et Namek de *Dragon Ball Kai*.\n\nLe titre est un calembour musical basé sur les sonorités anglaises reproduisant le mot d'esprit nippon *Yaburekabure* (désinvolture face à l'impossible). L'animation présente les portraits dynamiques et colorés des combattants de la Terre et de Namek prêts à braver les pires menaces de l'espace.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-kai", kind: "canon", label: "Columbia Music Entertainment — Ending DB Kai (2009)" }
		]),
		visible: true
	},
	{
		id: 21,
		slug: "kuu-zen-zetsu-go",
		title: "Kuu-Zen-Zetsu-Go",
		title_ja: "空・前・絶・後 Kuu-Zen-Zetsu-Go",
		title_romaji: "Kūzenzetsugo",
		track_type: "opening",
		series: "Dragon Ball Kai",
		artist: "Takayoshi Tanimoto",
		composer: "Takafumi Iwasaki",
		lyricist: "Yukinojo Mori",
		episodes_range: "Épisodes 99 à 159 (DB Kai: The Final Chapters)",
		release_year: 2014,
		description: "Générique d'ouverture triomphal de la saga Majin Boo dans Dragon Ball Kai (The Final Chapters). Clameur de ralliement célébrant la bataille finale pour le destin de l'univers.",
		article: `**Kuu-Zen-Zetsu-Go** (空・前・絶・後, expression signifiant « Du jamais vu, sans précédent dans l'Histoire ») ouvre les épisodes de la saga Majin Boo de *Dragon Ball Kai*.\n\nAvec les paroles ciselées de **Yukinojo Mori** et la composition énergique de **Takafumi Iwasaki**, le titre accompagne l'introduction du Super Saiyan 3, la fusion Gotenks, l'avènement de Vegetto et l'ultime Genkidama cosmique purifiant Majin Boo.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-kai", kind: "canon", label: "Nippon Columbia — Single DB Kai Final Chapters (2014)" }
		]),
		visible: true
	},
	{
		id: 22,
		slug: "mind-power-ki",
		title: "MIND POWER…気…",
		title_ja: "MIND POWER…気…",
		title_romaji: "MIND POWER... Ki...",
		track_type: "insert_song",
		series: "Dragon Ball Z",
		artist: "Hironobu Kageyama & YUKA",
		composer: "Chiho Kiyooka",
		lyricist: "Sakiko Iwamuro",
		episodes_range: "Épisode 139 (DBZ)",
		release_year: 1992,
		description: "Chanson d'insertion atmosphérique culte décrivant l'angoisse de Trunks du Futur et le cauchemar éveillé de l'ère apocalyptique des Cyborgs C-17 et C-18.",
		article: `**MIND POWER…気…** est l'une des chansons d'insertion les plus marquantes et sombres de l'histoire de *Dragon Ball Z*.\n\n## La mélancolie du monde dévasté\n\nComposé par **Chiho Kiyooka**, ce morceau alterne les couplets introspectifs murmurés par **Yuka** et les montées vocales déchirantes de **Hironobu Kageyama**. Joué lors de l'épisode 139 lorsque Trunks relate à Gokū et ses amis la destruction inexorable de sa ligne temporelle, le titre illustre la terreur psychologique et le sentiment d'isolement total face aux cyborgs tueurs.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-z", kind: "canon", label: "Dragon Ball Z Hit Song Collection 11 (1992)" }
		]),
		visible: true
	},
	{
		id: 23,
		slug: "nakama",
		title: "NAKAMA",
		title_ja: "NAKAMA",
		title_romaji: "NAKAMA",
		track_type: "ending",
		series: "Dragon Ball Daima",
		artist: "Zedd feat. AI",
		composer: "Zedd",
		lyricist: "AI & Yukinojo Mori",
		episodes_range: "Épisodes 1 à 20 (Dragon Ball Daima)",
		release_year: 2024,
		description: "Générique de clôture de Dragon Ball Daima produit par le DJ et hitmaker mondial Zedd avec la chanteuse soul AI. Ode vibrante à la camaraderie et au voyage vers le Royaume des Démons.",
		article: `**NAKAMA** est le générique de fin conçu pour marquer le 40e anniversaire de l'univers d'Akira Toriyama dans *Dragon Ball Daima* (2024).\n\n## Rencontre Orient-Occident\n\nLe producteur germano-russe **Zedd**, grand passionné de l'œuvre de Toriyama, a uni ses synthétiseurs modernes à la voix chaude et puissante de la chanteuse américano-japonaise **AI**. Les paroles, coécrites avec le maître **Yukinojo Mori**, exaltent le lien sacré qui unit les camarades (*nakama*) par-delà les épreuves et les frontières du monde démoniaque.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-daima", kind: "canon", label: "Toei Animation / Universal Music (2024)" }
		]),
		visible: true
	},
	{
		id: 24,
		slug: "boogie-back",
		title: "Boogie Back",
		title_ja: "Boogie Back",
		title_romaji: "Bugi Bakku",
		track_type: "ending",
		series: "Dragon Ball Super",
		artist: "Miyu Inoue",
		composer: "Shingo Asari",
		lyricist: "Miyu Inoue",
		episodes_range: "Épisodes 84 à 96 (Dragon Ball Super)",
		release_year: 2017,
		description: "Générique de clôture dansant et ultra-stylé centré sur Bulma, précédant le coup d'envoi du Tournoi du Pouvoir. Rythmes R&B rétro-pop saluant la femme la plus importante de la saga.",
		article: `**Boogie Back** est le huitième ending de *Dragon Ball Super*.\n\n## Bulma à l'honneur\n\nÉcrit et chanté par la jeune révélation pop **Miyu Inoue**, ce morceau groove se distingue par son animation consacrée à **Bulma** : de l'adolescente intrépide du tome 1 découvrant Gokū à la brillante directrice scientifique de la Capsule Corporation veillant sur la nouvelle génération. Ce générique est devenu particulièrement émouvant pour la communauté suite à la disparition de la doubleuse historique de Bulma, Hiromi Tsuru, quelques mois plus tard.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/series/dragon-ball-super", kind: "canon", label: "Victor Entertainment — Single Miyu Inoue (2017)" }
		]),
		visible: true
	}
];

console.log(`Insertion de ${SOUNDTRACKS.length} musiques & OSTs emblématiques...`);

for (const track of SOUNDTRACKS) {
	await sql`
		INSERT INTO bot.db_soundtracks (
			id, slug, title, title_ja, title_romaji, track_type, series, artist, composer, lyricist,
			episodes_range, release_year, description, article, article_sources, visible
		) VALUES (
			${track.id}, ${track.slug}, ${track.title}, ${track.title_ja}, ${track.title_romaji}, ${track.track_type}, ${track.series},
			${track.artist}, ${track.composer}, ${track.lyricist}, ${track.episodes_range}, ${track.release_year}, ${track.description},
			${track.article}, ${track.article_sources}, ${track.visible}
		)
		ON CONFLICT (id) DO UPDATE SET
			slug = EXCLUDED.slug,
			title = EXCLUDED.title,
			title_ja = EXCLUDED.title_ja,
			title_romaji = EXCLUDED.title_romaji,
			track_type = EXCLUDED.track_type,
			series = EXCLUDED.series,
			artist = EXCLUDED.artist,
			composer = EXCLUDED.composer,
			lyricist = EXCLUDED.lyricist,
			episodes_range = EXCLUDED.episodes_range,
			release_year = EXCLUDED.release_year,
			description = EXCLUDED.description,
			article = EXCLUDED.article,
			article_sources = EXCLUDED.article_sources,
			visible = EXCLUDED.visible;
	`;
	console.log(`  ✓ Titre inséré/mis à jour : ${track.title} (${track.title_ja})`);
}

const total = await sql`SELECT COUNT(*) as count FROM bot.db_soundtracks WHERE visible = true;`;
console.log(`\nSuccès : bot.db_soundtracks compte désormais ${total[0].count} titres visibles.`);

await sql.end();
