#!/usr/bin/env bun
/**
 * populate-wiki-locations.ts — Insertion canonique des sanctuaires et lieux mythiques
 * manquants dans bot.db_locations (Daizenshuu 4 / 42 tomes Toriyama).
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

const LOCATIONS = [
	{
		id: 16,
		slug: "mont-paozu",
		name: "Mont Paozu",
		name_ja: "パオズ山",
		name_romaji: "Paozu-yama",
		realm_type: "Terre",
		planet: "Terre",
		description: "Région montagneuse luxuriante et isolée du Sud-Est, baignée de rivières et de forêts préhistoriques. Foyer d'enfance de Son Gokū auprès de son grand-père adoptif Son Gohan, puis résidence familiale de Gokū, Chichi, Gohan et Goten.",
		debut_chapter: "Chapitre 1",
		debut_episode: "Épisode 1 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Rencontre originelle", description: "Son Gokū enfant y rencontre Bulma pour la toute première fois en percutant sa voiture, initiant la légende de Dragon Ball." },
			{ title: "Maison familiale des Son", description: "Gokū et Chichi y bâtissent leur demeure où grandiront Son Gohan et Son Goten à l'abri du monde urbain." }
		]),
		article: `**Le Mont Paozu** (パオズ山, *Paozu-yama*) est la chaîne montagneuse isolée de la Terre où débute l'épopée mythique de *Dragon Ball*. Située dans les territoires sauvages de l'Est selon la cartographie du *Daizenshuu 4: World Guide*, cette région reculée abrite une faune antédiluvienne (dinosaures, tigres géants, poissons colossaux) et des reliefs escarpés.\n\n## Origine & Enfance de Gokū\n\nC'est sur les sentiers rocheux du Mont Paozu que le vieux maître **Son Gohan** découvre le nourrisson Kakarotto échoué dans sa capsule spatiale saiyan. Après sa chute dans un ravin qui efface sa programmation agressive originelle, Gokū est élevé dans la modeste bicoque de son grand-père adoptif, apprenant le kung-fu et la survie en symbiose totale avec la nature.\n\n## Le point de départ de l'histoire\n\nAu premier chapitre du manga d'Akira Toriyama (*Bloomer et Son Goku*), le jeune Gokū croise accidentellement la route de **Bulma**, venue chercher la boule à quatre étoiles (*Sūshinchū*) grâce au Dragon Radar. Ce choc initial marque l'envol de l'aventure.\n\nPlus tard, après le 23e Tenkaichi Budōkai et son mariage avec **Chichi**, Gokū revient s'établir définitivement au Mont Paozu. C'est là que naissent **Son Gohan** puis **Son Goten**, dans un havre de paix champêtre préservé des turbulences citadines.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/4#planche-74", kind: "databook", label: "Daizenshuu 4 — World Guide (Géographie terrestre)" },
			{ n: 2, url: "/wiki/manga/volume/1", kind: "manga_volume", label: "Manga Dragon Ball — Tome 1, Chapitre 1" }
		]),
		visible: true
	},
	{
		id: 17,
		slug: "mont-frypan",
		name: "Mont Frypan (Mont Frime)",
		name_ja: "フライパン山",
		name_romaji: "Furaipan-yama",
		realm_type: "Terre",
		planet: "Terre",
		description: "Ancien Mont Ryōshi métamorphosé en volcan démoniaque ceinturé par un incendie magique inextinguible. Forteresse du Roi Gyūmaō et lieu du tout premier Kaméhaméha d'Akira Toriyama exécuté par Kamé Sennin.",
		debut_chapter: "Chapitre 11",
		debut_episode: "Épisode 7 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "L'incendie surnaturel", description: "Un esprit du feu s'abat sur la montagne verdoyante et la transforme en brasier impénétrable protégeant le trésor de Gyūmaō." },
			{ title: "Le premier Kaméhaméha", description: "Kamé Sennin déploie sa puissance maximale à 100% et souffle la montagne entière d'une vague d'énergie titanesque pour éteindre le feu." }
		]),
		article: `**Le Mont Frypan** (フライパン山, *Furaipan-yama*, littéralement « Mont Poêle à frire »), autrefois nommé **Mont Ryōshi** (涼風山, *Ryōshizan*, « Mont de la Brise fraîche »), est une montagne légendaire de la Terre.\n\n## Le Château en Flammes\n\nDix ans avant le début de la quête des Dragon Balls, un incendie mystique s'abat sur le mont, piégeant le gigantesque château du **Roi Gyūmaō** (Bada) et ses trésors inestimables derrière un mur de flammes impénétrable. Gyūmaō, ancien condisciple de Son Gohan auprès de Kamé Sennin, garde farouchement les abords avec sa hache de guerre.\n\n## Démonstration de force de Kamé Sennin\n\nLorsque Gokū et Bulma arrivent pour récupérer la boule à six étoiles, Gyūmaō demande à Gokū de retrouver sa fille **Chichi** et de quérir l'Éventail Bashō auprès de Kamé Sennin. Ayant égaré l'artefact divin, Kamé Sennin se déplace en personne. Gonflant sa musculature au maximum, le maître octogénaire libère le premier **Kaméhaméha** de l'histoire du manga. La puissance dévastatrice du tir pulvérise à la fois le brasier et le château tout entier, dégageant la boule convoitée.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/4#planche-76", kind: "databook", label: "Daizenshuu 4 — World Guide" },
			{ n: 2, url: "/wiki/manga/volume/1", kind: "manga_volume", label: "Manga Dragon Ball — Tome 1, Chapitre 11" }
		]),
		visible: true
	},
	{
		id: 18,
		slug: "village-pingouin",
		name: "Village Pingouin (Île Gengorō)",
		name_ja: "ペンギン村",
		name_romaji: "Pengin-mura",
		realm_type: "Terre",
		planet: "Terre",
		description: "Village insulaire paisible et farfelu situé sur l'île Gengorō. Lieu de résidence de la surpuissante androïde Arale Norimaki et du Dr Senbei Norimaki, théâtre du célèbre cross-over canonique entre Dr. Slump et Dragon Ball.",
		debut_chapter: "Chapitre 81",
		debut_episode: "Épisode 55 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Poursuite du Général Blue", description: "Gokū poursuit l'aéroglisseur du Général Blue jusqu'au Village Pingouin et y rencontre la jeune Arale." },
			{ title: "Arale pulvérise Blue", description: "Arale neutralise le redoutable Général Blue en l'éjectant à des kilomètres d'un simple coup de tête innocent." }
		]),
		article: `**Le Village Pingouin** (ペンギン村, *Pengin-mura*) est le cadre idyllique de l'archipel Gengorō où se déroule la série culte d'Akira Toriyama, *Dr. Slump*, intégré canoniquement dans l'univers de *Dragon Ball* au tome 7 du manga.\n\n## Rencontre au sommet\n\nEn pleine traque des boules de cristal contre l'Armée du Red Ribbon, Son Gokū poursuit le cruel **Général Blue** à travers le globe. Leurs deux engins s'écrasent au beau milieu du Village Pingouin. Privé de son Dragon Radar endommagé, Gokū fait la connaissance d'**Arale Norimaki**, une petite fille androïde dotée d'une force physique capable de fendre la Terre en deux d'un coup de poing.\n\n## Réparation du Radar & Départ\n\nPendant que le **Dr Senbei Norimaki** répare le Radar grâce au génie de son fils Turbo, le Général Blue tente de voler le véhicule de Gokū et prend des otages. Arale intervient avec sa candeur habituelle et projette le militaire d'élite dans la stratosphère d'un coup de boule dévastateur. Cet arc d'anthologie scelle l'intégration officielle des deux chefs-d'œuvre de Toriyama.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/7", kind: "manga_volume", label: "Manga Dragon Ball — Tome 7, Chapitres 81-83" },
			{ n: 2, url: "/wiki/databooks/4#planche-82", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 19,
		slug: "qg-armee-red-ribbon",
		name: "Quartier Général du Red Ribbon",
		name_ja: "レッドリボン軍本部",
		name_romaji: "Reddo Ribon Gun Honbu",
		realm_type: "Terre",
		planet: "Terre",
		description: "Forteresse militaire ultra-fortifiée nichée au cœur d'une forêt impénétrable. Centre névralgique de l'armée criminelle du Général Red, protégée par des batteries de canons DCA, des dômes blindés et l'état-major suprême.",
		debut_chapter: "Chapitre 93",
		debut_episode: "Épisode 65 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "L'assaut solitaire de Gokū", description: "Gokū attaque seul de front la base suprême sur son Kinto-Un, déjouant missiles, blindés et tourelles de défense." },
			{ title: "Chute de l'empire Red", description: "Le Colonel Black abat le Général Red en découvrant son souhait dérisoire de grandir, avant d'être anéanti par Gokū à bord de son robot armure de combat." }
		]),
		article: `**Le Quartier Général de l'Armée du Red Ribbon** (レッドリボン軍本部, *Reddo Ribon Gun Honbu*) est le complexe militaire le plus lourdement armé de la Terre au moment de la première quête des Dragon Balls.\n\n## Une forteresse imprenable\n\nConstruit au milieu d'une jungle dense et entouré d'enceintes électrifiées, le QG abrite des centaines de milliers de fantassins d'élite, des escadrilles d'hélicoptères de combat et des arsenaux high-tech conçus en partie par le **Dr Gero**. C'est depuis cette tour de commandement que le **Général Red** coordonne ses régiments à travers les continents pour monopoliser les sept boules de cristal.\n\n## La fureur de Gokū\n\nAprès s'être renforcé au sommet de la Tour Karin et avoir triomphé du tueur à gages Tao Paï Paï, Son Gokū fond sur la forteresse pour venger le père d'Upa. Alors que Yamcha, Kamé Sennin et Bulma montent une expédition de secours, Gokū anéantit seul l'armée entière en moins d'une demi-heure, provoquant l'effondrement définitif de l'organisation criminelle.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/8", kind: "manga_volume", label: "Manga Dragon Ball — Tome 8, Chapitres 93-96" },
			{ n: 2, url: "/wiki/databooks/4#planche-80", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 20,
		slug: "muscle-tower",
		name: "Tour du Muscle (Muscle Tower)",
		name_ja: "マッスルタワー",
		name_romaji: "Massuru Tawā",
		realm_type: "Terre",
		planet: "Terre",
		description: "Bastion vertical en acier de six étages dominant les steppes enneigées de Jingle Village au Nord. QG de l'escadron blanc de l'Armée du Red Ribbon commandé par le Général White.",
		debut_chapter: "Chapitre 56",
		debut_episode: "Épisode 35 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Ascension étage par étage", description: "Gokū défait successivement le Sergent Métallique, le Ninja Murasaki et ses quintuplés, puis la bête gélatineuse Buyon." },
			{ title: "Libération de C-8 (Hatchan)", description: "Gokū refuse de détruire le bon cyborg C-8 qui choisit de trahir l'armée pour vivre en paix auprès des villageois." }
		]),
		article: `**La Tour du Muscle** (マッスルタワー, *Massuru Tawā*) est l'avant-poste septentrional de l'Armée du Red Ribbon, érigé au cœur du climat polaire de **Jingle Village**.\n\n## Un donjon vertical mortel\n\nChaque niveau de la tour est conçu comme un piège mortel destiné à écraser tout assaillant:\n- **Étage 1 & 2** : Corps de garde et blindés.\n- **Étage 3** : Le redoutable automate d'assaut **Sergent Métallique** (*Major Metallitron*).\n- **Étage 4** : Jardin intérieur japonais du **Ninja Murasaki** et de ses frères jumeaux.\n- **Étage 5** : Antre secret de la bête vorace **Buyon**, insensible aux coups physiques mais congelée par Gokū ouvrant une brèche dans le mur gelé.\n- **Étage 6** : Salle de commandement du **Général White**, qui retient le maire du village en otage.\n\n## L'éveil de l'humanité de C-8\n\nC'est dans cette forteresse que Gokū fait la rencontre de **C-8** (*Hatchan*), un cyborg au cœur pur conçu par Gero et Flappe. Refusant la violence, C-8 s'allie à Gokū et expédie le Général White dans le décor d'un coup de poing rageur lorsque celui-ci tire lâchement sur Gokū.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/5", kind: "manga_volume", label: "Manga Dragon Ball — Tome 5, Chapitres 56-64" },
			{ n: 2, url: "/wiki/databooks/4#planche-78", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 21,
		slug: "palais-uranai-baba",
		name: "Palais d'Uranai Baba",
		name_ja: "占いババの宮殿",
		name_romaji: "Uranai Baba no Kyūden",
		realm_type: "Terre",
		planet: "Terre",
		description: "Palais mystique dressé au cœur d'un lac désertique, servant de demeure à la voyante Uranai Baba, sœur aînée de Kamé Sennin. Abrite l'arène des Toilettes du Diable suspendue au-dessus d'une eau empoisonnée.",
		debut_chapter: "Chapitre 98",
		debut_episode: "Épisode 69 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Les cinq champions des enfers", description: "Pour obtenir une voyance gratuite sans payer 10 millions de zénis, l'équipe de Gokū affronte Dracula Man, la Momie, Ackman et le guerrier masqué." },
			{ title: "Retrouvailles avec Son Gohan", description: "Le cinquième combattant mystère n'est autre que le grand-père Son Gohan revenu du Royaume des Morts pour un jour grâce à Baba." }
		]),
		article: `**Le Palais d'Uranai Baba** (占いババの宮殿, *Uranai Baba no Kyūden*) est le sanctuaire de divination le plus célèbre du monde des vivants. Situé dans une vallée encaissée entourée de sables brûlants, il offre les services de la sœur de Kamé Sennin, capable de retrouver n'importe quel objet ou personne et de communiquer avec l'Au-delà.\n\n## Les épreuves de l'Arène Diabolique\n\nCeux qui ne peuvent s'acquitter du tarif exorbitant de 10 000 000 de zénis doivent vaincre les cinq guerriers de Baba dans des arènes de plus en plus périlleuses, notamment **« Les Toilettes du Diable »** (*Dai-Akuma no Benjo*), un ring circulaire sans rambarde perché au-dessus d'une cuve d'acide dissolvant.\n\n## L'émotion de Son Gohan\n\nC'est dans cette enceinte sacrée qu'a lieu l'un des combats les plus poignants de la saga : Son Gokū y affronte un guerrier masqué dissimulant sa queue de singe. Après un duel technique serré, le combattant retire son masque pour dévoiler le visage de son défunt grand-père **Son Gohan**, venu tester les progrès martiaux de son petit-fils.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/9", kind: "manga_volume", label: "Manga Dragon Ball — Tome 9, Chapitres 98-108" },
			{ n: 2, url: "/wiki/databooks/4#planche-84", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 22,
		slug: "capitale-de-l-ouest",
		name: "Capitale de l'Ouest (West City)",
		name_ja: "西の都",
		name_romaji: "Nishi no Miyako",
		realm_type: "Terre",
		planet: "Terre",
		description: "Plus grande métropole ultramoderne de la Terre, célèbre pour son architecture en dômes circulaires, ses autoroutes magnétiques et le siège mondial titanesque de la Capsule Corporation.",
		debut_chapter: "Chapitre 67",
		debut_episode: "Épisode 43 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Foyer de la famille Brief", description: "Le Dr Brief y révolutionne la technologie terrestre avec l'invention des capsules Hoi-Poi compressant objets et bâtiments entiers." },
			{ title: "Refuge des guerriers Z", description: "Lieu de reconstruction du vaisseau de Namek, d'entraînement en gravité 100G de Vegeta, et berceau de la machine temporelle de Trunks." }
		]),
		article: `**La Capitale de l'Ouest** (西の都, *Nishi no Miyako*) est le cœur technologique et industriel de la Terre. Contrastant avec le monde rural où a grandi Gokū, cette cité incarne la science-fiction rétro-futuriste chère à Akira Toriyama.\n\n## Le bastion de la Capsule Corporation\n\nAu centre de la cité s'étend le gigantesque domaine de la **Capsule Corporation**, comprenant des laboratoires de recherche de pointe, un immense parc zoologique privé où vivent dinosaures et animaux exotiques, et les appartements de la famille **Brief**. L'invention des **Hoi-Poi Capsules** par le père de Bulma a fait de la famille l'entité la plus riche et influente de la planète.\n\n## Rôle central dans les crises mondiales\n\nLa ville est le point névralgique de toutes les réparations technologiques des Guerriers Z : décryptage du Dragon Radar, réparation du scouter des Saiyans, assemblage du vaisseau spatial à propulsion Namek et conception du premier générateur de gravité artificielle 300G à l'intérieur duquel Vegeta perfectionne son Super Saiyan.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/4#planche-75", kind: "databook", label: "Daizenshuu 4 — World Guide" },
			{ n: 2, url: "/wiki/manga/volume/6", kind: "manga_volume", label: "Manga Dragon Ball — Tome 6, Chapitre 67" }
		]),
		visible: true
	},
	{
		id: 23,
		slug: "king-castle",
		name: "Capitale du Centre (King Castle)",
		name_ja: "キングキャッスル",
		name_romaji: "Kingu Kyassuru",
		realm_type: "Terre",
		planet: "Terre",
		description: "Capitale politique de la Terre et résidence officielle du Roi de la Terre. Théâtre du coup d'État du Roi Démon Piccolo et du combat titanesque où Son Gokū terrasse le tyran en le traversant de part en part.",
		debut_chapter: "Chapitre 148",
		debut_episode: "Épisode 118 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Prise d'otage mondiale", description: "Piccolo Daimaō prend le château royal d'assaut, destitue le Roi chien et annonce par télévision l'abolition des lois et la destruction annuelle d'un des 43 secteurs de la planète." },
			{ title: "Le coup de poing décisif", description: "Gokū propulse tout son corps grâce au recul d'un Kaméhaméha à une main et transperce la poitrine de Piccolo Daimaō d'un coup de poing transperçant." }
		]),
		article: `**Le King Castle** (キングキャッスル, *Kingu Kyassuru*), situé au cœur de la **Capitale du Centre** (*Chūō no Miyako*), est le palais gouvernemental suprême unifiant les 43 secteurs de la Terre sous l'égide du Roi (un monarque canin bienveillant).\n\n## Le siège des Démons\n\nAprès avoir retrouvé sa jeunesse grâce aux Dragon Balls et assassiné Shenron, le **Roi Démon Piccolo** s'empare du palais en balayant la garde royale. Il contraint le Roi à lui céder le pouvoir absolu et instaure un règne de terreur globale, tirant au sort chaque 9 mai une province du globe destinée à être pulvérisée.\n\n## Le triomphe de Son Gokū\n\nAlors que Tenshinhan est sur le point d'être achevé par le démon Tambourine puis par Piccolo lui-même, Son Gokū, revigoré par la Chōseisui bus auprès de Maître Karin, surgit sur les ruines fumantes du King Castle. Au terme d'un duel sans merci où ses membres sont broyés un à un, Gokū rassemble son ultime parcelle d'énergie dans un coup de poing phénoménal qui perfore le torse du démon millénaire, sauvant l'humanité in extremis.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/13", kind: "manga_volume", label: "Manga Dragon Ball — Tome 13, Chapitres 148-161" },
			{ n: 2, url: "/wiki/databooks/4#planche-88", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 24,
		slug: "terre-sacree-karin",
		name: "Terre Sacrée de Karin",
		name_ja: "カリンの聖地",
		name_romaji: "Karin no Seichi",
		realm_type: "Terre",
		planet: "Terre",
		description: "Forêt inviolée et oasis sacrée s'étendant à perte de vue au pied de la Tour Karin. Sanctuaire préservé par la tribu amérindienne du gardien Bora et de son fils Upa.",
		debut_chapter: "Chapitre 84",
		debut_episode: "Épisode 58 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Meurtre de Bora par Tao Paï Paï", description: "Le redoutable tueur à gages transperce Bora de sa propre lance sous les yeux de son fils Upa, poussant Gokū à gravir la Tour pour acquérir la force nécessaire à sa résurrection." },
			{ title: "Résurrection par Shenron", description: "Gokū rassemble les Dragon Balls après la chute du Red Ribbon et réalise le vœu d'Upa en ramenant son père à la vie." }
		]),
		article: `**La Terre Sacrée de Karin** (カリンの聖地, *Karin no Seichi*) est une enclave géographique et spirituelle située au cœur d'une forêt vierge ancestrale. Elle est gardée de génération en génération par des tribus autochtones chargées d'empêcher les indignes de grimper à la colonne sacrée menant aux cieux.\n\n## Le drame fondateur\n\nLorsque le Capitaine Yellow de l'Armée du Red Ribbon tente de s'emparer de la boule de cristal locale, le chef guerrier **Bora** l'extermine d'un seul revers. Le Général Red engage alors le redoutable assassin **Tao Paï Paï**. Ce dernier assassine froidement Bora et laisse Gokū pour mort au pied de la colonne. Cet événement tragique constitue la toute première fois où Son Gokū jure de réunir les boules magiques pour ressusciter une victime innocente.\n\n## Un lieu de paix et de transmission\n\nDes années plus tard, c'est également au pied de cette forêt que les Guerriers Z viennent récupérer les précieux **Senzus** préparés par Maître Karin et Yajirobé avant les grandes batailles contre les Saiyans, les Cyborgs et Majin Boo.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/7", kind: "manga_volume", label: "Manga Dragon Ball — Tome 7, Chapitres 84-87" },
			{ n: 2, url: "/wiki/databooks/4#planche-86", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 25,
		slug: "laboratoire-dr-gero",
		name: "Laboratoire Secret du Dr Gero",
		name_ja: "ドクター・ゲロの研究所",
		name_romaji: "Dokutā Gero no Kenkyūjo",
		realm_type: "Terre",
		planet: "Terre",
		description: "Base souterraine secrète creusée dans la roche d'une crête montagneuse au nord de la Capitale du Nord. Lieu de développement des cyborgs C-16, C-17, C-18, C-19 et de la super-machine organique Cell.",
		debut_chapter: "Chapitre 346",
		debut_episode: "Épisode 130 (DBZ)",
		key_events: JSON.stringify([
			{ title: "Réveil de C-17 et C-18", description: "Gero en fuite active ses créations rebelles qui le décapitent et brisent la capsule de C-16." },
			{ title: "Destruction du sous-sol de Cell", description: "Trunks du futur et Krillin découvrent la matrice souterraine abritant le fœtus de Cell et son super-ordinateur, et les pulvérisent au Kikōha." }
		]),
		article: `**Le Laboratoire du Dr Gero** (ドクター・ゲロの研究所, *Dokutā Gero no Kenkyūjo*) est le repaire ultra-secret où le chef scientifique de l'Armée du Red Ribbon a passé deux décennies entières à concevoir sa vengeance contre Son Gokū.\n\n## Une installation dissimulée\n\nPerché à flanc de falaise dans une chaîne de montagnes désertiques au nord de la Capitale du Nord, ce complexe blindé était protégé par une lourde porte d'acier scellée. À l'intérieur reposaient les capsules cryogéniques des cyborgs ainsi que les données collectées par un robot-espion miniature sur tous les combats de Goku, Piccolo, Vegeta et Freezer.\n\n## La crypte de Cell\n\nSous le laboratoire principal s'étendait un sous-sol hermétique complètement autonome où un super-ordinateur continuait à synthétiser et nourrir les cellules embryonnaires de **Cell**. Bien que C-17 ait détruit le laboratoire de surface, c'est Trunks et Krillin qui exhument cette crypte secrète, récupérant les plans de conception de C-17/C-18 pour Bulma et incinérant le fœtus du présent.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/29", kind: "manga_volume", label: "Manga Dragon Ball — Tome 29, Chapitres 346-350" },
			{ n: 2, url: "/wiki/databooks/4#planche-92", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 26,
		slug: "ginger-town",
		name: "Ginger Town",
		name_ja: "ジンジャータウン",
		name_romaji: "Jinjā Taun",
		realm_type: "Terre",
		planet: "Terre",
		description: "Cité suburbaine paisible de la Terre, théâtre de l'apparition terrifiante de la créature bio-technologique Cell et de la liquidation de ses 15 000 résidents.",
		debut_chapter: "Chapitre 360",
		debut_episode: "Épisode 141 (DBZ)",
		key_events: JSON.stringify([
			{ title: "Disparition des 15 000 habitants", description: "Cell émerge de l'ombre et absorbe la totalité de la population par le dard de sa queue, ne laissant que des vêtements vides dans les rues." },
			{ title: "Le duel Piccolo vs Cell", description: "Piccolo, fraîchement fusionné avec Dieu, tend un piège à Cell en feignant l'impuissance après s'être fait drainer un bras pour obtenir les aveux complets de la créature." }
		]),
		article: `**Ginger Town** (ジンジャータウン, *Jinjā Taun*) est une ville de banlieue moderne située à quelques dizaines de kilomètres de la Capitale de l'Ouest, devenue l'épicentre d'un des passages les plus sombres et angoissants du manga.\n\n## Une ville fantôme en plein jour\n\nAu chapitre 360 (*Le monstre mystérieux de Ginger Town*), les télévisions du monde entier relaient une alerte incompréhensible : les 15 000 habitants de la commune se sont volatilisés en quelques minutes sans aucun bruit d'explosion. En arrivant sur place sous une pluie battante, le Très-Haut Piccolo ne trouve que des rues désertes jonchées d'habits, de montres et de lunettes abandonnés sur les trottoirs.\n\n## Révélation de l'entité suprême\n\nC'est là qu'apparaît pour la première fois **Cell sous sa forme imparfaite**. Utilisant le dard rétractable de sa queue pour siphonner la biomatériaux humaine, il combat Piccolo dans une confrontation mémorable avant de révéler sa provenance temporelle et son objectif suprême : dévorer C-17 et C-18 pour atteindre la perfection absolue.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/30", kind: "manga_volume", label: "Manga Dragon Ball — Tome 30, Chapitres 360-363" },
			{ n: 2, url: "/wiki/databooks/4#planche-94", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 27,
		slug: "arene-cell-game",
		name: "Arène du Cell Game",
		name_ja: "セルゲーム会場",
		name_romaji: "Seru Gēmu Kaijō",
		realm_type: "Terre",
		planet: "Terre",
		description: "Ring de pierre carré taillé à mains nues par la télékinésie de Cell au cœur d'une cuvette rocheuse au nord-ouest de la Capitale du Centre. Scène de l'éveil du Super Saiyan 2 de Gohan et de la fin de Cell.",
		debut_chapter: "Chapitre 388",
		debut_episode: "Épisode 165 (DBZ)",
		key_events: JSON.stringify([
			{ title: "Construction du ring", description: "Cell extrait un monolithe géant de la roche et sculpte un ring d'arts martiaux de style Tenkaichi Budōkai pour son tournoi planétaire." },
			{ title: "Destruction des limites", description: "Excédé par les contraintes d'espace face à Goku, Cell désintègre les piliers et le dallage du ring, abolissant la règle de sortie de ring pour faire du combat un duel à mort sans issue." }
		]),
		article: `**L'Arène du Cell Game** (セルゲーム会場, *Seru Gēmu Kaijō*) est le ring d'arts martiaux monumental bâti par **Cell Parfait** pour mettre en scène l'extermination des défenseurs de la Terre et la destruction programmée du monde.\n\n## Une parodie macabre du Tenkaichi Budōkai\n\nNostalgique des gènes des plus grands maîtres qu'il porte en lui, Cell utilise sa force de frappe et son pouvoir télékinétique pour trancher un bloc de roche pure et ériger une arène carrée de marbre brut flanquée de quatre piliers d'angle. Il y applique initialement les règles sportives terriennes : défaite par KO ou par chute hors des limites.\n\n## Le champ de bataille suprême\n\nAprès l'humiliation de Mr. Satan et le duel magistral opposant Cell à Son Gokū, Cell pulvérise lui-même le ring en un clin d'œil d'une impulsion de ki pour affronter **Son Gohan**. Le plateau désolé devient alors le témoin de l'assassinat de C-16, de l'explosion de colère sacrant Gohan **Super Saiyan 2**, du sacrifice héroïque de Gokū et du colossal **Kaméhaméha Père-Fils** (*Oyako Kamehameha*) qui annihile la régénération nucléaire de Cell.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/33", kind: "manga_volume", label: "Manga Dragon Ball — Tome 33, Chapitres 388-417" },
			{ n: 2, url: "/wiki/databooks/4#planche-96", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 28,
		slug: "nouvelle-planete-namek",
		name: "Nouvelle Planète Namek",
		name_ja: "新ナメック星",
		name_romaji: "Shin Namekku-sei",
		realm_type: "Univers 7",
		planet: "Namek",
		description: "Planète pastorale et verdoyante choisie par le Roi Kaïô pour reloger le peuple Namek après la destruction cataclysmique de leur monde d'origine par Freezer. Patrie des Dragon Balls améliorées de Moori.",
		debut_chapter: "Chapitre 452",
		debut_episode: "Épisode 175 (DBZ)",
		key_events: JSON.stringify([
			{ title: "Intronisation de Dende comme Dieu de la Terre", description: "Gokū s'y téléporte pour recruter un nouveau créateur des Dragon Balls terriennes après la fusion de Kami-sama et Piccolo." },
			{ title: "Attaque de Moro l'astrophage", description: "Dans Dragon Ball Super, Moro prend d'assaut la Nouvelle Namek pour drainer l'énergie de son peuple et reconstituer sa magie millénaire." }
		]),
		article: `**La Nouvelle Planète Namek** (新ナメック星, *Shin Namekku-sei*) est le sanctuaire de substitution colonisé par les survivants de la race Namek après l'explosion de l'ancienne planète sous les coups de Freezer.\n\n## Un nouveau départ paisible\n\nGrâce aux Kaïô qui ont localisé un astre aux conditions atmosphériques et florales identiques (trois soleils, abondance d'arbres Ajissa), les survivants ont pu rebâtir une société agraire pacifique guidée par le nouveau Grand Chef **Moori**. Moori réactive le dragon **Polunga**, améliorant ses règles : il peut désormais ressusciter une multitude de personnes à chaque vœu sans perdre la faculté d'exaucer trois souhaits consécutifs.\n\n## Un monde convoité\n\nLa planète reste le recours providentiel des Guerriers Z pour soigner les plaies de la Terre et ressusciter les victimes de Majin Boo. Dans l'arc du Prisonnier de la Patrouille Galactique (*Dragon Ball Super*), elle devient le premier champ de bataille sanglant où le terrible mage **Moro** massacre les doyens des villages avant d'absorber l'énergie vitale de la planète tout entière.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/38", kind: "manga_volume", label: "Manga Dragon Ball — Tome 38, Chapitre 452" },
			{ n: 2, url: "/wiki/databooks/19#planche-104", kind: "databook", label: "Dragon Ball Chōzenshū 4" }
		]),
		visible: true
	},
	{
		id: 29,
		slug: "planete-sadala",
		name: "Planète Sadala",
		name_ja: "惑星サダラ",
		name_romaji: "Wakusei Sadara",
		realm_type: "Univers 6 / Univers 7",
		planet: "Sadala",
		description: "Berceau originel millénaire de la race guerrière des Saiyans. Autrefois détruite par guerres intestines dans l'Univers 7, elle demeure florissante et civilisée dans l'Univers 6 où les Saiyans agissent en défenseurs de la paix.",
		debut_chapter: "DBS Chapitre 7",
		debut_episode: "Épisode 32 (Dragon Ball Super)",
		key_events: JSON.stringify([
			{ title: "Révélation de Cabba à Vegeta", description: "Lors du tournoi Univers 6 vs Univers 7, Cabba explique à Vegeta que les Saiyans de son univers n'ont jamais perdu leur planète natale et combattent le mal." },
			{ title: "Promesse royale de Vegeta", description: "Vegeta promet à Cabba de venir visiter la Planète Sadala de l'Univers 6 et d'y rencontrer leur Roi." }
		]),
		article: `**La Planète Sadala** (惑星サダラ, *Wakusei Sadara*) est la terre originelle fondamentale de la race des Saiyans dans le multivers de *Dragon Ball*.\n\n## Le destin brisé de l'Univers 7\n\nDans l'Univers 7, Sadala était un monde rude où vivaient les premiers guerriers Saiyans dotés de queue. Cependant, en raison de leur nature belliqueuse incontrôlable et de guerres civiles incessantes, la planète fut complètement anéantie par une explosion interne. Les réfugiés saiyans errèrent dans l'espace avant de conquérir la planète des Tsufuls et de la rebaptiser **Planète Vegeta**.\n\n## La civilisation florissante de l'Univers 6\n\nÀ l'inverse, dans l'Univers 6 (univers jumeau du 7), la Planète Sadala n'a jamais été détruite. Ses habitants n'ont pas développé de queue, ont troqué les armures de conquête pour des tenues traditionnelles légères et ont fondé une société honorable de justiciers galactiques commandée par les forces d'élite de **Cabba**, **Caulifla** et **Kale**. Vegeta s'est juré de fouler un jour le sol de ce monde qui représente ce que son propre peuple aurait pu devenir.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/19#planche-112", kind: "databook", label: "Dragon Ball Chōzenshū 4" },
			{ n: 2, url: "/wiki/manga/volume/150", kind: "manga_volume", label: "Dragon Ball Super — Tome 1, Chapitre 7" }
		]),
		visible: true
	},
	{
		id: 30,
		slug: "planete-vampa",
		name: "Planète Vampa",
		name_ja: "小惑星バンパ",
		name_romaji: "Shouwakusei Banpa",
		realm_type: "Univers 7",
		planet: "Vampa",
		description: "Planète aride et inhospitalière balayée par des tempêtes acides et peuplée de bêtes titanesques. Terre d'exil sauvage où le jeune Broly et son père Paragus ont survécu en reclus pendant plus de quatre décennies.",
		debut_chapter: "DBS Chapitre 42 (Évocation)",
		debut_episode: "Film Dragon Ball Super: Broly",
		key_events: JSON.stringify([
			{ title: "L'exil du prodige", description: "Le Roi Vegeta exile le nourrisson Broly sur cet astre hostile par jalousie envers son potentiel latent anormal dépassant celui du Prince Vegeta." },
			{ title: "L'amitié avec Ba", description: "Broly s'y lie d'amitié avec la bête colossale Ba, dont il porte l'oreille coupée en fourrure verte autour de sa taille en signe de fidélité éternelle." }
		]),
		article: `**La Planète Vampa** (小惑星バンパ, *Shōwakusei Banpa*) est un monde sauvage situé aux confins de la galaxie de l'Univers 7, au climat rude et aux nuits peuplées de monstres gélatineux géants.\n\n## Le sanctuaire forcé de Broly\n\nJaloux de la force de combat hors-norme du fils de **Paragus** qui surpassait celle de son propre héritier au berceau, le **Roi Vegeta** expédie la capsule de Broly sur cet astre inhabité aux conditions de survie quasi nulles. Paragus s'y écrase à son tour pour sauver son fils, mais leur vaisseau de sauvetage est endommagé de façon irréparable, condamnant père et fils à quatre décennies d'isolement brutal.\n\n## Une vie de communion sauvage\n\nC'est sur les plaines acides de Vampa que Broly forge son endurance surhumaine. Il s'y lie d'affection avec **Ba**, un monstre gigantesque dont il esquive les assauts quotidiens comme un jeu. Après le cataclysme de leur affrontement contre Gogeta sur Terre, c'est sur Vampa que Broly, **Chirai** et **Lemo** retournent vivre en paix, recevant régulièrement la visite et les vivres de Son Gokū.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-super-broly", kind: "canon", label: "Film Dragon Ball Super: Broly (2018)" },
			{ n: 2, url: "/wiki/manga/volume/159", kind: "manga_volume", label: "Dragon Ball Super — Tome 9, Chapitre 42" }
		]),
		visible: true
	},
	{
		id: 31,
		slug: "village-jingle",
		name: "Village Jingle",
		name_ja: "ジングル村",
		name_romaji: "Jinguru-mura",
		realm_type: "Terre",
		planet: "Terre",
		description: "Hameau polaire paisible du Nord de la Terre, écrasé sous les neiges éternelles. Foyer de la petite Suno qui sauva Son Gokū de la mort par hypothermie lors de sa campagne contre la Tour du Muscle.",
		debut_chapter: "Chapitre 55",
		debut_episode: "Épisode 34 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "Sauvetage de Son Gokū", description: "Suno trouve Gokū gelé dans la neige et le réchauffe chez ses parents auprès de l'âtre." },
			{ title: "Affranchissement du joug militaire", description: "Gokū libère le maire et les hommes du village retenus en otage dans la Tour du Muscle pour forcer les villageois à chercher les Dragon Balls." }
		]),
		article: `**Le Village Jingle** (ジングル村, *Jinguru-mura*) est une communauté nordique isolée de la Terre, plongée dans un hiver perpétuel où la température descend fréquemment sous les -30°C.\n\n## L'hospitalité au cœur du blizzard\n\nLorsque l'avion de Son Gokū s'écrase dans le blizzard alors qu'il recherche la boule à deux étoiles, le jeune garçon s'effondre inanimé dans la neige. Il est secouru in extremis par **Suno**, une fillette courageuse qui le ramène dans la chaleur du foyer familial. Les habitants expliquent à Gokū que l'armée du ruban rouge a réquisitionné tous les hommes valides pour creuser la glace et découvrir l'orbe magique.\n\n## Un sanctuaire de paix retrouvé\n\nAprès la destruction de la Tour du Muscle par Gokū et C-8, le village retrouve son calme légendaire. Suno et sa famille adoptent officiellement le bon cyborg C-8 (*Hatchan*), qui devient le protecteur bienveillant de la communauté. Des années plus tard, c'est Suno et les villageois de Jingle qui lèvent les premiers les mains vers le ciel pour confier leur énergie au Genkidama final de Gokū contre Majin Boo.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/5", kind: "manga_volume", label: "Manga Dragon Ball — Tome 5, Chapitres 55-65" },
			{ n: 2, url: "/wiki/databooks/4#planche-78", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 32,
		slug: "ile-entrainement-kame",
		name: "Île d'entraînement de Kamé Sennin",
		name_ja: "カメハウスの修行島",
		name_romaji: "Shugyō-jima",
		realm_type: "Terre",
		planet: "Terre",
		description: "Grande île sauvage du Sud où Kamé Sennin déplace Kame House pour soumettre Son Gokū et Krillin aux huit mois d'entraînement surhumains de l'école de la Tortue avant le 21e Tenkaichi Budōkai.",
		debut_chapter: "Chapitre 28",
		debut_episode: "Épisode 15 (Dragon Ball)",
		key_events: JSON.stringify([
			{ title: "La quête de la pierre marquée", description: "Kamé Sennin jette une pierre gravée dans la jungle épaisse; celui qui la rapporte gagne le droit de dîner." },
			{ title: "La livraison du lait et les carapaces de 40 kg", description: "Gokū et Krillin développent une musculature surhumaine en gravissant montagnes et fuyant requins avec des carapaces de tortue de 20kg puis 40kg." }
		]),
		article: `**L'Île d'entraînement** (修行島, *Shugyō-jima*) est une terre vaste et luxuriante du Sud où se déroule le cycle d'apprentissage le plus emblématique de toute l'histoire des arts martiaux de *Dragon Ball*.\n\n## La doctrine fondamentale de l'École de la Tortue\n\nPour préparer ses deux disciples **Son Gokū** et **Krillin**, Kamé Sennin déplace sa maison grâce à une capsule Hoi-Poi sur cette île isolée dotée d'une cascade géante, d'une forêt dense et de falaises abruptes. La devise de son enseignement est révolutionnaire : *« Bien s'entraîner, bien étudier, bien manger et bien se reposer »*.\n\n## Un conditionnement sans combat direct\n\nPendant huit mois intensifs, les deux enfants ne s'affrontent quasiment jamais. Ils développent des réflexes, une endurance et une agilité hors du commun par les travaux quotidiens : livrer du lait à l'aube en gravissant des kilomètres de marches à cloche-pied, labourer des champs immenses à mains nues, esquiver des requins à la nage et fuir des dinosaures affamés avec des carapaces de 20 puis 40 kilos sanglées au dos. En retirant ces poids avant le Tenkaichi Budōkai, les deux jeunes prodiges effectuent des bonds de cinquante mètres, stupéfiant l'ensemble des maîtres du monde.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/3", kind: "manga_volume", label: "Manga Dragon Ball — Tome 3, Chapitres 28-32" },
			{ n: 2, url: "/wiki/databooks/4#planche-77", kind: "databook", label: "Daizenshuu 4 — World Guide" }
		]),
		visible: true
	},
	{
		id: 33,
		slug: "chemin-du-serpent",
		name: "Le Chemin du Serpent",
		name_ja: "蛇の道",
		name_romaji: "Hebi no Michi",
		realm_type: "Royaume des Morts",
		planet: "Autre Monde",
		description: "Route sinueuse suspendue d'un million de kilomètres enjambant les mers de nuages de l'Autre Monde. Seul passage reliant le Palais du Roi Enma à la minuscule planète de Kaïô du Nord.",
		debut_chapter: "Chapitre 205",
		debut_episode: "Épisode 12 (DBZ)",
		key_events: JSON.stringify([
			{ title: "La traversée de Gokū", description: "Après son sacrifice contre Raditz, Gokū parcourt le million de kilomètres en courant et sautant pendant 207 jours pour atteindre Kaïô." },
			{ title: "Le piège de la chute en Enfer", description: "Toute chute hors du chemin condamne le voyageur à plonger dans les abîmes sans fond de l'Enfer dont nul ne s'échappe sans autorisation." }
		]),
		article: `**Le Chemin du Serpent** (蛇の道, *Hebi no Michi*) est une passerelle cyclopéenne sculptée à l'effigie d'un dragon serpentin qui traverse l'immensité de l'Au-delà.\n\n## Une épreuve physique et spirituelle\n\nLongue d'exactement **1 000 000 de kilomètres**, cette route étroite ne comporte aucune rambarde. Sous les volutes de nuages qui la bordent s'ouvre le gouffre béant de l'Enfer. Seuls les héros d'exception autorisés par le **Roi Enma** et ayant conservé leur enveloppe corporelle ont le privilège de s'y aventurer pour solliciter l'enseignement des dieux.\n\n## Le voyage de Son Gokū\n\nAvant Gokū, seul le Roi Enma lui-même avait réussi à franchir la totalité du chemin, exploit accompli il y a plus de 100 millions d'années. Son Gokū entame sa course folle au chapitre 205. Après des mois d'efforts continus, d'endurance absolue et de survie contre l'épuisement, il atteint enfin la queue du serpent et aperçoit la sphère gravitationnelle de Maître Kaïô flottant dans l'éther céleste. À son retour, fort de sa nouvelle vitesse acquise auprès de Kaïô, il effectue le trajet inverse en moins de deux jours pour sauver la Terre des Saiyans.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/18", kind: "manga_volume", label: "Manga Dragon Ball — Tome 18, Chapitres 205-212" },
			{ n: 2, url: "/wiki/databooks/4#planche-62", kind: "databook", label: "Daizenshuu 4 — World Guide (L'Au-Delà)" }
		]),
		visible: true
	},
	{
		id: 34,
		slug: "arene-monde-du-vide",
		name: "Arène du Tournoi du Pouvoir (Monde du Vide)",
		name_ja: "力の大会会場（無の界）",
		name_romaji: "Chikara no Taikai Kaijō (Mu no Kai)",
		realm_type: "Monde du Vide",
		planet: "Monde du Vide",
		description: "Ring gigantesque en forme de toupie flottant au cœur du Monde du Vide, façonné en Kachi Katchin ultra-dense par le Grand Prêtre pour accueillir les 80 combattants du Tournoi du Pouvoir.",
		debut_chapter: "DBS Chapitre 32",
		debut_episode: "Épisode 96 (Dragon Ball Super)",
		key_events: JSON.stringify([
			{ title: "L'assemblage par le Grand Prêtre", description: "Le Grand Prêtre façonne le plateau avec le matériau le plus résistant du cosmos en prévision des déflagrations de dieux." },
			{ title: "Éveil de l'Ultra Instinct", description: "Gokū y brise ses limites face à Jiren sur les décombres de l'arène, éveillant les réflexes divins du Migatte no Gokui." }
		]),
		article: `**L'Arène du Tournoi du Pouvoir** (力の大会会場, *Chikara no Taikai Kaijō*) est le champ de bataille cosmologique érigé au centre du **Monde du Vide** (*Mu no Kai*), un espace infini sans temps, sans espace et dénué de matière.\n\n## Une merveille d'ingénierie divine\n\nConçue sous la supervision directe du **Grand Prêtre** pour divertir les deux rois omnipotents **Zen-ō**, l'arène adopte la forme d'un cadran solaire ou d'une toupie colossale. Elle est bâtie en **Kachi Katchin**, un alliage supérieur au métal le plus dur de l'Univers 7, capable d'encaisser des vagues d'énergie dévastatrices sans se désintégrer instantanément. Le centre est surmonté d'un pilier monumental marquant l'écoulement des 48 minutes du tournoi.\n\n## La bataille pour la survie du multivers\n\nSur ce ring d'exception, 80 guerriers d'élite issus de 8 univers s'affrontent simultanément dans un Battle Royale sans merci où l'effacement de leur univers respectif est en jeu. C'est sur ce socle que Son Gokū atteint l'**Ultra Instinct**, que Vegeta forge l'**Ultra Ego** (dans le manga) / Super Saiyan Blue Évolution, et que l'alliance finale improbable de Goku, Freezer et C-17 triomphe de Jiren.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/153", kind: "manga_volume", label: "Dragon Ball Super — Tome 4, Chapitres 32-42" },
			{ n: 2, url: "/wiki/databooks/19#planche-120", kind: "databook", label: "Dragon Ball Chōzenshū 4" }
		]),
		visible: true
	},
	{
		id: 35,
		slug: "royaume-des-demons",
		name: "Royaume des Ténèbres (Makai)",
		name_ja: "暗黒魔界",
		name_romaji: "Ankoku Makai",
		realm_type: "Royaume Démoniaque",
		planet: "Makai",
		description: "Dimension ténébreuse tapie au pôle inférieur opposé du cosmos de l'univers Dragon Ball. Domaine des sorciers maléfiques, des démons et de leur roi suprême Dabra.",
		debut_chapter: "Chapitre 447",
		debut_episode: "Épisode 220 (DBZ)",
		key_events: JSON.stringify([
			{ title: "Règne de Dabra", description: "Le Roi Dabra régit le monde du Makai d'une main de fer avant d'être asservi par le sortilège d'envoûtement de Babidi." },
			{ title: "Dragon Ball Daima", description: "L'exploration détaillée des trois sous-mondes du Daimakai et de ses habitants constitue le cœur narratif de Dragon Ball Daima." }
		]),
		article: `**Le Royaume des Ténèbres** (暗黒魔界, *Ankoku Makai*), souvent abrégé en **Makai** ou **Daimakai**, est l'antimonde occulte situé à l'extrémité inférieure de la sphère cosmique de Toriyama (*Daizenshuu 4*).\n\n## Cosmologie de l'ombre\n\nComplètement séparé du monde des mortels et du domaine sacré des Kaïô, le Makai échappe à l'autorité des dieux de la création. C'est un univers de brumes empoisonnées et de cités souterraines peuplé de monstres et de magiciens puissants. Son souverain incontesté était **Dabra** (*Dabura*), dont la puissance martiale rivalisait avec celle de Cell Parfait avant qu'il ne succombe au contrôle mental de Babidi.\n\n## Les révélations de Dragon Ball Daima\n\nConçu directement par **Akira Toriyama** pour le 40e anniversaire de l'œuvre, *Dragon Ball Daima* ouvre enfin les portes de ce royaume inexploré. On y découvre une organisation divisée en trois mondes distincts gouvernés par le Roi Gomah et l'instructeur Degesu, régis par les mystérieuses Dragon Balls du Makai créées par les Nameks du monde démoniaque.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/4#planche-60", kind: "databook", label: "Daizenshuu 4 — World Guide (Le Monde Démoniaque)" },
			{ n: 2, url: "/wiki/manga/volume/37", kind: "manga_volume", label: "Manga Dragon Ball — Tome 37, Chapitre 447" }
		]),
		visible: true
	}
];

console.log(`Insertion de ${LOCATIONS.length} sanctuaires & lieux canoniques...`);

for (const loc of LOCATIONS) {
	await sql`
		INSERT INTO bot.db_locations (
			id, slug, name, name_ja, name_romaji, realm_type, planet, description,
			debut_chapter, debut_episode, key_events, article, article_sources, visible
		) VALUES (
			${loc.id}, ${loc.slug}, ${loc.name}, ${loc.name_ja}, ${loc.name_romaji}, ${loc.realm_type}, ${loc.planet}, ${loc.description},
			${loc.debut_chapter}, ${loc.debut_episode}, ${loc.key_events}, ${loc.article}, ${loc.article_sources}, ${loc.visible}
		)
		ON CONFLICT (id) DO UPDATE SET
			slug = EXCLUDED.slug,
			name = EXCLUDED.name,
			name_ja = EXCLUDED.name_ja,
			name_romaji = EXCLUDED.name_romaji,
			realm_type = EXCLUDED.realm_type,
			planet = EXCLUDED.planet,
			description = EXCLUDED.description,
			debut_chapter = EXCLUDED.debut_chapter,
			debut_episode = EXCLUDED.debut_episode,
			key_events = EXCLUDED.key_events,
			article = EXCLUDED.article,
			article_sources = EXCLUDED.article_sources,
			visible = EXCLUDED.visible;
	`;
	console.log(`  ✓ Lieu inséré/mis à jour : ${loc.name} (${loc.name_ja})`);
}

const total = await sql`SELECT COUNT(*) as count FROM bot.db_locations WHERE visible = true;`;
console.log(`\nSuccès : bot.db_locations compte désormais ${total[0].count} lieux visibles.`);

await sql.end();
