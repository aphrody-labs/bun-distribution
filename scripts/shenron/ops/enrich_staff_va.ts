import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  console.log("Enriching contributors...");
  const contributors = [
    {
      slug: 'daisuke-nishio',
      name: 'Daisuke Nishio',
      name_ja: '西尾 大介',
      name_romaji: 'Nishio Daisuke',
      category: 'animation',
      birth_date: '1959-04-01',
      biography_fr: 'Réalisateur en chef historique des séries animées Dragon Ball et Dragon Ball Z (épisodes 1 à 199) ainsi que de 5 films cultes (Garlic, Willow, Slug, Cooler, Métal Cooler). Architecte du rythme et du dynamisme de l\'adaptation animée Toei.',
      spotlight_rank: 2,
      visible: true
    },
    {
      slug: 'shigeyasu-yamauchi',
      name: 'Shigeyasu Yamauchi',
      name_ja: '山内 重保',
      name_romaji: 'Yamauchi Shigeyasu',
      category: 'animation',
      birth_date: '1954-04-10',
      biography_fr: 'Réalisateur Toei Animation visionnaire, réputé pour sa mise en scène lyrique, sombre et stylisée. Réalisateur des films légendaires Broly le super guerrier (1993), Les Mercenaires de l\'espace (Bojack, 1993) et Fusions (Janemba, 1995).',
      spotlight_rank: 2,
      visible: true
    },
    {
      slug: 'masaki-sato',
      name: 'Masaki Sato',
      name_ja: '佐藤 正樹',
      name_romaji: 'Satō Masaki',
      category: 'animation',
      birth_date: '1962-02-14',
      biography_fr: 'Animateur clé et superviseur d\'animation légendaire chez Toei Animation. Connu pour ses séquences d\'action d\'une rare vélocité : combats Goku vs Vegeta, Trunks vs Mecha Freezer et l\'affrontement contre C-19.',
      spotlight_rank: 3,
      visible: true
    }
  ];

  for (const c of contributors) {
    const existing = await sql`SELECT id FROM bot.contributors WHERE slug = ${c.slug}`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO bot.contributors (slug, name, name_ja, name_romaji, category, birth_date, biography_fr, spotlight_rank, visible)
        VALUES (${c.slug}, ${c.name}, ${c.name_ja}, ${c.name_romaji}, ${c.category}, ${c.birth_date}, ${c.biography_fr}, ${c.spotlight_rank}, ${c.visible})
      `;
      console.log(`Inserted contributor ${c.name}`);
    } else {
      await sql`
        UPDATE bot.contributors SET
          name = ${c.name},
          name_ja = ${c.name_ja},
          name_romaji = ${c.name_romaji},
          category = ${c.category},
          birth_date = ${c.birth_date},
          biography_fr = ${c.biography_fr},
          visible = ${c.visible}
        WHERE slug = ${c.slug}
      `;
      console.log(`Updated contributor ${c.name}`);
    }
  }

  console.log("Enriching voice actors...");
  const voiceActors = [
    {
      slug: 'sean-schemmel',
      name: 'Sean Schemmel',
      name_ja: 'ショーン・シェメル',
      nationality: 'en',
      birth_date: '1968-11-21',
      roles: JSON.stringify([
        { characterName: 'Son Goku', series: 'DBZ, DBGT, DBS, Films', notes: 'Voix américaine officielle de Goku adulte depuis 1999.' },
        { characterName: 'King Kai', series: 'DBZ, DBS', notes: 'Voix américaine de Kaio du Nord.' }
      ]),
      biography: 'Voix américaine emblématique de Son Goku chez Funimation / Crunchyroll depuis 1999. Réputé pour ses cris de transformation surhumains, notamment lors du passage en Super Saiyan 3 dans DBZ.',
      visible: true
    },
    {
      slug: 'christopher-sabat',
      name: 'Christopher Sabat',
      name_ja: 'クリストファー・サバト',
      nationality: 'en',
      birth_date: '1973-04-22',
      roles: JSON.stringify([
        { characterName: 'Vegeta', series: 'DBZ, DBGT, DBS, Films', notes: 'Voix américaine culte du Prince des Saiyans.' },
        { characterName: 'Piccolo', series: 'DBZ, DBGT, DBS, Films', notes: 'Voix américaine emblématique de Piccolo.' },
        { characterName: 'Yamcha', series: 'DBZ, DBS', notes: 'Voix de Yamcha.' }
      ]),
      biography: 'Directeur de casting et comédien pilier du doublage américain de Dragon Ball. Il incarne magistralement Vegeta, Piccolo, Yamcha et le dragon Shenron pour le public anglophone.',
      visible: true
    },
    {
      slug: 'mario-castaneda',
      name: 'Mario Castañeda',
      name_ja: 'マリオ・カスタニェーダ',
      nationality: 'latam',
      birth_date: '1962-01-29',
      roles: JSON.stringify([
        { characterName: 'Son Goku', series: 'DBZ, DBGT, DBS, Films', notes: 'Voix culte de Son Goku adulte en espagnol latino-américain.' }
      ]),
      biography: 'Monstre sacré du doublage latino-américain. Sa voix chaleureuse, héroïque et puissante pour Son Goku adulte a bercé trois générations de fans hispanophones au Mexique et dans toute l\'Amérique latine.',
      visible: true
    },
    {
      slug: 'rene-garcia',
      name: 'René García',
      name_ja: 'レネ・ガルシア',
      nationality: 'latam',
      birth_date: '1970-03-12',
      roles: JSON.stringify([
        { characterName: 'Vegeta', series: 'DBZ, DBGT, DBS, Films', notes: 'Voix emblématique de Vegeta avec la célèbre réplique "¡Insecto!".' }
      ]),
      biography: 'Acteur mexicain culte, voix officielle de Vegeta en Amérique latine. Son interprétation fière et son exclamation fétiche « ¡Insecto! » sont passées à la postérité de la pop-culture latino-américaine.',
      visible: true
    },
    {
      slug: 'jose-antonio-gavira',
      name: 'José Antonio Gavira',
      name_ja: 'ホセ・アントニオ・ガビラ',
      nationality: 'es',
      birth_date: '1956-08-01',
      roles: JSON.stringify([
        { characterName: 'Son Goku', series: 'DBZ (Castillan)', notes: 'Voix emblématique de Goku adulte en Espagne.' }
      ]),
      biography: 'Journaliste et comédien de doublage espagnol, voix de Son Goku adulte dans les sagas Saiyans, Namek et Cell pour la diffusion télévisée en Espagne.',
      visible: true
    },
    {
      slug: 'paolo-torrisi',
      name: 'Paolo Torrisi',
      name_ja: 'パオロ・トッリージ',
      nationality: 'it',
      birth_date: '1950-05-15',
      roles: JSON.stringify([
        { characterName: 'Goku', series: 'Dragon Ball, DBZ, DBGT (Italie)', notes: 'Voix historique de Goku adulte et directeur de doublage sur Mediaset.' }
      ]),
      biography: 'Comédien et directeur de doublage italien (Maurizio Torresan, 1950-2005). La voix historique et adorée de Goku adulte dans les séries animées Dragon Ball diffusées sur Italia 1.',
      visible: true
    }
  ];

  for (const va of voiceActors) {
    const existing = await sql`SELECT id FROM bot.db_voice_actors WHERE slug = ${va.slug}`;
    if (existing.length === 0) {
      const maxIdRes = await sql`SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM bot.db_voice_actors`;
      const nextId = maxIdRes[0].next_id;
      await sql`
        INSERT INTO bot.db_voice_actors (id, slug, name, name_ja, nationality, birth_date, roles, biography, visible)
        VALUES (${nextId}, ${va.slug}, ${va.name}, ${va.name_ja}, ${va.nationality}, ${va.birth_date}, ${sql.json(JSON.parse(va.roles))}, ${va.biography}, ${va.visible})
      `;
      console.log(`Inserted voice actor ${va.name}`);
    } else {
      await sql`
        UPDATE bot.db_voice_actors SET
          name = ${va.name},
          name_ja = ${va.name_ja},
          nationality = ${va.nationality},
          birth_date = ${va.birth_date},
          roles = ${sql.json(JSON.parse(va.roles))},
          biography = ${va.biography},
          visible = ${va.visible}
        WHERE slug = ${va.slug}
      `;
      console.log(`Updated voice actor ${va.name}`);
    }
  }

  console.log("All staff & VA enriched successfully.");
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
