-- Archive BRUTE de ce que l'API Noctaly a rendu, avant toute interprétation.
--
-- ── POURQUOI GARDER LE JSON TEL QUEL ──────────────────────────────────────
-- L'import mappe ce qui a un équivalent chez nous : l'XP va dans
-- `bot_profils.xp`, la monnaie devient des jetons Kizuna, la série
-- quotidienne devient `serie_quotidienne`. Le reste — l'inventaire d'objets,
-- les coffres, la durabilité, les emojis, les prix d'achat/revente — n'a
-- aucun équivalent : notre collection, ce sont les 6 090 joueurs du jeu, pas
-- des épées et des potions.
--
-- Le jeter serait irréversible. Noctaly sera retiré du serveur une fois la
-- reprise faite, et un import ne se rejoue pas : l'API cesse de répondre avec
-- le bot. Ces tables gardent donc la réponse intégrale, verbatim, pour que la
-- décision de ne pas mapper l'inventaire reste réversible plus tard.
--
-- ── PAS DE CLÉ ÉTRANGÈRE VERS discord_members ─────────────────────────────
-- Un membre parti depuis l'import garde son archive : c'est précisément ce
-- qu'on veut conserver s'il revient.

create table if not exists bot_import_noctaly (
	guild_id      text        not null,
	discord_id    text        not null,
	-- La réponse de GET …/level-profile, verbatim.
	profil_niveau jsonb,
	-- La réponse de GET …/eco-profile?items&chests&dailyStreak, verbatim.
	profil_eco    jsonb,
	importe_le    timestamptz not null default now(),
	primary key (guild_id, discord_id)
);

comment on table bot_import_noctaly is
	'Réponses brutes de l''API Noctaly, une ligne par membre. Source de vérité de la reprise : bot_profils n''en garde que ce qui a un équivalent.';

-- Le catalogue de la guilde (objets et coffres configurés par le staff) : deux
-- requêtes pour tout le serveur, pas une par membre. Conservé pour la même
-- raison — c'est du travail de configuration humain, il ne se retrouve pas.
create table if not exists bot_import_noctaly_catalogue (
	guild_id   text        not null,
	-- 'items' ou 'chests' — le nom de la route qui l'a rendu.
	genre      text        not null,
	contenu    jsonb       not null,
	importe_le timestamptz not null default now(),
	primary key (guild_id, genre)
);

comment on table bot_import_noctaly_catalogue is
	'Catalogues d''objets et de coffres de l''économie Noctaly, tels que rendus par GET /guilds/{id}/items et /chests.';

-- Aucune de ces deux tables n'est lisible par le public : elles contiennent
-- l'activité nominative de chaque membre. Pas de policy = personne n'y accède
-- via PostgREST, seul le bot (rôle `rg`) les lit par connexion directe.
alter table bot_import_noctaly enable row level security;
alter table bot_import_noctaly_catalogue enable row level security;

-- Le bot se connecte en `rg` : sans ce transfert de propriété, une migration
-- appliquée en `postgres` laisse des tables inaccessibles au bot, et la panne
-- se déclare longtemps après la migration.
alter table bot_import_noctaly owner to rg;
alter table bot_import_noctaly_catalogue owner to rg;
