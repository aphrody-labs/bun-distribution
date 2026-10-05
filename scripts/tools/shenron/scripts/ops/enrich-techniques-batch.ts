import { SQL } from 'bun';
import * as fs from 'fs';
import { homedir } from 'node:os';
import * as path from 'path';
import { Database } from "bun:sqlite";

const techniques = [
  {
    ids: [494, 307, 675],
    sources: "Dragon Ball (Manga original), Tomes 17, 34, 40 ; Daizenshuu 7.",
    article: `# Makankōsappō (魔貫光殺砲, Makankōsappō)

## Introduction et Origine
Le **Makankōsappō** (littéralement "Canon Perforant de la Lumière Démoniaque") est l'une des techniques les plus emblématiques et mortelles de Piccolo. Il a développé cette attaque meurtrière pendant les cinq années de paix séparant le 23e Tenkaichi Budōkai de l'arrivée des Saiyans sur Terre, avec pour objectif initial de tuer Son Goku.

## Principe d'Exécution et Caractéristiques
Contrairement au Kamehameha qui est une onde de choc massive, le Makankōsappō est un rayon perforant conçu pour transpercer la matière.
- **Gestuelle** : L'utilisateur place deux doigts (l'index et le majeur) de sa main droite (ou gauche) sur son front pour concentrer son ki à son paroxysme.
- **Couleur et Forme** : Il prend la forme d'un faisceau d'énergie central très fin, généralement jaune ou orange, entouré de spirales d'énergie violettes ou jaunes.
- **Temps de charge** : Le principal défaut de cette technique est le temps extrêmement long requis pour rassembler suffisamment de ki (plusieurs minutes lors de sa première utilisation).

## Utilisations Notables
- **Tome 17, Chapitre 201-204** : Piccolo l'utilise pour la première fois contre Raditz. Après un premier essai raté (Raditz esquive de justesse, perdant son épaulière), Goku parvient à immobiliser son frère en le saisissant par-derrière. Piccolo décoche un second Makankōsappō qui transperce simultanément Raditz et Goku, tuant les deux Saiyans.
- **Tome 34, Chapitre 405** : Cell Parfait (qui possède les cellules de Piccolo) utilise cette technique contre Son Gohan.
- **Tome 40, Chapitre 488** : Majin Buu (après avoir absorbé Piccolo) s'en sert contre Ultimate Gohan.

## Variantes et Contrecoups
Les variantes (ID 307 et 675) incluent des versions exécutées plus rapidement ou tirées à une main sans charge prolongée par la suite. Le contrecoup majeur reste l'immobilisation totale et la vulnérabilité pendant la concentration.

## Daizenshuu 7 - Citation
Selon le *Daizenshuu 7* : *"Une technique inventée par Piccolo. C'est un rayon d'énergie concentré pour percer la cible avec une incroyable force de pénétration. Son point faible est qu'il faut beaucoup de temps pour rassembler le ki nécessaire à son lancement."*
`
  },
  {
    ids: [174, 568, 151],
    sources: "Dragon Ball (Manga original), Tomes 11, 23, 31 ; Daizenshuu 7.",
    article: `# Kikōhō (気功砲, Kikōhō)

## Introduction et Origine
Le **Kikōhō** ("Canon de l'Énergie Vitale") est l'ultime technique secrète de l'École de la Grue (Tsuru Sennin). Il s'agit d'une attaque de destruction massive, d'une puissance infiniment supérieure au Kamehameha, mais avec un coût potentiellement mortel pour son utilisateur. Son praticien le plus célèbre est Tenshinhan.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : L'utilisateur joint ses mains pour former un losange (ou un triangle) avec ses doigts et ses pouces. Il place cette "fenêtre" devant son œil cible, verrouillant son adversaire.
- **Couleur et Forme** : C'est une vague déferlante d'énergie (généralement invisible ou d'un blanc/jaune éclatant) qui prend la forme d'un large bloc rectangulaire ou carré, écrasant tout sous une pression gigantesque.
- **Dangerosité** : Le Kikōhō ne puise pas seulement dans le ki (l'énergie combative), mais consomme directement la force vitale (Yūki) de l'utilisateur. Une utilisation excessive entraîne la mort.

## Utilisations Notables
- **Tome 11, Chapitre 133** : Tenshinhan l'utilise lors de la finale du 22e Tenkaichi Budōkai contre Goku, détruisant entièrement l'arène de combat pour forcer Goku à atterrir hors du ring.
- **Tome 23, Chapitre 274** : Désespéré après la mort de Chaozu face à Nappa, Tenshinhan utilise un Kikōhō chargé à une seule main (Canon Kikōhō), y laissant sa vie, sans réussir à vaincre le Saiyan.
- **Tome 31, Chapitre 373** : Le grand moment de gloire du **Shin Kikōhō** (Nouveau Kikōhō). Tenshinhan retient Cell (2e forme) pendant un temps précieux, enchaînant d'innombrables Shin Kikōhō avec un impact dévastateur, l'empêchant d'absorber C-18.

## Variantes et Évolutions
- **Shin Kikōhō** : Version améliorée par Tenshinhan. Plus puissante, elle permet des tirs répétés (en rafale), repoussant les limites de l'épuisement.
- **Canon Kikōhō (One-handed Kikōhō)** : Variante d'urgence tirée à une main.

## Daizenshuu 7 - Citation
*Daizenshuu 7* précise : *"C'est une technique mortelle qui libère une puissance destructrice sans commune mesure avec le Kamehameha. Mais en contrepartie de cette terrible puissance, la charge sur le corps est extrême et elle raccourcit la vie de l'utilisateur, pouvant même causer sa mort."*
`
  },
  {
    ids: [441],
    sources: "Dragon Ball (Manga original), Tomes 32, 41 ; Daizenshuu 7.",
    article: `# Final Flash (ファイナルフラッシュ, Fainaru Furasshu)

## Introduction et Origine
Le **Final Flash** est l'attaque énergétique suprême développée par Vegeta. Elle représente la quintessence de la fierté du prince des Saiyans. Vegeta a mis au point cette technique dévastatrice lors de son entraînement d'un an dans la Salle de l'Esprit et du Temps (Arc Cell), dans le but de surpasser les Super Saiyans et de terrasser les cyborgs.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : Vegeta écarte les bras à l'horizontale, rassemblant une quantité phénoménale d'énergie dans ses mains, provoquant souvent des éclairs et des tempêtes autour de lui. Il ramène ensuite ses mains tendues devant lui, les poignets joints, pour libérer la vague.
- **Couleur et Forme** : L'attaque prend la forme d'un torrent d'énergie pure et dorée, extrêmement large et brillant. 
- **Puissance pure** : Contrairement à d'autres techniques axées sur la pénétration, le Final Flash est conçu pour l'oblitération absolue, balayant tout sur son passage.

## Utilisations Notables
- **Tome 32, Chapitre 384** : C'est la scène la plus iconique de la technique. Face à Cell Parfait, Vegeta, frustré de ne pas faire le poids en termes de force pure, défie le cyborg de bloquer son attaque de front. L'intensité de la charge est telle qu'elle menace de détruire la Terre. Au dernier moment, Vegeta rétrécit le rayon pour minimiser les dégâts planétaires. Le Final Flash pulvérise tout le côté droit du corps de Cell (bien que celui-ci se régénère grâce aux cellules de Piccolo).

## Contrecoups et Inconvénients
Le Final Flash exige un temps de charge conséquent. En combat singulier, l'adversaire doit soit être immobilisé, soit être provoqué pour encaisser l'attaque (comme l'a fait Cell).

## Daizenshuu 7 - Citation
Le *Daizenshuu 7* le décrit ainsi : *"L'attaque ultime que Vegeta a acquise lors de son entraînement dans la Salle de l'Esprit et du Temps. La puissance du ki concentré en écartant grand les deux bras est d'une force de destruction extraordinaire."*
`
  },
  {
    ids: [262],
    sources: "Dragon Ball (Manga original), Tome 29, Chapitre 344 ; Daizenshuu 7.",
    article: `# Big Bang Attack (ビッグバンアタック, Biggu Ban Atakku)

## Introduction et Origine
Le **Big Bang Attack** est la première attaque signature que Vegeta invente après être devenu un Super Saiyan. Utilisée pour la première fois contre C-19, elle illustre le passage de Vegeta à un niveau de puissance cosmique. C'est une attaque rapide, explosive et d'une efficacité redoutable, typique du pragmatisme brutal du prince.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : Vegeta tend le bras droit droit devant lui, la paume de la main grande ouverte face à son adversaire.
- **Couleur et Forme** : Une sphère d'énergie pure se forme dans le creux de la main (souvent bleutée ou dorée dans l'anime). À l'impact, elle ne transperce pas, mais déclenche une explosion colossale évoquant le "Big Bang" originel, pulvérisant la cible et son environnement.

## Utilisations Notables
- **Tome 29, Chapitre 344** : Après avoir arraché les mains de l'androïde absorbeur d'énergie C-19 pour l'empêcher d'absorber son ki, Vegeta, métamorphosé en Super Saiyan, met fin au combat avec le Big Bang Attack. L'explosion qui s'ensuit rase la montagne et ne laisse que la tête décapitée du cyborg.

## Contrecoups
Contrairement au Final Flash ou au Makankōsappō, le Big Bang Attack ne requiert presque aucun temps de charge et est parfaitement adapté pour une exécution foudroyante en pleine action.

## Daizenshuu 7 - Citation
Dans le *Daizenshuu 7*, on peut lire : *"Technique spéciale inventée par Vegeta. Il concentre son ki dans sa main droite, qu'il projette comme un énorme obus d'énergie causant une explosion gigantesque. C'est une technique puissante qu'il a acquise au moment de devenir Super Saiyan."*
`
  },
  {
    ids: [147],
    sources: "Dragon Ball (Manga original), Tomes 19, 24 ; Daizenshuu 7.",
    article: `# Masenkō (魔閃光, Masenkō)

## Introduction et Origine
Le **Masenkō** ("L'Éclair Démoniaque") est l'attaque énergétique de prédilection du jeune Son Gohan. Inventée soit directement par Piccolo, soit par Gohan sous l'influence de l'entraînement martial de Piccolo ("Ma", démon, en référence à l'école de Piccolo Daimaō), cette technique reflète l'héritage martial du Namek transmis à son protégé.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : L'utilisateur place ses deux mains superposées au-dessus de sa tête, les paumes tournées vers l'avant (similaire au geste de recul de la Morsure du Soleil, mais paumes ouvertes). Le ki s'accumule entre les mains. L'utilisateur abaisse ensuite brusquement ses bras en avant pour projeter le rayon.
- **Couleur et Forme** : Un large faisceau d'énergie, systématiquement d'un jaune éclatant ou orange incandescent.

## Utilisations Notables
- **Tome 19, Chapitre 223** : C'est l'utilisation la plus marquante de la technique. Piccolo vient de sacrifier sa vie pour protéger Gohan du rayon mortel de Nappa. Ivre de chagrin et de colère, Gohan (enfant) utilise toute sa puissance potentielle et hurle "Masenkō !". Bien que Nappa réussisse à dévier l'attaque, celle-ci paralyse momentanément le Saiyan.
- **Tome 24, Chapitre 284** : Gohan l'utilise sur Namek contre Freezer (forme 2) dans un sursaut de rage. Plus tard, Trunks du Futur adulte est également vu utilisant cette technique dans l'arc Cell.

## Daizenshuu 7 - Citation
*Daizenshuu 7* mentionne : *"L'attaque favorite de Son Gohan dans son enfance. Il croise les mains au-dessus de sa tête, rassemble son ki et le projette. Le 'Ma' de son nom provient du fait qu'il s'agit d'une technique de l'école de Piccolo."*
`
  },
  {
    ids: [567],
    sources: "Dragon Ball (Manga original), Tome 15, Chapitre 175 ; Daizenshuu 7.",
    article: `# Sōkidan (繰気弾, Sōkidan)

## Introduction et Origine
Le **Sōkidan** (littéralement "Balle d'Énergie Contrôlée" ou "Boule d'Énergie Manipulée") est la technique secrète suprême développée par Yamcha. Inventée en solitaire lors de ses entraînements intensifs avant le 23e Tenkaichi Budōkai, elle démontre le génie martial subtil de Yamcha, qui, bien que dépassé par Goku ou Piccolo, excelle dans la manipulation précise du ki.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : Yamcha soutient son poignet avec son autre main et génère une sphère d'énergie concentrée dans la paume d'une main.
- **Contrôle et Manipulation** : Contrairement à toutes les attaques directes (Kamehameha, Dodonpa) qui partent en ligne droite et se dispersent, le Sōkidan ne disparaît pas au premier contact. Yamcha contrôle la boule à distance par des mouvements de l'index et du majeur (souvent de l'index et de l'auriculaire dressés de la main directrice).
- **Flexibilité** : La boule est téléguidée. Elle peut frapper l'adversaire de toutes parts, changer de direction instantanément, et rebondir sous le sol pour frapper par surprise depuis les souterrains.

## Utilisations Notables
- **Tome 15, Chapitre 175** : Lors des quarts de finale du 23e Tenkaichi Budōkai contre Shen (qui n'est autre que Kami-sama sous une apparence humaine). Shen esquive l'attaque initiale, pensant que Yamcha a raté sa cible. Yamcha sourit et dirige le Sōkidan par derrière, frappant Shen à plusieurs reprises. Bien que le dieu s'en sorte, il est impressionné par la prouesse technique de Yamcha.

## Daizenshuu 7 - Citation
Le *Daizenshuu 7* décrit la technique ainsi : *"La technique secrète absolue de Yamcha. Il crée une boule d'énergie dans la paume de sa main et la projette. Sa particularité est qu'elle est téléguidée ; elle peut changer de direction librement selon la volonté de Yamcha, pour poursuivre l'adversaire jusqu'au bout."*
`
  },
  {
    ids: [5],
    sources: "Dragon Ball Super (Manga et Anime) ; Daizenshuu / DBS Databooks.",
    article: `# Autonomous Ultra Instinct (Migatte no Gokui) (身勝手の極意)

## Introduction et Origine
Le **Migatte no Gokui** (traduit par "Ultra Instinct" ou "L'éveil de la Quintessence") est l'état et la technique martiale ultime appartenant au royaume des Dieux et plus spécifiquement aux Anges (comme Whis et le Grand Prêtre). C'est un état de conscience et une technique de déplacement extrêmement complexe, difficile à maîtriser même pour les Dieux de la Destruction (comme Beerus).

## Principe d'Exécution et Caractéristiques
- **L'affranchissement de la pensée** : Le fondement de l'Ultra Instinct est de rompre le lien neurologique entre la perception de la menace, la pensée et l'action musculaire. Chaque partie du corps de l'utilisateur "pense" et réagit d'elle-même instantanément.
- **Formes (Goku)** :
  1. **Les Prémices (Sign) / Migatte no Gokui "Kizashi"** : Goku possède une aura thermique argentée/bleutée, ses cheveux restent noirs. Il peut esquiver instinctivement, mais son attaque reste consciente, limitant la puissance de ses coups.
  2. **Forme Complète (Mastered) / Migatte no Gokui** : Les cheveux et sourcils de Goku deviennent d'un argent éclatant. Son corps attaque et défend sans aucune pensée, lui conférant une vitesse divine, des frappes d'une précision microscopique et une aura colossale et sereine.

## Utilisations Notables
- **Arc de la Survie de l'Univers (Tournoi du Pouvoir)** : Lors de son combat contre Jiren (Univers 11). Acculé par sa propre attaque (le Genkidama) dans l'anime, ou par une prise de conscience martiale inspirée par Kamé Sennin dans le manga (Chapitre 39). Goku éveille les Prémices, puis l'Ultra Instinct accompli, atteignant un niveau surpassant brièvement Jiren.
- **Arc Moro et Granola (Manga)** : Goku s'entraîne avec Merus puis Whis pour l'activer à volonté et l'intégrer à ses transformations Super Saiyan de base.

## Contrecoups
Pour les mortels, le maintien de l'Ultra Instinct impose un stress divin sur les cellules. À la fin du Tournoi du Pouvoir, l'utilisation prolongée de la forme complète provoque chez Goku de violentes décharges de ki noir menaçant de détruire son corps de l'intérieur.
`
  },
  {
    ids: [161, 162],
    sources: "Dragon Ball (Manga original), Tomes 19, 20, 26, 27 ; Daizenshuu 7.",
    article: `# Kaiōken (界王拳, Kaiōken)

## Introduction et Origine
Le **Kaiōken** (littéralement le "Poing du Maître du Monde") est une technique inventée par Maître Kaiō du Nord. Étonnamment, Kaiō lui-même n'a jamais pu la maîtriser parfaitement à cause des contrecoups destructeurs qu'elle impose au corps. C'est Son Goku, après sa mort face à Raditz et son entraînement sur la petite planète de Kaiō, qui la perfectionne et l'utilise.

## Principe d'Exécution et Caractéristiques
- **Effet multiplicateur** : Le Kaiōken est une technique d'amplification (et non une transformation). Il multiplie, l'espace d'un instant fugace (un battement de cœur), le ki, la force physique, la vitesse et les sens de l'utilisateur par un multiplicateur défini (x2, x3, x4, x10, x20...).
- **Aura et Couleur** : L'utilisation s'accompagne systématiquement d'un dégagement d'aura explosif d'un rouge écarlate (souvent dégageant une chaleur intense).

## Utilisations Notables
- **Kaiōken x3 et x4 (Tomes 19-20, Arc Saiyan)** : Face à Vegeta, le Kaiōken x2 n'est pas suffisant. Ignorant les avertissements de Kaiō, Goku utilise le Kaiōken x3 pour surpasser le prince Saiyan. Lors de l'affrontement de rayons (Gallic Gun contre Kamehameha), Goku pousse l'amplification au Kaiōken x4 pour repousser Vegeta.
- **Kaiōken x20 (Tomes 26-27, Arc Freezer)** : Face à Freezer à 50% de sa puissance, Goku n'a plus le choix. Il utilise le Kaiōken x20 couplé à un Kamehameha dévastateur. Bien qu'il réussisse à brûler la main de Freezer, l'attaque échoue à vaincre le tyran.

## Contrecoups et Inconvénients
Le Kaiōken exige un contrôle parfait du ki. L'amplification pousse le corps du mortel bien au-delà de ses limites structurelles et biologiques. Une erreur de multiplication ou une surutilisation entraîne la destruction des muscles, des spasmes violents, et peut causer l'autodestruction du corps de l'utilisateur.

## Daizenshuu 7 - Citation
Le *Daizenshuu 7* décrit : *"Technique d'amplification corporelle inventée par Kaiō, et maîtrisée par Goku. En concentrant instantanément toute l'énergie de son corps, il multiplie de manière explosive sa puissance de combat, sa force et sa vitesse. Le revers de la médaille est la charge immense imposée au corps."*
`
  },
  {
    ids: [159, 336],
    sources: "Dragon Ball (Manga original), Tomes 19, 25 ; Daizenshuu 7.",
    article: `# Kienzan (気円斬, Kienzan)

## Introduction et Origine
Le **Kienzan** ("Disque d'Énergie Tranchant") est la technique de signature absolue de Krillin. Il l'a inventée au cours de son entraînement avant l'arrivée de Vegeta et Nappa sur Terre. D'une létalité redoutable, le Kienzan démontre comment un combattant de puissance modérée (comme un Terrien) peut menacer de mort des adversaires infiniment plus puissants grâce à la maîtrise totale de la forme de son ki.

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : L'utilisateur lève le bras, paume ouverte vers le ciel. Il façonne son ki pour lui donner la forme d'un disque plat, rotatif, crépitant, extrêmement fin, ressemblant à une scie circulaire d'énergie dorée.
- **Tranchant absolu** : Contrairement aux attaques explosives, le ki est ici concentré sur la tranche du disque. Ce fil d'énergie pure peut découper presque n'importe quelle matière ou adversaire, peu importe sa résistance physique.

## Utilisations Notables
- **Tome 19, Chapitre 221 (Arc Saiyan)** : Krillin lance le Kienzan sur Nappa. Sous-estimant la technique de ce Terrien faiblard, Nappa s'apprête à l'encaisser de front. Vegeta, réalisant le danger de mort imminent, lui hurle d'esquiver au dernier moment. Le disque tranche proprement un rocher et coupe la joue de Nappa, prouvant qu'il l'aurait décapité.
- **Tome 25, Chapitre 298 (Arc Freezer)** : Krillin utilise le Kienzan pour trancher la queue de Freezer sous sa deuxième forme (qui venait d'empaler de manière horrible).
- **Variante : Super Kienzan (ID 336)** : Création de disques multiples ou d'un Kienzan qui se divise en plusieurs disques autoguidés. Utilisé par Freezer (qui en a copié le principe sous le nom de *Tsuibi Kienzan* ou Kienzan téléguidé) puis retourné contre lui-même par Goku.

## Daizenshuu 7 - Citation
Selon le *Daizenshuu 7* : *"Technique secrète de Krillin. Il transforme le ki en un disque acéré comme une lame de rasoir et le projette. Le disque tournoyant est capable de couper les corps de n'importe quel adversaire, compensant de grandes différences de force."*
`
  },
  {
    ids: [176],
    sources: "Dragon Ball (Manga original), Tomes 11, 25, 31 ; Daizenshuu 7.",
    article: `# Taiyōken (太陽拳, Taiyōken - Morsure du Soleil)

## Introduction et Origine
Le **Taiyōken** ("Poing du Soleil" ou "Morsure du Soleil") est une technique de soutien non létale mais d'une efficacité absolue. Elle a été inventée par Tsuru Sennin (l'École de la Grue) et utilisée pour la première fois par Tenshinhan. Cependant, devant son immense utilité tactique, elle a été copiée et utilisée par quasiment tous les Z Fighters (Son Goku, Krillin) ainsi que par leurs ennemis (Cell).

## Principe d'Exécution et Caractéristiques
- **Gestuelle** : L'utilisateur place ses mains sur son front (doigts écartés ou poings fermés près des tempes), concentrant son ki au niveau du visage.
- **Effet** : En criant "Taiyōken !", il libère instantanément tout ce ki sous la forme d'un flash aveuglant de pure lumière blanche, comparable à une éruption solaire de courte portée.
- **Utilité** : Le flash aveugle instantanément toutes les personnes regardant dans la direction de l'utilisateur, provoquant une douleur oculaire aiguë et annihilant leur vision pendant plusieurs secondes. C'est l'outil parfait pour fuir, se cacher ou préparer une contre-attaque fulgurante (souvent imparable car l'adversaire est désorienté).

## Utilisations Notables
- **Tome 11, Chapitre 124 (22e Tenkaichi Budōkai)** : Tenshinhan l'utilise contre Jackie Chun (Kamé Sennin). Goku la copiera instantanément plus tard dans le tournoi pour vaincre Tenshinhan (qui lui-même utilisera des lunettes de soleil de Maître Roshi pour se protéger).
- **Tome 25, Chapitre 299** : Krillin utilise le Taiyōken face à Dodoria sur Namek, ce qui permet à Gohan, Dende et Krillin de s'enfuir in extremis.
- **Tome 31, Chapitre 367** : Cell (1ère forme) l'utilise pour fuir face à Piccolo, Krillin et Trunks.

## Contrecoups
La technique consomme peu de ki et n'a aucun contrecoup sur le corps, ce qui en fait l'une des techniques les plus spammées et rentables du manga. Elle est contrée si la victime ferme les yeux à temps ou porte des lunettes de soleil épaisses.

## Daizenshuu 7 - Citation
Dans le *Daizenshuu 7* : *"C'est une technique de l'École de la Grue, mais qui a été largement appropriée par d'autres. En concentrant du ki dans tout le corps, particulièrement sur le front, on génère un éclair de lumière intense, aveuglant l'ennemi. Idéal pour créer une faille dans la garde adverse ou pour fuir."*
`
  }
];

async function main() {
  console.log("Démarrage de l'enrichissement des techniques...");
  
  // 1. Mise à jour de PostgreSQL (schéma bot, table db_techniques)
  const envPath = path.join(homedir(), '.shenron-neon.env');
  let connectionString = process.env.DATABASE_URL || '';
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/DATABASE_URL=([^\n]+)/);
    if (match) {
      connectionString = match[1].trim();
    }
  }

  let pgHasError = false;
  if (connectionString) {
    try {
      const client = new SQL(connectionString);
      await client.unsafe(`ALTER TABLE bot.db_techniques ADD COLUMN IF NOT EXISTS article TEXT;`);
      await client.unsafe(`ALTER TABLE bot.db_techniques ADD COLUMN IF NOT EXISTS article_sources TEXT;`);
      await client.unsafe(`ALTER TABLE bot.db_techniques ADD COLUMN IF NOT EXISTS article_updated_at TIMESTAMP;`);
      console.log("Colonnes article ajoutées à PostgreSQL.");

      console.log("Connecté à PostgreSQL.");
      
      for (const tech of techniques) {
        for (const id of tech.ids) {
          try {
            await client.unsafe(`
              UPDATE bot.db_techniques 
              SET article = $1, article_sources = $2, article_updated_at = NOW() 
              WHERE id = $3
            `, [tech.article, tech.sources, id]);
            console.log(`[PG] Technique ID ${id} mise à jour avec succès.`);
          } catch (e) {
            console.error(`[PG] Erreur lors de la mise à jour ID: ${id}`, e);
            pgHasError = true;
          }
        }
      }
      await client.close();
    } catch(e) {
      console.error("Erreur de connexion à PostgreSQL:", e);
      pgHasError = true;
    }
  } else {
    console.warn("Pas de connexion PostgreSQL définie. On ignore PG.");
  }

  // 2. Mise à jour de SQLite (data/test.db)
  const sqliteDbPath = path.join(import.meta.dir, '..', '..', 'data', 'test.db');
  let sqliteHasError = false;
  if (fs.existsSync(sqliteDbPath)) {
    try {
      const db = new Database(sqliteDbPath);
      console.log(`Connecté à SQLite: ${sqliteDbPath}`);
      
      // Ajouter les colonnes si elles manquent (ne plante pas si on attrape l'erreur ou si on vérifie)
      try {
        db.run(`ALTER TABLE db_techniques ADD COLUMN article TEXT;`);
        db.run(`ALTER TABLE db_techniques ADD COLUMN article_sources TEXT;`);
        db.run(`ALTER TABLE db_techniques ADD COLUMN article_updated_at TEXT;`);
        console.log("Colonnes article ajoutées à SQLite db_techniques.");
      } catch  {
        // Les colonnes existent sûrement déjà
      }

      for (const tech of techniques) {
        for (const id of tech.ids) {
          try {
            db.run(`
              UPDATE db_techniques 
              SET article = ?, article_sources = ?, article_updated_at = datetime('now')
              WHERE id = ?
            `, [tech.article, tech.sources, id]);
            console.log(`[SQLite] Technique ID ${id} mise à jour avec succès.`);
          } catch (e) {
            console.error(`[SQLite] Erreur lors de la mise à jour ID: ${id}`, e);
            sqliteHasError = true;
          }
        }
      }
      db.close();
    } catch(e) {
      console.error("Erreur lors du traitement SQLite:", e);
      sqliteHasError = true;
    }
  } else {
    console.warn(`Fichier SQLite introuvable: ${sqliteDbPath}`);
  }

  if (pgHasError || sqliteHasError) {
    process.exit(1);
  } else {
    console.log("Fin avec succès de toutes les mises à jour des techniques.");
  }
}

main().catch(e => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
