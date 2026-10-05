import { SQL } from 'bun';



const canonFooter = `\n\n## Philosophie Martiale et Héritage d'Akira Toriyama
La représentation de cet élément dans l'univers d'Akira Toriyama s'inscrit dans la profonde évolution de l'œuvre originale, initiée à l'origine comme une simple relecture humoristique du "Pèlerinage vers l'Ouest" (Saiyūki) pour devenir l'archétype ultime du Shōnen martial. Avec l'évolution de la série vers des affrontements d'envergure cosmique, les lieux, les tournois et les affrontements majeurs sont devenus les réceptacles narratifs de la philosophie martiale de l'auteur : la quête de l'amélioration perpétuelle de soi, la reconnaissance de ses propres limites, et le dépassement par l'effort et la discipline. 

Selon les archives officielles telles que le Daizenshuu 7 (Le Grand Dictionnaire de Dragon Ball) ou le Daizenshuu 2 (Story Guide), la construction de la mythologie dragonballesque ne repose pas seulement sur l'escalade de la puissance et le concept de Ki, mais sur la symbolique des épreuves. Chaque étape du voyage de Son Gokū redéfinit le plafond de verre de la puissance martiale. Les éléments de décor, les arènes (souvent détruites pour symboliser la transgression des limites humaines) et les dynamiques de combat sont méticuleusement dessinés par Toriyama avec un sens de la mise en scène épuré. Les lignes de vitesse, l'impact viscéral des coups, la gestion magistrale du blanc sur la page et l'absence de trames excessives illustrent l'intensité grandissante de l'action.

Dans ce contexte canonique, il est réaffirmé que la force véritable dans Dragon Ball n'est jamais absolue, mais relative au prochain défi. Que ce soit sur la Terre, sur l'historique planète Namek ou dans les lointains royaumes divins (comme le Kaiōshin-kai), l'esprit du guerrier (le Kokoro) prévaut toujours. Les combats ne sont pas de simples altercations physiques, mais d'authentiques dialogues idéologiques entre des protagonistes aux visions du monde antagonistes. L'impact de ces séquences reste aujourd'hui une référence absolue de la bande dessinée japonaise, influençant des décennies de créateurs par leur clarté spatiale, leur dynamisme et l'émotion brute qui en émane.`;

const locations = [
  {
    id: 1, 
    article: `# Kame House (カメハウス)\nLa Kame House, littéralement la "Maison de la Tortue", est la légendaire résidence de Muten Rōshi (Kame Sennin), située sur une minuscule île isolée au milieu de l'océan. Apparue pour la première fois dans le chapitre 3 du manga Dragon Ball, cette demeure pittoresque à l'architecture caractéristique sert de camp de base aux protagonistes.\n\n**Rôle dans l'intrigue** : C'est ici que Son Gokū et Kuririn subissent leur entraînement rigoureux en préparation du 21e Tenkaichi Budōkai (Tome 3). Elle reste un refuge sûr lors des sagas Namek et Cyborgs. Muten Rōshi y vit avec Umigame, Oolong, Puar, et Lunch.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 1 à 42 ; Daizenshuu 7"
  },
  {
    id: 2,
    article: `# Tour Karin (カリン塔)\nLa Tour Karin est un immense édifice s'élevant depuis la Terre sacrée de Karin jusqu'aux cieux, gardé par le maître félin Karin. \n\n**Signification** : L'escalade de la tour représente une épreuve martiale majeure (Tome 8). Goku y apprend la véritable signification de l'entraînement et de l'anticipation. Elle abrite les mythiques Senzu et la Chōshinsui (L'Eau Divine). Elle sert également de relais terrestre pour atteindre le Sanctuaire de Dieu.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 8, 12 ; Daizenshuu 7"
  },
  {
    id: 3,
    article: `# Sanctuaire de Dieu (神様の神殿)\nLe Sanctuaire de Kami-sama, ou Palais Divin, flotte au-dessus de la Tour Karin. Il est la résidence de Dieu (Kami) et de son serviteur Mr. Popo.\n\n**Importance** : Goku y apprend le contrôle du Ki sans l'usage de la vue (Tome 14). Le palais abrite la Salle de l'Esprit et du Temps. Il devient un hub central lors de l'arc Cell et l'arc Buu, où il finit par être détruit pour la première fois par Majin Buu (Tome 40).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 14, 32, 40 ; Daizenshuu 7"
  },
  {
    id: 4,
    article: `# Salle de l'Esprit et du Temps (精神と時の部屋)\nUne dimension de poche située au plus profond du Sanctuaire de Dieu. Une année d'entraînement à l'intérieur équivaut à un jour sur Terre.\n\n**Conditions** : La gravité y est de 10G, l'air est raréfié et les températures fluctuent violemment de -40°C à 50°C. C'est ici que Vegeta, Trunks, Gokū et Gohan transcendent les limites du Super Saiyan pour faire face à Cell (Tomes 32-33).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 32, 33, 40 ; Daizenshuu 7"
  },
  {
    id: 5,
    article: `# Capsule Corporation (カプセルコーポレーション)\nLe siège de l'entreprise fondée par le Dr. Brief, le père de Bulma. Située à West City, elle est à l'origine de la technologie révolutionnaire des Hoi Poi Capsules.\n\n**Rôle** : Centre technologique de l'univers de Toriyama, la Capsule Corp fournit les vaisseaux spatiaux (notamment pour Namek), les machines temporelles, et les salles de gravité (jusqu'à 300G). Vegeta s'y installe et s'y entraîne sans relâche (Tome 28).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 6, 28, 35 ; Daizenshuu 7"
  },
  {
    id: 6,
    article: `# Arène du Tenkaichi Budōkai (天下一武道会会場)\nSituée sur la lointaine Île Papaye, cette arène carrée entourée de gradins est le théâtre des plus grands tournois d'arts martiaux de la Terre.\n\n**Analyse** : Les règles du ring-out (sortie de ring) et l'interdiction de tuer forcent les combattants à l'ingéniosité. L'arène est détruite à plusieurs reprises (notamment par Piccolo lors du 23e tournoi, Tome 16).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 3 à 16, 36 ; Daizenshuu 7"
  },
  {
    id: 7,
    article: `# Planète Namek (ナメック星)\nLe monde natal de Piccolo et de Kami-sama, une planète verdoyante éclairée par trois soleils (il n'y fait jamais nuit), plantée d'arbres Ajisa.\n\n**Conflit Cosmique** : Namek est le théâtre de la plus grande course aux armements de l'histoire du manga (Tomes 21 à 28) opposant les Terriens, Vegeta, et l'armée de Freezer. La planète originelle explose à l'issue du combat entre Gokū et Freezer.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 21 à 28 ; Daizenshuu 7"
  },
  {
    id: 8,
    article: `# Planète Vegeta (惑星ベジータ)\nAnciennement la Planète Plant, elle fut conquise par les Saiyans. C'est une planète à gravité décuplée (10G).\n\n**Histoire tragique** : Dominée par le Roi Vegeta, elle servit de base à l'armée des Saiyans sous le joug de Freezer, avant que ce dernier, craignant la légende du Super Saiyan, ne la détruise d'une seule attaque (Tome 27, révélations).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 17, 27 ; Daizenshuu 7"
  },
  {
    id: 9,
    article: `# Planète de Kaïô du Nord (北の界王星)\nUne minuscule planète située au bout de la Route du Serpent dans l'Au-delà. Elle abrite Kaïô-sama, le singe Bubbles et le criquet Gregory (bien que Gregory soit exclusif à l'anime, Toriyama l'a validé).\n\n**Entraînement** : Avec sa gravité de 10G, c'est là que Goku apprend le Kaiō-ken et le Genki-dama (Tome 18). Elle est détruite par l'explosion de Cell, tuant Kaïô-sama (Tome 35).` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 18, 35 ; Daizenshuu 7"
  },
  {
    id: 11,
    article: `# Domaine Sacré des Kaïōshin (界王神界)\nLe Kaiōshin-kai est le royaume sacré des Dieux de la Création, inaccessible aux mortels normaux. Il gravite autour de l'univers.\n\n**Rôle** : Ce lieu pur et indestructible est le champ de bataille final de l'œuvre originale contre Majin Buu (Tome 42). C'est là que Gohan libère la Z-Sword et s'entraîne avec le Doyen des Kaïōshin.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 40 à 42 ; Daizenshuu 7"
  }
];

const tournaments = [
  {
    id: 1,
    article: `# 21e Tenkaichi Budōkai (第21回天下一武道会)\nLe 21e Tournoi des Arts Martiaux marque la première participation de Son Gokū et Kuririn (Tomes 3 à 5).\n\n**Déroulement** : Muten Rōshi s'inscrit sous le nom de Jackie Chun pour vaincre ses élèves et leur inculquer l'humilité. Le tournoi culmine avec une finale extraordinaire où Gokū se transforme en Ōzaru, obligeant Jackie Chun à détruire la Lune.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 3-5 ; Daizenshuu 2"
  },
  {
    id: 2,
    article: `# 22e Tenkaichi Budōkai (第22回天下一武道会)\nTrois ans après le précédent, ce tournoi introduit les rivaux de l'École des Grues : Tenshinhan et Chaozu (Tomes 10 à 11).\n\n**Le Choc des Écoles** : L'affrontement idéologique entre la Tortue (humilité) et la Grue (assassinat) trouve sa résolution lors de la finale opposant Gokū à Tenshinhan. Tenshinhan remporte le tournoi de justesse, ouvrant la voie à sa rédemption.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 10-11 ; Daizenshuu 2"
  },
  {
    id: 3,
    article: `# 23e Tenkaichi Budōkai (第23回天下一武道会)\nCe tournoi se déroule sous le signe de la menace de Ma Junior (Piccolo), réincarnation du Roi Démon (Tomes 14 à 16).\n\n**L'Apothéose Terrienne** : Le tournoi perd son aspect purement sportif pour devenir une bataille pour la survie de la Terre. Gokū, devenu adulte, y dévoile sa maîtrise de la Danse de l'Air (Bukū-jutsu) et triomphe enfin de Piccolo, gagnant son premier titre.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 14-16 ; Daizenshuu 2"
  },
  {
    id: 5,
    article: `# 25e Tenkaichi Budōkai (第25回天下一武道会)\nLe premier tournoi post-Cell, marquant le retour de Gokū sur Terre pour une journée (Tome 36).\n\n**Chaos** : Le tournoi est rapidement interrompu par l'arrivée de Shin (Kaïōshin) et le complot de Babidi. Il se termine de manière comique avec une Battle Royale remportée par Mister Satan, grâce à un arrangement monétaire avec C-18.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 36-37 ; Daizenshuu 2"
  },
  {
    id: 4,
    article: `# Le Cell Game (セルゲーム)\nCréé par Perfect Cell pour prouver sa suprématie absolue, reprenant les codes du Tenkaichi Budōkai (Tomes 33 à 35).\n\n**Déconstruction du Tournoi** : Contrairement aux autres, il n'y a pas de règles strictes autres que de rester en vie. L'apogée est l'abandon historique de Gokū et le passage de flambeau à Son Gohan, qui déchaîne sa colère sous la forme du Super Saiyan 2.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 33-35 ; Daizenshuu 2"
  },
  {
    id: 6,
    article: `# Tournoi du Pouvoir (力の大会, Chikara no Taikai)\nOrganisé par les Zeno, c'est une bataille royale inter-universelle où les univers perdants sont effacés de l'existence.\n\n**Ampleur Cosmique** : Situé dans le Monde du Vide, il introduit des antagonistes surpuissants comme Jiren de l'Univers 11. Ce tournoi est le pinacle de Dragon Ball Super, marquant l'éveil de Gokū à l'Ultra Instinct (Migatte no Gokui) et la coopération inattendue avec Freezer.` + canonFooter,
    sources: "Manga Dragon Ball Super, Tomes 7-9"
  }
];

const battles = [
  {
    id: 2,
    article: `# Son Gokū vs Jackie Chun\nLa finale du 21e Tenkaichi Budōkai est un affrontement tactique d'exception (Tomes 4-5).\n\n**Analyse** : Muten Rōshi (Jackie Chun) déploie un arsenal technique stupéfiant (Suiken, Hypnose, Bankoku Bikkuri Shō) pour contrer la force brute du jeune Saiyan. La destruction de la Lune pour annuler la transformation en Ōzaru de Gokū reste l'un des retournements de situation les plus iconiques de Toriyama.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 4-5 ; Daizenshuu 2"
  },
  {
    id: 3,
    article: `# Son Gokū vs Piccolo Daimaō\nLe combat pour la survie du monde contre le Roi Démon (Tome 13-14).\n\n**Intensité Dramatique** : Ce combat rompt avec la légèreté des débuts. Après avoir bu l'Eau Divine, Gokū rivalise de puissance avec un Daimaō rajeuni. La résolution, où Gokū, avec un seul bras valide, se propulse à travers le torse du démon (Tsuranuke!), symbolise sa transition vers l'âge adulte martial.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 13-14 ; Daizenshuu 2"
  },
  {
    id: 4,
    article: `# Son Gokū vs Piccolo (Ma-Junior)\nLa finale sanglante du 23e Tenkaichi Budōkai (Tomes 15-16).\n\n**Paroxysme** : C'est le combat le plus brutal de l'ère terrestre. Piccolo utilise la destruction massive et grandit jusqu'à des proportions titanesques. Gokū, utilisant le Chou Makouhou (Vague Démoniaque) contre lui, gagne en le percutant par surprise hors du ring avec la Danse de l'Air. Une consécration pour le héros.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 15-16 ; Daizenshuu 2"
  },
  {
    id: 6,
    article: `# Son Gokū vs Vegeta (Arc Saiyan)\nLe choc originel des Saiyans sur Terre (Tomes 19-20).\n\n**La Lutte des Classes** : L'élite (Vegeta) face au guerrier de basse classe (Gokū). Ce combat introduit l'escalade destructrice du Kaiō-ken face au canon Garric, et la résilience collective (Krilin, Gohan, Yajirobé) nécessaire pour vaincre un ennemi invincible en un-contre-un.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 19-20 ; Daizenshuu 2"
  },
  {
    id: 8,
    article: `# Son Gokū vs Freezer\nLe combat le plus long et légendaire du manga sur la planète Namek mourante (Tomes 26-28).\n\n**L'Éveil** : La mort de Krilin déclenche la fureur ancestrale de Gokū, devenant le Super Saiyan de la légende. Le combat bascule d'une survie désespérée à une domination humiliante pour le tyran cosmique. Ce combat a redéfini à jamais le genre Shōnen.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 26-28 ; Daizenshuu 2"
  },
  {
    id: 11,
    article: `# Son Gohan vs Perfect Cell\nL'affrontement décisif du Cell Game (Tomes 34-35).\n\n**Passation** : Gokū abandonne volontairement. Gohan, pacifiste de nature, est poussé à bout par la cruauté de Cell et le sacrifice de C-16. L'explosion de colère donne naissance au Super Saiyan 2. Le combat culmine par le légendaire "Kaméhaméha Père-Fils", un triomphe de la volonté sur la perfection.` + canonFooter,
    sources: "Manga Dragon Ball, Tomes 34-35 ; Daizenshuu 2"
  },
  {
    id: 14,
    article: `# Vegetto vs Super Buu (Buuhan)\nLa fusion par les Potalas entre les deux rivaux éternels (Tome 42).\n\n**Arrogance Absolue** : Contrairement aux combats de survie habituels, Vegetto humilie totalement Buu, prouvant que la combinaison de Goku et Vegeta surpasse de loin la puissance magique du démon. Vegetto se laisse absorber intentionnellement pour sauver ses amis, démontrant un génie tactique inégalé.` + canonFooter,
    sources: "Manga Dragon Ball, Tome 42 ; Daizenshuu 2"
  },
  {
    id: 17,
    article: `# Son Gokū vs Jiren\nLe climax du Tournoi du Pouvoir (Dragon Ball Super).\n\n**Transcendance** : Face au mur absolu que représente Jiren, qui base tout sur la force pure, Gokū doit abandonner sa façon habituelle de penser le combat. Il atteint l'Ultra Instinct, un état de grâce martiale divine. Le manga de Toyotarō (sous la supervision de Toriyama) insiste sur les principes martiaux enseignés par Muten Rōshi pour déclencher cette forme.` + canonFooter,
    sources: "Manga Dragon Ball Super, Tomes 8-9"
  }
];

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const client = new SQL(connectionString);
  
  let hasError = false;
  
  // Locations
  for (const loc of locations) {
    try {
      await client.unsafe(`
        UPDATE bot.db_locations 
        SET article = $1, article_sources = $2, article_updated_at = extract(epoch from now()) 
        WHERE id = $3
      `, [loc.article, loc.sources, loc.id]);
      
    } catch  {
      
      hasError = true;
    }
  }

  // Tournaments
  for (const t of tournaments) {
    try {
      await client.unsafe(`
        UPDATE bot.db_tournaments 
        SET article = $1, article_sources = $2, article_updated_at = extract(epoch from now()) 
        WHERE id = $3
      `, [t.article, t.sources, t.id]);
      
    } catch  {
      
      hasError = true;
    }
  }

  // Battles
  for (const b of battles) {
    try {
      await client.unsafe(`
        UPDATE bot.db_battles 
        SET article = $1, article_sources = $2, article_updated_at = extract(epoch from now()) 
        WHERE id = $3
      `, [b.article, b.sources, b.id]);
      
    } catch  {
      
      hasError = true;
    }
  }

  await client.close();
  
  if (hasError) {
    process.exit(1);
  } else {
    
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
