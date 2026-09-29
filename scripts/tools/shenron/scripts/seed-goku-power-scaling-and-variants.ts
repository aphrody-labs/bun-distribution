import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(DATABASE_URL);

async function main() {
  console.log("=== PEUPLEMENT EXHAUSTIF POWER SCALING & VARIANTES GOKU ===");

  // ──────────────────────────────────────────────────────────────────────────
  // 1. MISE À JOUR DES SECTIONS PWS (db_wiki_sections) POUR GOKU (entity_id = 1)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("-> Mise à jour des rubriques PWS...");

  const pwsUpdates = [
    {
      key: "force-de-frappe",
      label: "Force de Frappe",
      body: `**Paliers officiels : Planétaire (Base post-Namek) → Multi-Solaire (SSJ3) → Universel / Multiversel (SSJ God / Ultra Instinct)**

- **Époque Dragon Ball classique :** Pulvérisation de rochers et blindages dès l'enfance. À l'âge adulte (23e Tournoi), son Super Kamehameha concentre une énergie de 910 BP, surpassant le seuil nécessaire pour désintégrer la Lune (établi à 139 BP par Jackie Chun).
- **Saga Saiyan à Namek :** Le Kaïoken x4 (32 000 BP) repousse le Canon Garric de Vegeta capable de désintégrer la Terre. Sur Namek, le Super Saiyan (150 000 000 BP) surclasse Freeza 100% dont l'attaque Death Ball avait un rendement destructeur instantané sur le noyau planétaire.
- **Saga Buu :** Le Super Saiyan 3 génère des ondes de choc ressenties jusqu'au Royaume des Morts et rivalise avec Majin Buu dont les explosions de ki rasent des galaxies entières au fil du temps.
- **Ère Divine :** L'affrontement entre Goku Super Saiyan God et Beerus génère des ondes de choc dimensionnelles menaçant de disloquer la totalité du macrocosme de l'Univers 7 (*Dragon Ball Super*, épisode 12 et manga chapitre 4).`
    },
    {
      key: "force-de-soulever",
      label: "Force de Soulever",
      body: `**Relevés canoniques du manga : 40 tonnes (Base dans l'au-delà) → Centaines de milliers de tonnes (Super Saiyan)**

- **Manga Tome 36 (Chapitre 428) :** Dans l'autre monde sous la tutelle de Kaïô du Nord, Goku s'entraîne avec des poids de 2 tonnes attachés à chaque membre (soit 8 tonnes au total) qu'il manie avec aisance en forme de base. Lorsque Kaïô augmente la charge à **10 tonnes par membre (40 tonnes au total)**, Goku est momentanément plaqué au sol avant de s'envoler et d'effectuer des frappes d'entraînement dès qu'il active le **Super Saiyan**.
- **Enfant :** Goku soulève et projette des voitures (tome 1) et de gigantesques blocs rocheux sans l'aide du ki.
- **Physiologie martiale :** Contrairement aux héros occidentaux, la force de levage pure de Dragon Ball est distincte de la puissance destructive délivrée par projection du Ki concentré.`
    },
    {
      key: "portee",
      label: "Portée d'Attaque",
      body: `**Portée : Corps-à-corps martial standard → Interplanétaire (Kamehameha) → Interdimensionnelle (Téléportation & Genkidama)**

- **Attaques de Ki :** Le Kamehameha et le Kikōha parcourent des distances Terre-Lune en quelques secondes (vitesse relativiste du ki). Le Super Genkidama contre Kid Buu rassemble l'énergie vitale depuis l'ensemble de la Terre, de l'au-delà et du royaume des Kaïoshins.
- **Téléportation instantanée (瞬間移動 - Shunkan Idō) :** Goku peut se verrouiller instantanément sur toute signature spirituelle connue, sans restriction de distance spatiale ou dimensionnelle (passage instantané du Royaume des Morts / Nouveau Namek à la Terre).`
    },
    {
      key: "vitesse",
      label: "Vitesse de Combat",
      body: `**Vitesse : Hypersonique (Dragon Ball) → Relativiste (Z) → Massively FTL+ / Instantané (Super & Shunkan Idō)**

- **21e et 22e Tournois :** Vitesse dépassant la persistance rétinienne humaine dès l'enfance (*Zanzōken* / Image rémanente). Au 22e tournoi, Krilin et Jackie Chun exécutent des échanges complexes en une fraction de seconde, invisibles aux spectateurs.
- **Saga Saiyan & Namek :** Goku parcourt la Route du Serpent (1 000 000 km) en quelques heures au retour. Sur Namek, Burter (se proclamant l'homme le plus rapide de l'univers) et Jeice sont incapables de percevoir les déplacements de Goku lorsqu'il esquive leurs assauts combinés.
- **Combat rapproché :** En Super Saiyan, les échanges de coups se produisent à des vitesses supraluminiques perçues uniquement comme des éclairs d'ondes de choc par les guerriers d'élite.
- **Téléportation :** Déplacement rigoureusement instantané (0 seconde) via transition dans la dimension Yardrat.`
    },
    {
      key: "durabilite",
      label: "Durabilité",
      body: `**Résistance : Pare-balles dès l'enfance → Résistance stellaire / cosmique conditionnée par la garde de Ki**

- **Constitution Saiyan native :** Dès le chapitre 1 du manga, une balle de pistolet tirée à bout portant par Bulma ne lui cause qu'une légère douleur sans pénétrer sa peau. Une hache en acier se brise sur son crâne.
- **Garde de Ki active :** La résistance phénoménale des guerriers Z dépend de l'armure de Ki enveloppant leur corps. Lorsque Goku est en garde face à Freeza ou Cell, il encaisse des explosions d'énergie réduisant en miettes des planètes sans subir de dommage critique.
- **Vulnérabilité en cas de relâchement :** Comme le rappelle Whis et le film *La Résurrection de 'F'*, si Goku baisse totalement sa garde et éteint son ki, son corps physique redevient vulnérable aux attaques perçantes ordinaires (rayon laser de Sorbet).`
    },
    {
      key: "vitesse-de-deplacement",
      label: "Vitesse de Déplacement",
      body: `**Déplacement : Kinto'un (Mach 1.5) → Vol supersonique à relativiste → Shunkan Idō (Instantané)**

- **Nuage Magique (Kinto'un) :** Utilisé pendant l'enfance pour parcourir le globe à vitesse subsonique/supersonique.
- **Bukūjutsu (Vol par manipulation du ki) :** Maîtrisé dès le 23e Tenkaichi Budôkai, atteignant des vitesses relativistes dès la saga Saiyan.
- **Déplacement instantané :** Grâce à la téléportation apprise sur la planète Yardrat, Goku annule la distance physique en reliant son esprit à un ki repéré.`
    },
    {
      key: "intelligence",
      label: "Intelligence",
      body: `**Intelligence : Naïf dans la vie civile → Génie tactique absolu et instinct martial prodigieux**

- **Apprentissage instantané :** Capacité mimétique surhumaine. Il reproduit le Kamehameha après l'avoir simplement observé une seule fois chez Tortue Géniale (qui avait mis 50 ans à le créer). Il assimile le Zanzōken, la Danse de l'Air et le Taiyōken d'un simple regard.
- **Vision tactique innovante :** Comprend immédiatement les failles des formes à hypertrophie musculaire (USSJ de Trunks) dans la Salle du Temps et invente le principe du Super Saiyan Pleine Puissance (Grade 4) sans stress physiologique.
- **Adaptation au combat :** Identifie en quelques échanges le saut temporel (Tokitobashi) de Hit au Tournoi Univers 6 et anticipe ses apparitions avec une précision millimétrée.`
    },
    {
      key: "faiblesse",
      label: "Faiblesse",
      body: `**Limites officielles identifiées par l'œuvre :**

1. **Naïveté et excès de confiance martiale :** Son désir inextinguible d'affronter des adversaires à leur plein potentiel le pousse à épargner ses ennemis (Piccolo, Vegeta, Freeza) ou à leur donner des senzus (Cell, Moro), mettant parfois la Terre en péril critique.
2. **Dépendance à la respiration :** Contrairement à Freeza ou Buu, les Saiyans ne peuvent pas survivre dans le vide spatial sans oxygène (manga tome 27 face à Freeza, et rappel de Vegeta dans l'arc Moro).
3. **Relâchement de la garde :** Tendance à baisser sa vigilance une fois le combat estimé terminé, le rendant vulnérable aux attaques surprises à faible énergie.
4. **Contrecoup des formes extrêmes :** Le Kaïoken use les fibres musculaires, le Super Saiyan 3 draine colossalement l'énergie vitale dans un corps mortel, et l'Ultra Instinct non maîtrisé provoque un choc de retour violent sur l'organisme.`
    },
    {
      key: "force",
      label: "Puissance Potentiel",
      body: `**Zenkai infini & Dépassement perpétuel des limites mortelles**

- **Physiologie Saiyan (Zenkai) :** Chaque fois qu'il frôle la mort et guérit, sa force de combat augmente de manière exponentielle (effet déterminant sur Namek où il passe de 90 000 à 3 000 000 BP).
- **Plafond continuellement brisé :** Alors que les Saiyans d'élite considéraient Kakarot comme un guerrier de basse classe voué à stagner, son éthique de travail martial acharnée, son humilité et sa soif d'apprentissage lui ont permis de dépasser les Princes, les Empereurs galactiques et d'atteindre le domaine réservé aux Dieux et aux Anges.`
    }
  ];

  for (const item of pwsUpdates) {
    const res = await sql`
      UPDATE bot.db_wiki_sections
      SET body = ${item.body}, group_label = 'PWS', visible = true
      WHERE entity_type = 'character' AND entity_id = 1 AND key = ${item.key}
      RETURNING id
    `;
    if (res.length === 0) {
      // Si la section n'existait pas sous cette clé, tenter par label ou insérer
      await sql`
        INSERT INTO bot.db_wiki_sections (entity_type, entity_id, key, label, body, group_label, accent, visible, sort_order)
        VALUES ('character', 1, ${item.key}, ${item.label}, ${item.body}, 'PWS', 'orange', true, 50)
      `;
      console.log(`  + Inséré PWS: ${item.key}`);
    } else {
      console.log(`  ✓ Mis à jour PWS: ${item.key} (id: ${res[0].id})`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. MISE À JOUR DES VARIANTES SAGA (db_character_variants) POUR GOKU
  // ──────────────────────────────────────────────────────────────────────────
  console.log("-> Mise à jour des variantes au fil des sagas...");

  const variantUpdates = [
    {
      slug: "goku-pilaf",
      form: "Base / Ōzaru (involontaire)",
      power_level: "10 (Base) → 100 (Ōzaru x10)",
      ki: "10",
      max_ki: "100",
      role: "Jeune ermite du Mont Paozu",
      age: 12,
      summary: "Vivant seul au Mont Paozu avec la Dragon Ball à 4 étoiles de son grand-père Son Gohan, Goku rencontre Bulma et s'embarque dans la quête des Dragon Balls. Face à Pilaf, il se transforme pour la première fois en Ōzaru.",
      highlights: JSON.stringify([
        "Rencontre fondatrice avec Bulma sur la route de montagne",
        "Premier Kamehameha instinctif après l'avoir vu exécuté une fois par Tortue Géniale",
        "Transformation dévastatrice en Grand Singe (Ōzaru) au château de Pilaf"
      ])
    },
    {
      slug: "goku-tournament-21",
      form: "Base / Ōzaru",
      power_level: "124 BP",
      ki: "124",
      max_ki: "124",
      role: "Finaliste du 21e Tenkaichi Budôkai",
      age: 12,
      summary: "Après l'entraînement rigoureux sous la carapace de Tortue Géniale aux côtés de Krilin, Goku participe à son premier championnat et atteint la finale face à Jackie Chun.",
      highlights: JSON.stringify([
        "Entraînement des livraisons de lait et labourage à mains nues",
        "Victoires éclatantes sur Giran et Nam",
        "Finale dantesque contre Jackie Chun se soldant par un double K.O."
      ])
    },
    {
      slug: "goku-red-ribbon",
      form: "Base",
      power_level: "140 → 180 BP",
      ki: "180",
      max_ki: "180",
      role: "Démanteleur solitaire du Red Ribbon",
      age: 12,
      summary: "Parti retrouver la Dragon Ball de son grand-père, Goku affronte la plus grande armée du monde. Il gravit la Tour Karin pour boire l'Eau Sacrée et terrasse le redoutable assassin Tao Pai Pai avant d'anéantir le QG du Red Ribbon.",
      highlights: JSON.stringify([
        "Ascension de la Tour Karin et entraînement d'agilité avec Maître Karin",
        "Victoire écrasante contre Tao Pai Pai au pied de la tour",
        "Destruction solitaire du quartier général de l'armée du Red Ribbon"
      ])
    },
    {
      slug: "goku-uranai-baba",
      form: "Base",
      power_level: "180 BP",
      ki: "180",
      max_ki: "180",
      role: "Champion du tournoi d'Uranai Baba",
      age: 12,
      summary: "Pour obtenir la localisation de la dernière Dragon Ball sans payer la somme colossale exigée par Baba la voyante, Goku et ses amis affrontent ses cinq champions surnaturels. Goku y retrouve l'âme de son grand-père défunt, Son Gohan.",
      highlights: JSON.stringify([
        "Victoire expéditive contre la Momie et le Diable Ackman",
        "Retrouvailles poignantes et combat d'entraînement contre son grand-père Son Gohan masqué",
        "Localisation de la 7e Dragon Ball chez Pilaf pour ressusciter Upa"
      ])
    },
    {
      slug: "goku-tournament-22b",
      form: "Base",
      power_level: "180 BP",
      ki: "180",
      max_ki: "180",
      role: "Finaliste du 22e Tenkaichi Budôkai",
      age: 15,
      summary: "Après trois ans d'entraînement solitaire à travers le monde, Goku revient au tournoi et affronte Tenshinhan, le disciple prodige de l'école de la Grue, dans un duel aérien époustouflant.",
      highlights: JSON.stringify([
        "Maîtrise de la vitesse pure et du Zanzōken multiple",
        "Affrontement idéologique entre l'école de la Tortue et l'école de la Grue",
        "Finale ultra-serrée contre Tenshinhan perdue à cause d'une camionnette hors du ring"
      ])
    },
    {
      slug: "goku-piccolo-daimao",
      form: "Base (Potentiel éveillé par la Chōshinsui)",
      power_level: "180 → 260 BP",
      ki: "260",
      max_ki: "260",
      role: "Sauveur du monde face au Roi Démon",
      age: 15,
      summary: "Bouleversé par l'assassinat de Krilin par Tambourine, Goku traque les démons. Vaincu une première fois par le Roi Démon rajeuni, il survit à l'Eau Divine 超神水 qui libère son potentiel caché et transperce Piccolo Daimaô d'un coup de poing titanesque.",
      highlights: JSON.stringify([
        "Vengeance contre Tambourine pour le meurtre de Krilin",
        "Survie à l'épreuve mortelle du poison de la Chōshinsui au Palais de Karin",
        "Le Poing du Dragon transperçant de part en part le Roi Démon Piccolo"
      ])
    },
    {
      slug: "goku-tournament-23",
      form: "Base",
      power_level: "334 BP (avec poids) → 910 BP (Super Kamehameha)",
      ki: "334",
      max_ki: "910",
      role: "Champion du Monde (Tenkaichi Budôkai)",
      age: 18,
      summary: "Après trois années d'entraînement divin au Palais du Tout-Puissant avec M. Popo et Kami-sama, Goku réapparaît adulte et triomphe de Ma Jr (la réincarnation de Piccolo) lors d'une finale titanesque, devenant enfin Champion du Monde.",
      highlights: JSON.stringify([
        "Entraînement de l'esprit et perception du ki sans les yeux",
        "Fiançailles et mariage avec Chichi sur le ring",
        "Victoire historique contre Ma Jr et refus du trône divin de Dieu"
      ])
    },
    {
      slug: "goku-saiyan",
      form: "Base / Kaïoken (x2, x3, x4)",
      power_level: "416 BP (au repos avec poids) → 924 BP → 8 000+ BP (retour) → 32 000 BP (Kaïoken x4)",
      ki: "8 000",
      max_ki: "32 000",
      role: "Défenseur de la Terre & Guerrier Saiyan",
      age: 23,
      summary: "Après avoir appris ses origines extraterrestres lors de l'arrivée de Raditz et sacrifié sa vie, Goku parcourt les 1 000 000 km de la Route du Serpent pour s'entraîner chez Kaïô du Nord. Il revient sur Terre armé du Kaïoken et du Genkidama pour vaincre Nappa et repousser Vegeta.",
      highlights: JSON.stringify([
        "Sacrifice héroïque pour immobiliser Raditz face au Makankosappo de Piccolo",
        "Entraînement sous gravité x10 chez Kaïô du Nord et apprentissage du Kaïoken",
        "Choc titanesque : Kamehameha x4 contre le Canon Garric de Vegeta"
      ])
    },
    {
      slug: "goku-namek",
      form: "Base / Kaïoken x20 / Super Saiyan (SSJ1)",
      power_level: "90 000 BP (arrivée) → 3 000 000 BP (guérison) → 60 000 000 BP (Kaïoken x20) → 150 000 000 BP (Super Saiyan)",
      ki: "3 000 000",
      max_ki: "150 000 000",
      role: "Le Super Saiyan Légendaire",
      age: 24,
      summary: "Entraîné sous une gravité 100 fois supérieure à celle de la Terre dans son vaisseau, Goku atteint Namek avec une puissance hors norme. Après avoir balayé le Commando Ginyu, il affronte l'Empereur Freeza dans le plus long combat de l'histoire du manga et s'éveille au Super Saiyan suite au meurtre de Krilin.",
      highlights: JSON.stringify([
        "Victoire fulgurante sur Recoom et Burter du Commando Ginyu",
        "Assaut désespéré au Kaïoken x20 et Genkidama planétaire contre Freeza",
        "Éveil mythique du Super Saiyan à 150 millions de BP sur une planète en fusion"
      ])
    },
    {
      slug: "goku-retour-sur-terre",
      form: "Base / Super Saiyan",
      power_level: "Supérieur à Trunks SSJ (post-Yardrat) — Chiffres officiellement clos",
      ki: "Non chiffré (classe planétaire)",
      max_ki: "Incommensurable",
      role: "Maître de la Téléportation",
      age: 26,
      summary: "Après avoir survécu à la destruction de Namek et séjourné sur la planète Yardrat où il apprend la Téléportation instantanée, Goku rentre sur Terre. Il démontre sa supériorité en bloquant l'épée de Trunks d'un seul doigt imprégné de ki.",
      highlights: JSON.stringify([
        "Survie dans l'espace grâce à un pod du Commando Ginyu",
        "Apprentissage de la technique yardrat de déplacement instantané (Shunkan Idō)",
        "Démonstration de maîtrise absolue face à Trunks du Futur"
      ])
    },
    {
      slug: "goku-androids",
      form: "Base / Super Saiyan",
      power_level: "Niveau Super Saiyan avancé (affaibli par le virus cardiaque)",
      ki: "Instable (chute rapide)",
      max_ki: "Niveau planétaire",
      role: "Guerrier frappé par la maladie cardiaque",
      age: 29,
      summary: "Averti trois ans plus tôt par Trunks, Goku s'est entraîné intensivement avec Gohan et Piccolo. Face à C-19, la maladie cardiaque prédite se déclare violemment en plein combat, drainant son énergie jusqu'à l'intervention salvatrice de Vegeta.",
      highlights: JSON.stringify([
        "Trois années d'entraînement intensif avec Piccolo et Gohan",
        "Combat acharné contre C-19 malgré une douleur cardiaque intolérable",
        "Sauvetage par Vegeta Super Saiyan et convalescence sous antidote"
      ])
    },
    {
      slug: "goku-cell",
      form: "Super Saiyan Pleine Puissance (Grade 4 / FPSSJ)",
      power_level: "Maîtrise totale du Super Saiyan sans tension nerveuse ni perte d'endurance",
      ki: "Rivalise avec Perfect Cell",
      max_ki: "Supérieur à tous les Guerriers Z adultes",
      role: "Mentor suprême & Sacrifice du Cell Game",
      age: 29,
      summary: "Dans la Salle de l'Esprit et du Temps, Goku rejette les formes hypertrophiées (USSJ) au profit d'une symbiose totale avec l'état de Super Saiyan au quotidien. Lors du Cell Game, après un combat titanesque contre Cell, il cède sa place à Gohan dont il a perçu le potentiel caché.",
      highlights: JSON.stringify([
        "Création de la doctrine du Super Saiyan Pleine Puissance (état naturel permanent)",
        "Instant Kamehameha dévastateur pulvérisant le haut du corps de Cell",
        "Téléportation sacrificielle avec Cell au Palais de Kaïô pour sauver la Terre"
      ])
    },
    {
      slug: "goku-great-saiyaman",
      form: "Base (Au-delà)",
      power_level: "Entraînement au Paradis / Tournoi de l'Autre Monde",
      ki: "Ki d'un corps spirituel",
      max_ki: "Développement du SSJ2 et SSJ3",
      role: "Légende de l'Au-delà",
      age: 29,
      summary: "Décidant de rester mort pour ne plus attirer de menaces sur la Terre, Goku s'entraîne sans relâche au Paradis pendant sept ans. Il y repousse les limites du Super Saiyan et forge les formes du Super Saiyan 2 et du Super Saiyan 3.",
      highlights: JSON.stringify([
        "Entraînement sans fatigue physique dans le Royaume des Morts",
        "Éveil secret du Super Saiyan 2 et du Super Saiyan 3",
        "Décision de revenir sur Terre pour une seule journée lors du 25e Tournoi"
      ])
    },
    {
      slug: "goku-buu",
      form: "Base / SSJ1 / SSJ2 / SSJ3 / Vegetto (Potara)",
      power_level: "3 000 Kiri (SSJ2) → SSJ3 (x4 de SSJ2) → Vegetto (Multiplication synergique A x B)",
      ki: "3 000 Kiri",
      max_ki: "Multi-galactique / Universel",
      role: "Sauveur de l'Univers & Créateur du Genkidama Suprême",
      age: 29,
      summary: "De retour sur Terre pour 24 heures, Goku se heurte au complot de Babidi. Il déploie la terrifiante puissance du Super Saiyan 3 face à Majin Buu, enseigne la Fusion Métamol aux enfants, fusionne en Vegetto grâce aux boucles Potaras avec Vegeta, et détruit Kid Buu avec le Genkidama de la Terre.",
      highlights: JSON.stringify([
        "Mesure de 3 000 Kiri face à Yakon, dépassant de 10x le seuil de destruction planétaire",
        "Transformation légendaire en Super Saiyan 3 faisant trembler le globe terrestre",
        "Fusion Potara suprême en Vegetto surclassant Buu-Gohan",
        "Super Genkidama universel final anéantissant définitivement Kid Buu"
      ])
    },
    {
      slug: "goku-god",
      form: "Super Saiyan God (SSG) / Ki Divin",
      power_level: "Palier Divin cosmique (ondes de choc menaçant le macrocosme U7)",
      ki: "Ki Divin indétectable pour les mortels",
      max_ki: "Rivalise avec Beerus restreint",
      role: "Pionnier du Ki Divin",
      age: 33,
      summary: "Face à la menace de destruction de la Terre par Beerus, Dieu de la Destruction, Goku réalise le rituel des six Saiyans au cœur pur et accède au Super Saiyan God. Leurs ondes de choc menacent d'annihiler la structure de l'Univers 7.",
      highlights: JSON.stringify([
        "Rituel divin d'élévation avec Gohan, Vegeta, Trunks, Goten et Videl portant Pan",
        "Combat stellaire dans l'espace contre Beerus",
        "Assimilation définitive du pouvoir divin dans son corps de base"
      ])
    },
    {
      slug: "goku-golden-frieza",
      form: "Super Saiyan Blue (SSGSS)",
      power_level: "Super Saiyan combiné au Ki Divin",
      ki: "Ki Divin sous contrôle absolu",
      max_ki: "Surpasse Golden Freeza sur la durée",
      role: "Disciple de Whis & Vengeur de la Terre",
      age: 34,
      summary: "Entraîné sur la planète de Beerus par l'Ange Whis, Goku apprend à maîtriser le ki divin sans fuite d'énergie, donnant naissance au Super Saiyan Blue. Il affronte Freeza ressuscité sous sa nouvelle forme Golden.",
      highlights: JSON.stringify([
        "Entraînement martial angélique aux côtés de Vegeta chez Beerus",
        "Déploiement du Super Saiyan Blue (cheveux azur étincelants)",
        "Victoire contre Golden Freeza en exploitant la consommation d'énergie de sa forme"
      ])
    },
    {
      slug: "goku-tournament-of-power",
      form: "SSJ Blue Kaïoken x20 / Ultra Instinct Signe / Ultra Instinct Maîtrisé",
      power_level: "Domaine des Dieux Suprême — Surpasse les Dieux de la Destruction",
      ki: "Autonomie réflexe absolue (Migatte no Gokui)",
      max_ki: "Transcendance divine",
      role: "Leader de l'Univers 7 au Tournoi du Pouvoir",
      age: 36,
      summary: "Au Tournoi du Pouvoir rassemblant 80 guerriers des 8 univers sous peine d'effacement cosmique, Goku brise sa coquille intérieure face à Jiren et s'éveille à l'Ultra Instinct, l'état suprême où chaque cellule du corps réagit de manière autonome sans passer par la pensée.",
      highlights: JSON.stringify([
        "Brèche des limites par absorption du Genkidama face à Jiren",
        "Kamehameha glissé légendaire surfant sur l'attaque de Kefla",
        "Éveil complet de l'Ultra Instinct aux cheveux argentés dominant Jiren",
        "Attaque combinée historique avec Freeza pour remporter la victoire finale"
      ])
    },
    {
      slug: "goku-daima",
      form: "Base (Mini) / Super Saiyan (Mini) avec Nyoibō",
      power_level: "Régression corporelle magique compensée par le maniement du Bâton Magique",
      ki: "Ki Saiyan intact dans un corps d'enfant",
      max_ki: "Niveau adapté au Royaume des Démons",
      role: "Aventurier du Royaume des Démons (Daima)",
      age: 37,
      summary: "Transformé en enfant suite à un vœu magique de Gomah auprès des Dragon Balls du Royaume des Démons, Goku reprend son fidèle Bâton Magique (Nyoibō) et s'aventure dans le Monde des Démons aux côtés de Shin, Glorio et Panzy pour lever la malédiction.",
      highlights: JSON.stringify([
        "Retour nostalgique au combat au corps-à-corps avec le Bâton Magique (Nyoibō)",
        "Exploration des trois mondes du Royaume Démoniaque",
        "Adaptation martiale immédiate malgré la réduction de taille et d'allonge"
      ])
    }
  ];

  for (const v of variantUpdates) {
    const res = await sql`
      UPDATE bot.db_character_variants
      SET
        form = ${v.form},
        power_level = ${v.power_level},
        ki = ${v.ki},
        max_ki = ${v.max_ki},
        role = ${v.role},
        age = ${v.age},
        summary = ${v.summary},
        highlights = ${v.highlights}::jsonb,
        visible = true
      WHERE character_id = 1 AND slug = ${v.slug}
      RETURNING id
    `;
    if (res.length > 0) {
      console.log(`  ✓ Mis à jour variante ${v.slug} (id: ${res[0].id})`);
    } else {
      console.log(`  ⚠ Variante introuvable par slug: ${v.slug}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. VÉRIFICATION FINALE DES DONNÉES EN BASE
  // ──────────────────────────────────────────────────────────────────────────
  console.log("-> Vérification finale...");
  const updatedPws = await sql`
    SELECT key, label, length(body) as len, left(body, 60) as preview
    FROM bot.db_wiki_sections
    WHERE entity_type = 'character' AND entity_id = 1 AND group_label = 'PWS'
  `;
  console.log("Sections PWS actives pour Goku:", updatedPws.length);
  for (const p of updatedPws) {
    console.log(`   - [${p.key}] ${p.label} (${p.len} car.) : ${p.preview}...`);
  }

  const updatedVariants = await sql`
    SELECT slug, label, form, power_level, role, length(coalesce(summary, '')) as sum_len
    FROM bot.db_character_variants
    WHERE character_id = 1 AND form IS NOT NULL
  `;
  console.log("Variantes renseignées pour Goku:", updatedVariants.length);
  for (const v of updatedVariants) {
    console.log(`   - [${v.slug}] Forme: ${v.form} | Puissance: ${v.power_level} | Rôle: ${v.role}`);
  }

  await sql.end();
  console.log("=== PEUPLEMENT TERMINÉ AVEC SUCCÈS ===");
  process.exit(0);
}

main().catch(err => {
  console.error("ERREUR:", err);
  process.exit(1);
});
