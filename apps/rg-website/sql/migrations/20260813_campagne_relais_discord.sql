-- Relais Discord des créations d'une campagne à hashtag, TOUTES SOURCES.
--
-- Une campagne se joue sur plusieurs réseaux à la fois : X (le hashtag), le
-- salon de dépôt Discord, et — pour ce qui est autorisé par le règlement —
-- Instagram. Le staff, lui, n'a qu'un endroit à surveiller : le salon de relais
-- (`⚙🍰〡iergday-staff`), où le bot dépose chaque création au fil de l'eau, quelle
-- que soit sa provenance.
--
--  1. `x_campagnes.relais_salon` / `relais_depuis` — le PILOTAGE, en base, parce
--     qu'ouvrir le relais d'une campagne ne doit pas demander un déploiement.
--     `relais_depuis` est la garde anti-déluge : sans elle, activer le relais sur
--     une campagne archivée déverserait ses centaines de créations d'un coup.
--
--  2. `x_campagne_relais` — la MÉMOIRE de ce qui est déjà parti. La clé primaire
--     porte la SOURCE, parce que rien ne garantit qu'un identifiant de tweet ne
--     collisionne pas avec un identifiant de message Discord (les deux sont des
--     flocons, tirés de deux espaces différents). `message_id` permet en plus de
--     retrouver, corriger ou supprimer le relais si la modération masque
--     l'original.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260813_campagne_relais_discord.sql

begin;

alter table public.x_campagnes
	add column if not exists relais_salon text,
	add column if not exists relais_depuis timestamptz;

comment on column public.x_campagnes.relais_salon is
	'Salon Discord où le bot dépose les créations de la campagne (toutes sources). NULL = pas de relais.';
comment on column public.x_campagnes.relais_depuis is
	'Seules les créations parues à partir de cet instant sont relayées (garde anti-déluge).';

create table if not exists public.x_campagne_relais (
	campagne_slug text not null references public.x_campagnes (slug) on delete cascade,
	-- D'où vient la création. `instagram` est déclaré ici parce que le règlement
	-- l'autorise ; AUCUN collecteur Instagram n'existe à ce jour, donc aucune
	-- ligne ne portera cette valeur tant qu'il n'y en aura pas.
	source text not null check (source in ('x', 'discord', 'instagram')),
	-- Identifiant chez la source : id du tweet, id du message Discord, code du
	-- post Instagram.
	reference_id text not null,
	salon_id text not null,
	-- NULL tant que Discord n'a pas confirmé : une ligne sans `message_id` ni
	-- `saute_motif` est un envoi qui a échoué, et la tâche la retentera.
	message_id text,
	poste_le timestamptz not null default now(),
	-- Renseigné quand la création a été volontairement NON relayée (masquée par la
	-- modération, sans auteur exploitable). Dire pourquoi vaut mieux que laisser
	-- croire à un oubli.
	saute_motif text,
	primary key (campagne_slug, source, reference_id)
);

comment on table public.x_campagne_relais is
	'Créations déjà relayées dans le salon Discord de suivi (idempotence du relais).';

-- Les deux lectures de la tâche : « qu''est-ce qui reste à poster pour cette
-- campagne ? » et « ce message Discord correspond à quelle création ? ».
create index if not exists x_campagne_relais_campagne_idx
	on public.x_campagne_relais (campagne_slug, poste_le desc);
create index if not exists x_campagne_relais_message_idx
	on public.x_campagne_relais (message_id)
	where message_id is not null;

-- La campagne en cours. Le salon de relais est « ⚙🍰〡iergday-staff »
-- (1537470522764304435), PAS le salon public « 🍰〡iergday » (1537458038623965194) :
-- ce dernier est l'endroit où les membres déposent eux-mêmes leurs créations, et
-- le bot y republierait ce qui vient d'y être posté.
--
-- `relais_depuis` = début de la campagne, pas `now()` : les créations publiées
-- entre l''ouverture et la mise en service du relais doivent partir elles aussi.
update public.x_campagnes
   set relais_salon  = '1537470522764304435',
       relais_depuis = coalesce(debut_le, now()),
       updated_at    = now()
 where slug = 'iergday';

commit;
