import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(DATABASE_URL);

interface PwsPack {
  forceDeFrappe: string;
  forceDeSoulever: string;
  portee: string;
  vitesse: string;
  durabilite: string;
  vitesseDeDeplacement: string;
  intelligence: string;
  faiblesse: string;
  force: string;
}

// Profils Power Scaling détaillés pour les combattants d'élite majeurs
const PROFILES: Record<number, { name: string; pws: PwsPack }> = {
  2: { // Vegeta
    name: "Vegeta",
    pws: {
      forceDeFrappe: `**Paliers officiels : Planétaire (18 000 BP) → Stellaire (SSJ) → Multi-Solaire (Majin SSJ2) → Cosmique Divin (SSB Shinka)**

- **Saga Saiyan :** Son Canon Garric (18 000 BP) génère assez d'énergie cinétique et thermique pour atomiser la Terre dans son intégralité (manga tome 20).
- **Saga Cell :** En tant que Super Vegeta, son Final Flash fendant l'atmosphère terrestre désintègre instantanément la moitié supérieure du corps de Perfect Cell.
- **Saga Buu :** En Majin Vegeta (3 000+ Kiri), son Explosion Finale libère toute l'énergie vitale de son corps en une supernova dorée capable de vaporiser Majin Buu.
- **Ère Super :** En Super Saiyan Blue Shinka, ses coups brisent l'énergie du Hakai de Toppo et dominent un Dieu de la Destruction.`,
      forceDeSoulever: `**Relevés martiaux : Dizaines de tonnes (Salle de gravité x500) → Centaines de milliers de tonnes en Super Saiyan**

- Entraîné dans les salles de gravité de la Capsule Corp jusqu'à 500G, Vegeta supporte des centaines de fois son propre poids corporel en mouvement continu.
- En Super Saiyan, sa force de préhension lui permet de broyer le métal extraterrestre et de projeter des monstres géants par la queue.`,
      portee: `**Portée : Corps-à-corps brutal → Interplanétaire (Canon Garric, Big Bang Attack, Final Flash)**

- Ses attaques phares (Canon Garric, Big Bang Attack, Final Flash) traversent l'orbite planétaire en quelques fractions de seconde.
- Les salves continues de Kikōha de Vegeta couvrent des zones kilométriques entières sous un rideau de feu ininterrompu.`,
      vitesse: `**Vitesse : Relativiste (Saga Saiyan) → Supraluminique FTL+ (SSJ) → Vitesse Divine (SSB)**

- Dès la saga Saiyan, ses déplacements dépassent les capteurs des scouters de première génération.
- Sur Namek, il décapite Guldo avant que celui-ci ne puisse activer son apnée temporelle et surprend Jeice d'une accélération fulgurante.`,
      durabilite: `**Résistance : Encaissement exceptionnel surhumain conditionné par la fierté Saiyan**

- Survit sur Terre à un Kamehameha x4 à bout portant, au Genkidama de Krilin, à une taillade d'épée au dos de Yajirobé et à l'écrasement d'un Ōzaru de 100 tonnes.
- Résistance accrue par l'armure de combat royale en polymères extraterrestres flexibles.`,
      vitesseDeDeplacement: `**Déplacement : Vol Bukūjutsu supersonique à relativiste**

- Maîtrise parfaite du vol par sustentation de ki, effectuant des accélérations instantanées pour briser la distance avec sa cible.`,
      intelligence: `**Intelligence : Tacticien martial d'élite & Finesse stratégique royale**

- Formé depuis l'enfance aux conquêtes planétaires par l'armée de Freeza. Déjoue les plans de Freeza sur Namek en volant les Dragon Balls sous son nez et en exploitant la géographie et les failles de détection du ki.`,
      faiblesse: `**Faiblesses canoniques : Orgueil démesuré (Hubris) & Tendance à sous-estimer la régénération adverse**

- Son orgueil l'a poussé à laisser Cell absorber C-18 et à céder au sortilège de Babidi pour défier Goku, engendrant des périls cosmiques.`,
      force: `**Zenkai et Fierté Royale indomptable**

- Capacité Saiyan à croître après chaque blessure mortelle (Zenkais déterminants sur Namek). Capacité unique à transcender ses limites par pure fierté martiale (Super Saiyan Blue Shinka).`
    }
  },
  3: { // Piccolo
    name: "Piccolo",
    pws: {
      forceDeFrappe: `**Paliers officiels : Destructeur de Lune (408 BP) → Planétaire (1M+ BP Namek) → Multi-Planétaire (Super Namek)**

- **Dragon Ball Z (Saga Saiyan) :** Détruit la Lune d'une simple vague de ki à une main (322 BP) pour interrompre la transformation de Gohan en Grand Singe.
- **Saga Namek (Fusion Nail) :** Surclasse Freeza 2e forme (dépassant 1 000 000 BP).
- **Saga Cell (Fusion Kami) :** Égale C-17 et pulvérise les îles avec sa Grenade Infernale (*Gekiretsu Kōdan*).
- **Super Hero (Orange Piccolo) :** Atteint le domaine des Dieux et rivalise avec Cell Max.`,
      forceDeSoulever: `**Force Namek colossale & Extension corporelle d'élasticité**

- Capacité à allonger ses membres et à multiplier sa taille (forme géante Chōkyoshinjutsu) pour soulever des dizaines de milliers de tonnes.`,
      portee: `**Portée : Extension de membres élastique → Faisceau perforant Makankosappo interplanétaire**

- Le Makankosappo concentre l'énergie en une vrille perforante forant n'importe quelle matière sur des milliers de kilomètres.`,
      vitesse: `**Vitesse : Hypersonique → Relativiste (Zanzōken Namek)**

- Déplacements aériens précis et esquives millimétrées avec retrait de ses vêtements lourds d'entraînement.`,
      durabilite: `**Régénération Namek cellulaire phénoménale**

- Capable de régénérer n'importe quel membre ou partie du corps arraché en quelques secondes tant que son cerveau (noyau vital) demeure intact.`,
      vitesseDeDeplacement: `**Vol Bukūjutsu avancé & Télékinésie**

- Vitesse supersonique et lévitation fluide issue des secrets martiaux du Palais de Kami-sama.`,
      intelligence: `**Le plus grand stratège et cerveau tactique de la Dragon Team**

- Hérite de la sagesse millénaire du Tout-Puissant et de l'expérience guerrière de Nail. Conçoit des pièges de ki imparables (Hellzone Grenade / Encirclement de Ki).`,
      faiblesse: `**Sensibilité auditive extrême & Dépendance au noyau céphalique**

- L'ouïe surdéveloppée des Nameks est vulnérable aux sons stridents et sifflements aigus (point faible révélé dans le film Slug).`,
      force: `**Assimilation et Potentiel Divin Namek**

- Capacité unique d'assimilation Namek permanente et accès au potentiel caché libéré par Shenron (Piccolo Orange).`
    }
  },
  10: { // Gohan
    name: "Gohan",
    pws: {
      forceDeFrappe: `**Paliers : 1 307 BP (Enfant) → Planétaire (Namek) → Solaire (SSJ2 Cell Game) → Universel (Gohan Beast)**

- **Cell Game :** Pulvérise Perfect Cell d'un Père-Fils Kamehameha à pleine puissance d'un seul bras.
- **Saga Buu :** Gohan Ultime domine sans effort Super Buu sans avoir besoin de se transformer.
- **Super Hero :** Gohan Beast transperce le crâne de Cell Max avec un Makankosappo divin titanesque.`,
      forceDeSoulever: `**Force herculéenne libérée par l'adrénaline et la rage**

- Manie l'Épée Z au Royaume des Kaïoshins, une lame mythique qu'aucun Kaïoshin n'avait pu arracher de son socle.`,
      portee: `**Portée : Masenko & Kamehameha à échelle continentale et interplanétaire**`,
      vitesse: `**Vitesse : Réflexes foudroyants surpassant tous les combattants lors des accès de colère**`,
      durabilite: `**Résistance Saiyan hybride renforcée par le ki émotionnel**`,
      vitesseDeDeplacement: `**Vol Bukūjutsu fulgurant**`,
      intelligence: `**Érudit et intellectuel doublé d'un instinct martial dormant surpuissant**`,
      faiblesse: `**Manque d'entraînement continu en temps de paix & Tendance à l'excès de confiance une fois éveillé**`,
      force: `**Le potentiel latent le plus colossal de tout l'univers Dragon Ball (confirmé par Toriyama et Vegeta)**`
    }
  },
  5: { // Freezer
    name: "Freezer",
    pws: {
      forceDeFrappe: `**530 000 BP (1re forme) → 120 000 000 BP (100%) → Universel (Golden / Black)**

- Détruit la planète Vegeta d'une Death Ball produite du bout de l'index sous sa forme la plus faible (530 000 BP).
- Fait exploser la planète Namek en provoquant la fusion de son noyau en 5 minutes.
- Black Freeza élimine Goku UI et Vegeta UE en un seul coup d'une frappe au plexus.`,
      forceDeSoulever: `**Force musculaire prodigieuse & Télékinésie lourde**

- Soulève des montagnes et d'immenses blocs rocheux par pure projection télékinétique sans contact physique.`,
      portee: `**Portée : Death Beam perforant instantané & Death Ball planétaire**`,
      vitesse: `**Vitesse : Relativiste à Supraluminique — Aucun déplacement perceptible pour les guerriers ordinaires**`,
      durabilite: `**Survie biologique légendaire dans le vide spatial et résistance aux mutilations extrêmes**

- Survit coupé en deux et sans énergie à l'explosion thermique totale de la planète Namek.`,
      vitesseDeDeplacement: `**Vol supersonique et propulsion télékinétique**`,
      intelligence: `**Génie tyrannique politique et sadisme psychologique raffiné**`,
      faiblesse: `**Arrogance absolue, terreur de la défaite et consommation d'énergie excessive des formes non rodées**`,
      force: `**Prodige biologique mutant de naissance capable d'atteindre le niveau des Dieux en seulement 4 mois d'entraînement**`
    }
  },
  9: { // Cell
    name: "Cell",
    pws: {
      forceDeFrappe: `**Multi-Planétaire (Imparfait) → Système Solaire (Super Parfait Solar Kamehameha)**

- Annonce officiellement posséder assez de ki condensé pour atomiser l'intégralité du Système Solaire lors du Cell Game (*Manga Tome 35*).`,
      forceDeSoulever: `**Force combinée des cellules de Freeza, Goku et Vegeta**`,
      portee: `**Portée : Kamehameha, Makankosappo et Death Beam interplanétaires**`,
      vitesse: `**Vitesse : Réflexes combinés des plus grands maîtres martiaux de la galaxie**`,
      durabilite: `**Régénération absolue à partir d'un noyau cellulaire unique héritée des Nameks et de Freeza**`,
      vitesseDeDeplacement: `**Vol et Déplacement Instantané assimilé par Zenkai**`,
      intelligence: `**Calculs cybernétiques de l'ordinateur du Dr Gero et ruse psychologique**`,
      faiblesse: `**Complexe de perfection et orgueil Saiyan hérité de Vegeta**`,
      force: `**Zenkai Saiyan illimité combiné à la régénération Namek et à la physiologie de Freeza**`
    }
  },
  32: { // Majin Buu
    name: "Majin Buu",
    pws: {
      forceDeFrappe: `**Galactique (Kid Buu) → Universel (Buuhan) — Énergie magique de destruction pure**

- Détruit des centaines de planètes et de galaxies au cours des ères antérieures.
- Pousse des cris d'énergie déchirant le continuum dimensionnel dans la Salle de l'Esprit et du Temps.`,
      forceDeSoulever: `**Force élastique infinie sans limite mécanique squelettique**`,
      portee: `**Portée : Attaque de l'Extermination Humaine pulvérisant toute la population terrestre depuis le Palais de Kami-sama**`,
      vitesse: `**Vitesse : Déplacements erratiques instantanés et imitation magique immédiate**`,
      durabilite: `**Immortalité corporelle : régénération intégrale à partir de la moindre particule de fumée gazeuse**`,
      vitesseDeDeplacement: `**Vol magique et téléportation instinctive instantanée**`,
      intelligence: `**Imitation martiale immédiate et ruse vorace par absorption**`,
      faiblesse: `**Sensibilité à la magie de scellement et instabilité psychologique enfantine (gros Buu)**`,
      force: `**Endurance infinie sans fatigue, magie d'assimilation et métamorphose en chocolat**`
    }
  },
  208: { // Beerus
    name: "Beerus",
    pws: {
      forceDeFrappe: `**Dieu de la Destruction (Hakaishin) — Capacité d'effacement conceptuel universel (Hakai)**

- Détruit la moitié d'une planète d'une simple tape du doigt sur une table.
- Son combat contre Goku menace d'annihiler la totalité du macrocosme de l'Univers 7.`,
      forceDeSoulever: `**Force divine incalculable**`,
      portee: `**Portée : Macrocosmique à travers l'Univers 7**`,
      vitesse: `**Vitesse : Ultra Instinct incomplet & Réflexes divins de plusieurs centaines de millions de fois la lumière**`,
      durabilite: `**Corps divin insensible aux attaques physiques mortelles conventionnelles**`,
      vitesseDeDeplacement: `**Vol divin à travers les galaxies en quelques minutes**`,
      intelligence: `**Des millions d'années d'expérience de combat et de maîtrise de l'énergie de la destruction**`,
      faiblesse: `**Lien vital avec le Kaïoshin de l'Univers 7 (si le Kaïoshin meurt, Beerus meurt)**`,
      force: `**Énergie du Hakai pure effaçant l'âme et le corps sans laisser de trace**`
    }
  },
  38: { // Jiren
    name: "Jiren",
    pws: {
      forceDeFrappe: `**Surpasse les Dieux de la Destruction de son univers — Force brute absolue sans transformation**

- Bloque le Spirit Bomb (Genkidama) de Goku d'un simple regard saturé d'énergie.
- Ses simples coups de poing projettent des murs d'ondes de choc invisibles pulvérisant l'arène de Kachi Katchin.`,
      forceDeSoulever: `**Force colossale soulevant des blocs d'énergie dense sans effort**`,
      portee: `**Portée : Ondes de choc traversant l'arène du Monde du Néant**`,
      vitesse: `**Vitesse : Dépasse la perception de Goku Blue Kaïoken x20 et Hit**`,
      durabilite: `**Barrière passive d'énergie repoussant les assauts des Guerriers Z sans garde active**`,
      vitesseDeDeplacement: `**Célérité maximale continue**`,
      intelligence: `**Discipline martiale ascétique et concentration mentale impénétrable**`,
      faiblesse: `**Solitude existentielle et traumatisme du passé le rendant réticent à la confiance mutuelle**`,
      force: `**Méditation absolue générant une puissance égale à celle des plus grands Dieux**`
    }
  }
};

async function main() {
  console.log("=== INJECTION EXHAUSTIVE DES SECTIONS PWS SUR TOUS LES PERSONNAGES ===");

  // 1. Injection des profils majeurs explicites
  console.log("-> 1. Injection des profils détaillés majeurs...");
  for (const [charIdStr, profile] of Object.entries(PROFILES)) {
    const charId = Number(charIdStr);
    const pws = profile.pws;

    const sections = [
      { key: "force-de-frappe", label: "Force de Frappe", body: pws.forceDeFrappe },
      { key: "force-de-soulever", label: "Force de Soulever", body: pws.forceDeSoulever },
      { key: "portee", label: "Portée d'Attaque", body: pws.portee },
      { key: "vitesse", label: "Vitesse de Combat", body: pws.vitesse },
      { key: "durabilite", label: "Durabilité", body: pws.durabilite },
      { key: "vitesse-de-deplacement", label: "Vitesse de Déplacement", body: pws.vitesseDeDeplacement },
      { key: "intelligence", label: "Intelligence", body: pws.intelligence },
      { key: "faiblesse", label: "Faiblesse", body: pws.faiblesse },
      { key: "force", label: "Puissance Potentiel", body: pws.force }
    ];

    for (const s of sections) {
      const res = await sql`
        UPDATE bot.db_wiki_sections
        SET body = ${s.body}, group_label = 'PWS', visible = true
        WHERE entity_type = 'character' AND entity_id = ${charId} AND key = ${s.key}
        RETURNING id
      `;
      if (res.length === 0) {
        await sql`
          INSERT INTO bot.db_wiki_sections (entity_type, entity_id, key, label, body, group_label, accent, visible, sort_order)
          VALUES ('character', ${charId}, ${s.key}, ${s.label}, ${s.body}, 'PWS', 'orange', true, 50)
        `;
      }
    }
    console.log(`  ✓ Profil majeur PWS injecté pour ${profile.name} (id: ${charId})`);
  }

  // 2. Peuplement générique intelligent pour tous les autres personnages du wiki
  console.log("-> 2. Peuplement des sections PWS pour les autres personnages...");
  const characters = await sql`
    SELECT id, name, race, description FROM bot.db_characters
    ORDER BY id ASC
  `;

  let genericInserted = 0;
  for (const c of characters) {
    const charId = Number(c.id);
    if (PROFILES[charId] || charId === 1) continue; // Déjà fait pour Goku et les profils majeurs

    // Vérifier si des sections PWS existent déjà avec du contenu
    const existing = await sql`
      SELECT count(*) as count FROM bot.db_wiki_sections
      WHERE entity_type = 'character' AND entity_id = ${charId} AND group_label = 'PWS' AND length(body) > 20
    `;
    if (Number(existing[0].count) >= 9) continue;

    const race = (c.race || "Inconnu").toLowerCase();
    const name = c.name;

    // Déterminer le palier et profil selon la race et description
    let frappe = `Palier martial conforme à l'affiliation et aux capacités de combat observées pour ${name}.`;
    let soulever = `Capacité de levage surhumaine proportionnelle à sa physiologie (${c.race || "Guerrier"}).`;
    let portee = `Combat rapproché martial complété par des projections de ki directionnelles.`;
    let vit = `Vitesse martiale hypersonique adaptée aux standards des arts martiaux terriens et galactiques.`;
    let dur = `Résistance corporelle protégée par la concentration du flux de ki intérieur.`;
    let dep = `Déplacement rapide au sol et vol par sustentation de ki (*Bukūjutsu*).`;
    let intel = `Instinct martial et compréhension tactique développés au fil des confrontations.`;
    let faib = `Sensibilité aux attaques énergétiques massives et limites physiologiques propres à sa constitution.`;
    let pot = `Progression continue par l'entraînement et la confrontation avec des adversaires supérieurs.`;

    if (race.includes("saiyan")) {
      frappe = `Puissance de frappe Saiyan explosive capable de disloquer les structures planétaires sous l'effet du ki concentré.`;
      soulever = `Force physique brute surhumaine décuplée par la physiologie guerrière de la planète Vegeta.`;
      vit = `Vélocité de combat réflexe s'adaptant continuellement au rythme des échanges au corps-à-corps.`;
      dur = `Constitution Saiyan robuste et résistance accrue aux traumatismes physiques graves.`;
      faib = `Vulnérabilité à la queue (si présente non entraînée) et absence de survie dans le vide spatial.`;
      pot = `Mécanisme de Zenkai : élévation prodigieuse de la force de combat après avoir frôlé la mort.`;
    } else if (race.includes("android") || race.includes("cyborg")) {
      frappe = `Impacts cinétiques lourds alimentés par le générateur à énergie infinie ou le réservoir d'absorption cybernétique.`;
      soulever = `Force mécanique cybernétique constante ne subissant aucune fatigue musculaire.`;
      vit = `Réflexes de calculs électroniques instantanés et absence d'émissions de ki détectables par scouter.`;
      dur = `Carapace mécanique et blindage en alliages surpuissants conçus par le Dr Gero.`;
      faib = `Composants électroniques sensibles aux surcharges magnétiques ou aux dispositifs d'arrêt d'urgence.`;
      pot = `Endurance illimitée sans déperdition d'énergie au fil des minutes de combat.`;
    } else if (race.includes("human") || race.includes("terrien")) {
      frappe = `Maîtrise des arts martiaux de l'École de la Tortue ou de la Grue, concentrant le ki vital dans des percussions précises.`;
      soulever = `Sommet athlétique humain conditionné par des années d'entraînement martial intensif.`;
      vit = `Agilité et esquives vives exploitant le Zanzōken et la lecture des mouvements adverses.`;
      dur = `Fragilité biologique humaine compensée par une concentration défensive du ki.`;
      faib = `Limites biologiques humaines strictes face aux entités cosmiques extraterrestres.`;
      pot = `Dévouement admirable et perfectionnement technique continuel.`;
    }

    const sections = [
      { key: "force-de-frappe", label: "Force de Frappe", body: frappe },
      { key: "force-de-soulever", label: "Force de Soulever", body: soulever },
      { key: "portee", label: "Portée d'Attaque", body: portee },
      { key: "vitesse", label: "Vitesse de Combat", body: vit },
      { key: "durabilite", label: "Durabilité", body: dur },
      { key: "vitesse-de-deplacement", label: "Vitesse de Déplacement", body: dep },
      { key: "intelligence", label: "Intelligence", body: intel },
      { key: "faiblesse", label: "Faiblesse", body: faib },
      { key: "force", label: "Puissance Potentiel", body: pot }
    ];

    for (const s of sections) {
      const res = await sql`
        UPDATE bot.db_wiki_sections
        SET body = ${s.body}, group_label = 'PWS', visible = true
        WHERE entity_type = 'character' AND entity_id = ${charId} AND key = ${s.key}
        RETURNING id
      `;
      if (res.length === 0) {
        await sql`
          INSERT INTO bot.db_wiki_sections (entity_type, entity_id, key, label, body, group_label, accent, visible, sort_order)
          VALUES ('character', ${charId}, ${s.key}, ${s.label}, ${s.body}, 'PWS', 'orange', true, 50)
        `;
      }
    }
    genericInserted++;
    if (genericInserted % 50 === 0) {
      console.log(`  ... ${genericInserted} personnages enrichis`);
    }
  }

  console.log(`✓ Remplissage global terminé : ${genericInserted} personnages enrichis de leurs 9 rubriques PWS.`);

  const totalPws = await sql`
    SELECT count(*) as count FROM bot.db_wiki_sections WHERE group_label = 'PWS' AND length(body) > 10
  `;
  console.log("Total des rubriques PWS actives en base :", totalPws[0].count);

  await sql.end();
  process.exit(0);
}

main().catch(err => {
  console.error("ERREUR:", err);
  process.exit(1);
});
