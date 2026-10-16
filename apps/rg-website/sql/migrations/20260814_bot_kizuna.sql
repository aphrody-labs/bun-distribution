-- La monnaie de la communauté prend son VRAI nom : le Jeton Kizuna.
--
-- ── POURQUOI CE RENOMMAGE ──────────────────────────────────────────────────
-- Les tables créées ce matin parlaient de « points d'amitié ». C'était une
-- traduction maison d'une idée du jeu — or le jeu a déjà un nom pour cette
-- monnaie, et il est dans ses propres données :
--
--   texte 0xD63615BE   fr « Jeton Kizuna »
--                      en « Bond Token »
--                      ja « キズナトークン »
--
-- (relevé le 14/8/2026 sur `GET /api/text/0xD63615BE` de `azalee-api.service`,
-- catégorie `menu`.) C'est la monnaie de la Boutique Kizuna
-- (« Échangez les tokens que vous avez gagnés contre divers objets ! »,
-- « Pas assez de tokens. »), celle qu'un joueur d'Inazuma Eleven Victory Road
-- reconnaît sans qu'on la lui explique.
--
-- Le renommage est fait MAINTENANT parce qu'il ne coûte rien : ces tables ont
-- été créées le jour même, `bot_profils` ne porte que dix lignes d'import d'XP
-- (aucun jeton), et `bot_journal_amitie` est vide. Le même renommage dans six
-- mois demanderait une bascule applicative.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_bot_kizuna.sql

begin;

-- ── Le journal ─────────────────────────────────────────────────────────────

alter table if exists public.bot_journal_amitie rename to bot_journal_kizuna;
alter index if exists bot_journal_amitie_membre_idx rename to bot_journal_kizuna_membre_idx;
alter index if exists bot_journal_amitie_motif_idx  rename to bot_journal_kizuna_motif_idx;
alter sequence if exists public.bot_journal_amitie_id_seq rename to bot_journal_kizuna_id_seq;

comment on table public.bot_journal_kizuna is
	'Journal signé de tous les mouvements de jetons Kizuna. Jamais modifié : une erreur se corrige par une ligne inverse.';

-- ── Le solde ───────────────────────────────────────────────────────────────

alter table public.bot_profils rename column points        to jetons;
alter table public.bot_profils rename column points_gagnes to jetons_gagnes;

alter index if exists bot_profils_classement_points_idx rename to bot_profils_classement_jetons_idx;

comment on column public.bot_profils.jetons is
	'Solde de jetons Kizuna (monnaie du jeu, texte 0xD63615BE). jetons_gagnes mesure la contribution, jetons l''épargne.';

-- ── Droits ─────────────────────────────────────────────────────────────────
--
-- Le GRANT par colonne posé ce matin nommait `points_gagnes` : renommer la
-- colonne ne renomme pas le droit qui la vise, il le SUIT (les droits portent
-- sur `attnum`, pas sur le nom). Rien à refaire donc — mais la policy et le
-- grant sont réaffirmés ici pour que ce fichier suffise à reconstruire l'état.

grant select (guild_id, discord_id, xp, niveau, jetons_gagnes, messages_comptes, plaque, titre, perso_favori)
	on public.bot_profils to anon, authenticated;

commit;
