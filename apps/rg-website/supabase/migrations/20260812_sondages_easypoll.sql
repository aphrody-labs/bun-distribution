-- Sondages du serveur Discord : structure exploitable, au-dela du message brut.
--
-- POURQUOI UNE TABLE DEDIEE
-- Les sondages de 🧐〡sondages sont posés par le bot EasyPoll (application Discord
-- 437618149505105920) sous forme d'ENCART. Le message archivé dans `discord_messages`
-- contient donc un bloc de texte, pas des données : question, choix et résultats y sont
-- noyés dans une description Markdown. Impossible de trier par nombre de votes, de
-- comparer deux sondages ou d'afficher un graphique sans les extraire.
--
-- DEUX SOURCES, DELIBEREMENT
--   'embed' : analyse de la description de l'encart. Fonctionne toujours, sans aucun
--             identifiant, y compris rétroactivement sur tout l'historique. MAIS
--             EasyPoll masque les résultats tant que le sondage tourne : sur les 49
--             sondages du salon, 25 n'affichent aucun décompte.
--   'api'   : https://easypoll.bot/api (REST derrière une session Discord OAuth —
--             scopes identify+guilds+guilds.members.read). Donne les décomptes des
--             sondages en cours et la liste des participants. Nécessite une session,
--             donc optionnelle : l'import fonctionne sans, en mode dégradé.
-- `source` mémorise laquelle a écrit la ligne ; l'API, plus riche, écrase l'encart.
--
-- Application : psql -d rg -f apps/website/supabase/migrations/20260812_sondages_easypoll.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sondages
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.discord_polls (
	-- Identifiant court EasyPoll, celui affiché en pied d'encart (« Poll ID: d4caa664 »),
	-- ou l'identifiant du message pour un sondage natif Discord.
	--
	-- Pourquoi PAS l'UUID : sur les 49 sondages du salon, 9 SEULEMENT portent encore le
	-- bouton « Participants » d'où l'UUID se lit ; EasyPoll le retire des vieux messages.
	-- L'identifiant court, lui, est présent sur les 49 — et c'est le préfixe de l'UUID,
	-- donc les deux se raccordent sans ambiguïté quand l'API redonne l'UUID complet.
	poll_id         text primary key,
	-- UUID EasyPoll complet quand il est connu (bouton encore présent, ou import API).
	uuid            text unique,
	-- 'easypoll' | 'discord' (sondage natif)
	provider        text not null default 'easypoll',
	-- 'embed' | 'api' : d'où viennent les chiffres actuellement en base.
	source          text not null default 'embed',

	message_id      text references public.discord_messages (message_id) on delete set null,
	channel_id      text not null references public.discord_channels (channel_id) on delete cascade,
	guild_id        text not null,

	question        text not null,
	-- Auteur de la commande, lu dans `interaction_metadata`. Peut manquer sur les
	-- messages anciens : Discord n'a ajouté ce bloc qu'en cours de route.
	creator_id      text,
	creator_username text,
	-- Commande EasyPoll utilisée : 'poll', 'timepoll'…
	command         text,

	-- 0 = illimité (« Unlimited choices » / « :infinity: »).
	max_choices     integer not null default 1,
	-- Aucun autre vote autorisé (sondage verrouillé).
	locked          boolean not null default false,
	ended           boolean not null default false,
	ends_at         timestamptz,

	total_votes     integer,
	total_voters    integer,
	-- Vrai quand l'encart ne publie aucun décompte : les chiffres n'existent qu'à
	-- travers l'API. C'est le drapeau qui dit « cette ligne mérite un import API ».
	results_hidden  boolean not null default false,

	-- Charge utile brute de l'API EasyPoll, pour ne rien perdre de ce que le
	-- modèle relationnel ci-dessus ne couvre pas encore.
	raw             jsonb,

	created_at      timestamptz not null,
	updated_at      timestamptz not null default now()
);

comment on table public.discord_polls is
	'Sondages Discord (EasyPoll ou natifs) extraits sous forme exploitable.';
comment on column public.discord_polls.results_hidden is
	'Encart sans décompte : les chiffres ne sont récupérables que via l''API EasyPoll.';
comment on column public.discord_polls.max_choices is
	'Nombre de choix autorisés par votant ; 0 = illimité.';

create index if not exists discord_polls_salon_date_idx
	on public.discord_polls (channel_id, created_at desc);
create index if not exists discord_polls_message_idx
	on public.discord_polls (message_id);
-- Les lignes qu'un import API doit venir compléter en priorité.
create index if not exists discord_polls_a_completer_idx
	on public.discord_polls (created_at desc) where results_hidden;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Choix
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.discord_poll_options (
	poll_id     text not null references public.discord_polls (poll_id) on delete cascade,
	-- Rang du choix dans le sondage (0-indexé), tel qu'affiché.
	position    integer not null,
	-- Emoji du choix : soit un caractère Unicode, soit `<:nom:id>` pour un emoji
	-- personnalisé. Conservé brut, le rendu est l'affaire du site.
	emoji       text,
	label       text not null,
	votes       integer,
	-- Pourcentage tel que publié par EasyPoll (il arrondit : la somme peut ne pas
	-- faire exactement 100). Recalculer plutôt que de s'y fier pour un graphique.
	percentage  numeric(5, 2),
	primary key (poll_id, position)
);

comment on table public.discord_poll_options is
	'Choix d''un sondage, dans leur ordre d''affichage, avec les décomptes connus.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Votes nominatifs — NON PUBLICS
-- ─────────────────────────────────────────────────────────────────────────────
-- Rattacher un membre à une opinion est d'une autre nature que republier une
-- annonce : c'est une donnée d'opinion nominative. Elle n'est accessible que via
-- l'API EasyPoll (jamais dans l'encart), donc jamais collectée par accident.
-- Cette table est volontairement HORS du dispositif public :
--   * aucune policy de lecture -> `anon` et `authenticated` ne voient rien ;
--   * aucun trigger `rg_realtime_notify` -> rien ne part dans le flux SSE, qui
--     n'est pas authentifié.
-- Ne pas y ajouter de policy de lecture sans décision explicite.

create table if not exists public.discord_poll_votes (
	poll_id   text not null references public.discord_polls (poll_id) on delete cascade,
	user_id   text not null,
	position  integer not null,
	voted_at  timestamptz,
	primary key (poll_id, user_id, position)
);

comment on table public.discord_poll_votes is
	'Votes nominatifs (API EasyPoll uniquement). NON PUBLIC : ni RLS de lecture, ni temps réel.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Même raisonnement que pour `discord_messages` : les GRANT au niveau table sont
-- larges, seule la RLS empêche `anon` d'écrire. Lecture publique limitée aux
-- sondages des salons effectivement suivis.

alter table public.discord_polls       enable row level security;
alter table public.discord_poll_options enable row level security;
alter table public.discord_poll_votes  enable row level security;

drop policy if exists "Lecture publique des sondages" on public.discord_polls;
create policy "Lecture publique des sondages"
	on public.discord_polls for select
	using (
		exists (
			select 1 from public.discord_channels c
			 where c.channel_id = discord_polls.channel_id
			   and c.suivi
		)
	);

drop policy if exists "Lecture publique des choix" on public.discord_poll_options;
create policy "Lecture publique des choix"
	on public.discord_poll_options for select
	using (
		exists (
			select 1 from public.discord_polls p
			 join public.discord_channels c on c.channel_id = p.channel_id
			 where p.poll_id = discord_poll_options.poll_id
			   and c.suivi
		)
	);

-- `discord_poll_votes` : aucune policy, donc aucune lecture hors service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Temps réel
-- ─────────────────────────────────────────────────────────────────────────────
-- Un sondage qui bouge (nouveau vote, clôture) doit se refléter sur le site sans
-- rechargement, comme les messages. `discord_poll_votes` en est exclue.

drop trigger if exists rg_realtime_discord_polls on public.discord_polls;
create trigger rg_realtime_discord_polls
	after insert or update or delete on public.discord_polls
	for each row execute function public.rg_realtime_notify();

drop trigger if exists rg_realtime_discord_poll_options on public.discord_poll_options;
create trigger rg_realtime_discord_poll_options
	after insert or update or delete on public.discord_poll_options
	for each row execute function public.rg_realtime_notify();

commit;
