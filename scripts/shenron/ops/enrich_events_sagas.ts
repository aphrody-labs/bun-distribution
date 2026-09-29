import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  console.log("Updating battles with saga_id and arc_id...");

  // Saga IDs:
  // 1: Pilaf (arc 1)
  // 2: 21e Tournoi
  // 3: Red Ribbon (arc 2, 4)
  // 4: Baba
  // 5: 22e Tournoi
  // 6: Piccolo Daimao
  // 7: 23e Tournoi
  // 8: Saiyan (arc 5: raditz, arc 6: vegeta-nappa)
  // 9: Namek (arc 7: arrival, arc 8: ginyu)
  // 31: Saga Freezer (arc 9: frieza-final)
  // 10: Retour sur Terre
  // 11: Cyborgs (arc 10: androids-arrival)
  // 12: Cell (arc 11: imperfect-cell)
  // 14: Majin Buu
  // 19: Battle of Gods
  // 20: Resurrection F
  // 21: Univers 6
  // 22: Future Trunks
  // 23: Tournoi du Pouvoir
  // 24: Broly
  // 27: Super Hero

  const mappings: Array<{ id: number; saga_id: number; arc_id?: number }> = [
    // DB
    { id: 18, saga_id: 1, arc_id: 1 },
    { id: 19, saga_id: 2 },
    { id: 20, saga_id: 2 },
    { id: 21, saga_id: 2 },
    { id: 2, saga_id: 2 },
    { id: 22, saga_id: 3, arc_id: 2 },
    { id: 1, saga_id: 3, arc_id: 4 },
    { id: 23, saga_id: 4 },
    { id: 24, saga_id: 5 },
    { id: 25, saga_id: 5 },
    { id: 26, saga_id: 5 },
    { id: 3, saga_id: 6 },
    { id: 4, saga_id: 7 },
    // DBZ Saiyan
    { id: 5, saga_id: 8, arc_id: 5 },
    { id: 27, saga_id: 8, arc_id: 6 },
    { id: 28, saga_id: 8, arc_id: 6 },
    { id: 29, saga_id: 8, arc_id: 6 },
    { id: 6, saga_id: 8, arc_id: 6 },
    // DBZ Namek / Freezer
    { id: 30, saga_id: 9, arc_id: 7 },
    { id: 31, saga_id: 9, arc_id: 7 },
    { id: 32, saga_id: 9, arc_id: 7 },
    { id: 33, saga_id: 9, arc_id: 7 },
    { id: 7, saga_id: 9, arc_id: 8 },
    { id: 34, saga_id: 9, arc_id: 8 },
    { id: 35, saga_id: 31, arc_id: 9 },
    { id: 8, saga_id: 31, arc_id: 9 },
    // DBZ Cyborgs & Cell
    { id: 9, saga_id: 10 },
    { id: 36, saga_id: 11, arc_id: 10 },
    { id: 37, saga_id: 11, arc_id: 10 },
    { id: 10, saga_id: 11, arc_id: 10 },
    { id: 38, saga_id: 12, arc_id: 11 },
    { id: 39, saga_id: 12 },
    { id: 11, saga_id: 12 },
    // DBZ Buu
    { id: 40, saga_id: 14 },
    { id: 12, saga_id: 14 },
    { id: 13, saga_id: 14 },
    { id: 41, saga_id: 14 },
    { id: 14, saga_id: 14 },
    { id: 15, saga_id: 14 },
    { id: 42, saga_id: 14 },
    // DBS
    { id: 16, saga_id: 19 },
    { id: 43, saga_id: 20 },
    { id: 44, saga_id: 21 },
    { id: 45, saga_id: 22 },
    { id: 17, saga_id: 23 },
    { id: 46, saga_id: 24 },
    { id: 47, saga_id: 27 },
  ];

  for (const m of mappings) {
    if (m.arc_id) {
      await sql`UPDATE bot.db_battles SET saga_id = ${m.saga_id}, arc_id = ${m.arc_id} WHERE id = ${m.id}`;
    } else {
      await sql`UPDATE bot.db_battles SET saga_id = ${m.saga_id} WHERE id = ${m.id}`;
    }
  }
  console.log("Battles mapped to sagas and arcs.");

  // Also update narrative_events with saga_id and arc_id
  for (const m of mappings) {
    const battleRow = await sql`SELECT slug FROM bot.db_battles WHERE id = ${m.id}`;
    if (battleRow.length > 0) {
      const slug = battleRow[0].slug;
      await sql`
        UPDATE bot.narrative_events 
        SET saga_id = ${m.saga_id}, arc_id = ${m.arc_id || null}
        WHERE slug LIKE ${'%' + slug + '%'};
      `;
    }
  }
  console.log("Narrative events mapped.");

  // Xenoverse Inserts into bot.db_battles
  console.log("Inserting Xenoverse battles...");
  const xvBattles = [
    {
      id: 48,
      slug: 'xv-patrouilleur-vs-mira-towa',
      title: 'Patrouilleur du Temps vs Mira & Towa — Altération de Namek',
      title_ja: 'タイムパトローラーVSミラ＆トワ',
      series: 'XV',
      combatants: JSON.stringify([
        { name: 'Patrouilleur du Temps' },
        { name: 'Trunks Xeno' },
        { name: 'Mira' },
        { name: 'Towa' }
      ]),
      winner_name: 'Patrouilleur du Temps & Trunks',
      location: 'Planète Namek (Flux Temporel Altéré)',
      canon: false,
      climax_summary: "Les Briseurs de Temps tentent d'altérer le combat final contre Freezer. Le Patrouilleur du Temps intervient pour réparer la ligne temporelle.",
      visible: true
    },
    {
      id: 49,
      slug: 'xv-trunks-xeno-vs-demigra',
      title: 'Trunks Xeno & Patrouilleur vs Démigra — Le Siège du Nid du Temps',
      title_ja: 'トランクス：ゼノVSドミグラ',
      series: 'XV',
      combatants: JSON.stringify([
        { name: 'Trunks Xeno' },
        { name: 'Patrouilleur du Temps' },
        { name: 'Démigra' }
      ]),
      winner_name: 'Trunks Xeno & Patrouilleur',
      location: 'Nid du Temps (Faille Dimensionnelle)',
      canon: false,
      climax_summary: "Le Démon Démigra tente de détruire l'oiseau Tokitoki pour refaçonner le multivers à son image.",
      visible: true
    }
  ];

  for (const b of xvBattles) {
    const existing = await sql`SELECT id FROM bot.db_battles WHERE id = ${b.id}`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO bot.db_battles (id, slug, title, title_ja, series, combatants, winner_name, location, canon, climax_summary, visible)
        VALUES (${b.id}, ${b.slug}, ${b.title}, ${b.title_ja}, ${b.series}, ${sql.json(JSON.parse(b.combatants))}, ${b.winner_name}, ${b.location}, 0, ${b.climax_summary}, ${b.visible})
      `;
      console.log(`Inserted battle ${b.title}`);
    }
  }

  // Xenoverse Tournament
  console.log("Inserting Xenoverse tournament...");
  const existingTourn = await sql`SELECT id FROM bot.db_tournaments WHERE slug = 'super-tournoi-espace-temps-tokitoki'`;
  if (existingTourn.length === 0) {
    const maxTournId = await sql`SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM bot.db_tournaments`;
    const nextId = maxTournId[0].next_id;
    await sql`
      INSERT INTO bot.db_tournaments (id, slug, name, name_ja, tournament_type, location, winner_name, runner_up_name, canon, rules_summary, visible)
      VALUES (${nextId}, 'super-tournoi-espace-temps-tokitoki', 'Super Tournoi de l''Espace-Temps (Toki Toki City)', '時空天下一武道会', 'Xenoverse', 'Cité de Toki Toki / Nid du Temps', 'Patrouilleur du Temps', 'Goku Xeno', 0, 'Tournoi martial inter-dimensionnel testant les défenses spatio-temporelles face aux distorsions du temps.', true)
    `;
    console.log("Inserted Xenoverse tournament.");
  }

  // Xenoverse Narrative Events on timeline_id = 4
  console.log("Inserting Xenoverse narrative events on timeline 4...");
  const xvNarrative = [
    {
      slug: 'xv-event-mira-towa-namek',
      kind: 'battle',
      title: 'Patrouilleur du Temps vs Mira & Towa — Altération de Namek',
      synopsis_fr: "Combat spatio-temporel orchestré par les briseurs de temps. Trunks Xeno et le Patrouilleur interviennent pour sauver le flux canonique de Namek.",
      timeline_id: 4,
      canon: 'non_canon'
    },
    {
      slug: 'xv-event-demigra-nid-du-temps',
      kind: 'battle',
      title: 'Trunks Xeno & Patrouilleur vs Démigra — Le Siège du Nid du Temps',
      synopsis_fr: "Bataille d'anéantissement dimensionnel pour sauver l'oiseau Tokitoki et préserver la mémoire de l'univers.",
      timeline_id: 4,
      canon: 'non_canon'
    },
    {
      slug: 'xv-event-tournoi-espace-temps',
      kind: 'tournament',
      title: "Super Tournoi de l'Espace-Temps — Toki Toki City",
      synopsis_fr: "Championnat inter-dimensionnel réunissant patrouilleurs et héros alternatifs au cœur du Nid du Temps.",
      timeline_id: 4,
      canon: 'non_canon'
    }
  ];

  for (const ev of xvNarrative) {
    const existing = await sql`SELECT id FROM bot.narrative_events WHERE slug = ${ev.slug}`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO bot.narrative_events (slug, kind, title, synopsis_fr, timeline_id, canon, visible)
        VALUES (${ev.slug}, ${ev.kind}, ${ev.title}, ${ev.synopsis_fr}, ${ev.timeline_id}, ${ev.canon}, true)
      `;
      console.log(`Inserted narrative event ${ev.title}`);
    }
  }

  console.log("All event & saga enrichments done!");
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
