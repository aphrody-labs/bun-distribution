-- Vie de communauté des deux bots Discord : niveaux, points d'amitié, tickets.
--
-- ── CE QUE CES TABLES CONTIENNENT, ET CE QU'ELLES NE CONTIENDRONT JAMAIS ────
-- Rien de ce qui est écrit ici ne dit ce qu'un membre a ÉCRIT. Le gain d'XP se
-- déclenche sur l'événement `messageCreate`, dont l'intent `GuildMessages` suffit
-- (`MessageContent` est un intent PRIVILÉGIÉ que ces applications n'ont pas et ne
-- demanderont pas) : on compte des messages, on ne les lit pas. Aucune colonne ne
-- porte de texte de message, de sujet de conversation ni de contenu de ticket.
--
-- C'est la même ligne rouge que celle des sondages (`apps/bot/src/lib/
-- sondage-format.ts`) : la garantie ne repose pas sur notre discipline de lecture,
-- elle repose sur le fait que la donnée n'entre pas en base.
--
-- ── UNE LIGNE PAR (GUILDE, MEMBRE) ─────────────────────────────────────────
-- Les deux bots servent DEUX serveurs. Une progression globale ferait qu'un
-- membre du serveur Azalée hériterait de son niveau Rose Griffon, et qu'un
-- classement mélangerait deux communautés qui ne se croisent pas. La guilde fait
-- donc partie de la clé, partout.
--
-- ── POURQUOI PAS DE `references profiles` ──────────────────────────────────
-- La très grande majorité des membres Discord n'a pas de compte sur le site
-- (2 075 membres, 1 832 comptes liés). Une clé étrangère vers `profiles` rendrait
-- le système inutilisable pour ceux qui n'ont jamais mis les pieds sur
-- rosegriffon.fr — c'est-à-dire pour la partie de la communauté que ce système
-- est justement censé animer.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_bot_communaute.sql

begin;

-- ── Profil de communauté ───────────────────────────────────────────────────

create table if not exists public.bot_profils (
	guild_id text not null,
	discord_id text not null,
	-- Expérience CUMULÉE depuis toujours. Le niveau en est déduit par la courbe
	-- réelle du jeu (`inagle_exp_table`, 100 paliers) et non stocké comme source
	-- de vérité : le stocker permettrait aux deux de diverger, et c'est toujours
	-- l'XP qui aurait raison.
	xp bigint not null default 0 check (xp >= 0),
	-- Cache du niveau, pour classer sans recalculer 2 000 lignes. Recalculé à
	-- chaque écriture d'XP.
	niveau integer not null default 1 check (niveau between 1 and 100),
	-- Points d'amitié disponibles (Kizuna). Jamais négatif : un solde négatif
	-- n'aurait aucun sens et masquerait un bogue de dépense.
	points integer not null default 0 check (points >= 0),
	-- Total gagné depuis toujours, dépenses comprises. C'est LUI qui mesure la
	-- contribution ; le solde, lui, ne mesure que l'épargne.
	points_gagnes bigint not null default 0 check (points_gagnes >= 0),
	messages_comptes bigint not null default 0 check (messages_comptes >= 0),
	-- Dernier message ayant RAPPORTÉ de l'XP : c'est la mémoire du délai
	-- anti-spam, pas la date du dernier message.
	dernier_gain_le timestamptz,
	-- Jour du dernier `quotidien` réclamé, en date pure : la série se compte en
	-- jours civils (UTC), pas en tranches de 24 h.
	dernier_quotidien_le date,
	serie_quotidienne integer not null default 0 check (serie_quotidienne >= 0),
	-- Cosmétiques ÉQUIPÉS. Ce sont des identifiants de données de jeu :
	-- `inagle_nameplates.id` pour la plaque, un code de titre pour le titre,
	-- `inagle_characters.id` pour le personnage fétiche. Aucune contrainte de clé
	-- étrangère : les tables `inagle_*` sont un MIROIR reconstruit chaque nuit,
	-- et une reconstruction ne doit jamais pouvoir casser un profil de membre.
	plaque text,
	titre text,
	perso_favori text,
	cree_le timestamptz not null default now(),
	maj_le timestamptz not null default now(),
	primary key (guild_id, discord_id)
);

comment on table public.bot_profils is
	'Progression de communauté d''un membre sur une guilde (XP, points d''amitié, cosmétiques équipés). Ne contient AUCUN contenu de message.';
comment on column public.bot_profils.xp is
	'Expérience cumulée. Le niveau s''en déduit par la courbe réelle du jeu (inagle_exp_table).';
comment on column public.bot_profils.points is
	'Solde de points d''amitié (Kizuna). points_gagnes mesure la contribution, points l''épargne.';

-- Les deux classements servis par le bot et, demain, par le site.
create index if not exists bot_profils_classement_xp_idx
	on public.bot_profils (guild_id, xp desc);
create index if not exists bot_profils_classement_points_idx
	on public.bot_profils (guild_id, points_gagnes desc);

-- ── Journal des points d'amitié ────────────────────────────────────────────
--
-- Un solde sans journal est indéfendable : le jour où un membre conteste un
-- retrait, la seule réponse possible est « la base dit 40 ». Chaque mouvement
-- est donc écrit, y compris les gains automatiques, et rien n'est jamais
-- modifié après coup — on ajoute une ligne inverse.

create table if not exists public.bot_journal_amitie (
	id bigserial primary key,
	guild_id text not null,
	discord_id text not null,
	-- Signé : un gain est positif, une dépense négative. La somme du journal doit
	-- toujours valoir le solde ; c'est la seule vérification qui compte.
	delta integer not null check (delta <> 0),
	-- Cause, en vocabulaire fermé (cf. `apps/bot/src/lib/amitie.ts`).
	motif text not null,
	-- Ce que la ligne désigne : identifiant d'objet acheté, niveau atteint…
	reference text,
	-- L'autre partie d'un don. C'est un identifiant Discord, jamais un nom.
	contrepartie text,
	cree_le timestamptz not null default now()
);

comment on table public.bot_journal_amitie is
	'Journal signé de tous les mouvements de points d''amitié. Jamais modifié : une erreur se corrige par une ligne inverse.';

create index if not exists bot_journal_amitie_membre_idx
	on public.bot_journal_amitie (guild_id, discord_id, cree_le desc);
create index if not exists bot_journal_amitie_motif_idx
	on public.bot_journal_amitie (guild_id, motif, cree_le desc);

-- ── Collection de cosmétiques ──────────────────────────────────────────────

create table if not exists public.bot_inventaire (
	guild_id text not null,
	discord_id text not null,
	-- Famille de l'objet : `plaque`, `titre`, `emblème`… (cf. `lib/collection.ts`).
	categorie text not null,
	-- Identifiant dans les données du jeu (`inagle_nameplates.id`, …).
	objet_id text not null,
	-- Prix RÉELLEMENT payé. Le catalogue peut changer de prix ; l'historique, non.
	prix_paye integer not null default 0 check (prix_paye >= 0),
	obtenu_le timestamptz not null default now(),
	primary key (guild_id, discord_id, categorie, objet_id)
);

comment on table public.bot_inventaire is
	'Cosmétiques possédés par un membre. Le prix payé est figé à l''achat, indépendamment du catalogue.';

create index if not exists bot_inventaire_membre_idx
	on public.bot_inventaire (guild_id, discord_id, obtenu_le desc);

-- ── Tickets ────────────────────────────────────────────────────────────────
--
-- Métadonnées SEULEMENT. Pas de transcription, pas de sujet libre stocké au-delà
-- de ce que l'ouvreur a lui-même écrit dans le formulaire d'ouverture : un
-- ticket sert à parler d'un problème personnel (modération, litige, signalement),
-- et l'archiver en base en ferait une pièce consultable des années plus tard par
-- quiconque a accès à la base.

create table if not exists public.bot_tickets (
	id bigserial primary key,
	guild_id text not null,
	-- Numéro lisible, propre à la guilde : « ticket-0042 ».
	numero integer not null,
	salon_id text not null,
	-- Qui a ouvert. C'est la seule personne, avec le staff, à voir le salon.
	auteur_id text not null,
	categorie text not null,
	-- Résumé saisi à l'ouverture. Court par construction (100 caractères) et
	-- écrit par l'auteur lui-même en sachant qu'il nomme son ticket.
	sujet text,
	statut text not null default 'ouvert'
		check (statut in ('ouvert', 'pris', 'ferme')),
	-- Membre du staff qui a pris le ticket en charge, puis qui l'a fermé.
	pris_par text,
	ferme_par text,
	ouvert_le timestamptz not null default now(),
	pris_le timestamptz,
	ferme_le timestamptz,
	maj_le timestamptz not null default now(),
	unique (guild_id, numero)
);

comment on table public.bot_tickets is
	'Métadonnées des tickets d''assistance. AUCUNE transcription : le contenu d''un ticket ne quitte pas Discord.';

-- « Ce membre a-t-il déjà un ticket ouvert ? » — la garde anti-doublon.
create index if not exists bot_tickets_ouverts_idx
	on public.bot_tickets (guild_id, auteur_id)
	where statut <> 'ferme';
create index if not exists bot_tickets_salon_idx
	on public.bot_tickets (salon_id);

-- ── Réglages par guilde ────────────────────────────────────────────────────
--
-- Un seul document JSON plutôt qu'une colonne par option : ces réglages changent
-- au rythme des envies du staff, et chaque nouvelle option ne doit pas demander
-- une migration. Le SCHÉMA, lui, est tenu côté code par zod
-- (`apps/bot/src/lib/reglages-communaute.ts`), qui refuse une valeur aberrante à
-- l'écriture comme à la lecture.

create table if not exists public.bot_reglages_guilde (
	guild_id text primary key,
	valeurs jsonb not null default '{}'::jsonb,
	maj_le timestamptz not null default now()
);

comment on table public.bot_reglages_guilde is
	'Réglages de communauté d''une guilde (niveaux, tickets, salons). Schéma tenu par zod côté bot.';

-- ── Récompenses de niveau ──────────────────────────────────────────────────

create table if not exists public.bot_recompenses_niveau (
	guild_id text not null,
	niveau integer not null check (niveau between 1 and 100),
	role_id text not null,
	-- Retirer le rôle du palier précédent quand on passe au suivant, ou l'empiler.
	cumulable boolean not null default true,
	cree_le timestamptz not null default now(),
	primary key (guild_id, niveau)
);

comment on table public.bot_recompenses_niveau is
	'Rôle Discord attribué en atteignant un niveau. Un seul rôle par palier et par guilde.';

-- ── Propriétaire ───────────────────────────────────────────────────────────
--
-- ⚠ Toutes les tables de cette base appartiennent à `rg`, et le bot s'y connecte
-- SOUS CE RÔLE. Appliquer ce fichier en `postgres` (le seul rôle qui passe en
-- authentification peer sur ce VPS) laisserait des tables appartenant à
-- `postgres`, sur lesquelles `rg` n'aurait aucun droit : le bot lèverait
-- « permission denied for table bot_profils » à la première écriture, longtemps
-- après la migration, et loin d'elle.

alter table public.bot_profils            owner to rg;
alter table public.bot_journal_amitie     owner to rg;
alter table public.bot_inventaire         owner to rg;
alter table public.bot_tickets            owner to rg;
alter table public.bot_reglages_guilde    owner to rg;
alter table public.bot_recompenses_niveau owner to rg;
alter sequence public.bot_journal_amitie_id_seq owner to rg;
alter sequence public.bot_tickets_id_seq        owner to rg;

-- ── Droits ─────────────────────────────────────────────────────────────────
--
-- Le bot écrit par la connexion Postgres directe (rôle `rg`, propriétaire) : il
-- n'est concerné ni par ces GRANT ni par RLS. Ce qui suit ne décide QUE de ce
-- qu'un visiteur du site pourra lire par PostgREST.
--
-- ⚠ Ordre obligatoire : révoquer au niveau TABLE avant toute liste blanche par
-- colonne. Un GRANT resté au niveau table masque silencieusement tout REVOKE par
-- colonne (cf. `20260811_profiles_pii.sql`).

alter table public.bot_profils            enable row level security;
alter table public.bot_journal_amitie     enable row level security;
alter table public.bot_inventaire         enable row level security;
alter table public.bot_tickets            enable row level security;
alter table public.bot_reglages_guilde    enable row level security;
alter table public.bot_recompenses_niveau enable row level security;

revoke all on public.bot_profils            from anon, authenticated;
revoke all on public.bot_journal_amitie     from anon, authenticated;
revoke all on public.bot_inventaire         from anon, authenticated;
revoke all on public.bot_tickets            from anon, authenticated;
revoke all on public.bot_reglages_guilde    from anon, authenticated;
revoke all on public.bot_recompenses_niveau from anon, authenticated;

-- Seule surface publique : le CLASSEMENT. Il ne dit rien de plus que ce qu'un
-- visiteur du serveur Discord voit déjà (un pseudo, une progression), et c'est
-- la moitié de l'intérêt d'un système de niveaux.
--
-- `dernier_gain_le` en est EXCLU : c'est un horodatage de présence, donc une
-- donnée de comportement — savoir à quelle minute quelqu'un a parlé pour la
-- dernière fois n'a aucun rapport avec un classement.
grant select (guild_id, discord_id, xp, niveau, points_gagnes, messages_comptes, plaque, titre, perso_favori)
	on public.bot_profils to anon, authenticated;

drop policy if exists "Classement public" on public.bot_profils;
create policy "Classement public" on public.bot_profils
	for select to anon, authenticated using (true);

-- Les tickets, le journal des dons et l'inventaire restent SANS AUCUN accès
-- public : un journal de dons est un graphe social, un ticket est une demande
-- personnelle. Ni l'un ni l'autre n'a de raison d'être lisible par une clé
-- publique. Aucune policy n'est créée pour eux — RLS activée sans policy = tout
-- refusé, ce qui est exactement l'intention.

commit;
