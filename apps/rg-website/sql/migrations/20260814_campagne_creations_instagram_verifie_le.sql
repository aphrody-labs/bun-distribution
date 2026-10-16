-- Quand a-t-on demandé à Instagram, pour la DERNIÈRE fois, si cette publication
-- existait encore ?
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_campagne_creations_instagram_verifie_le.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE COLONNE
-- ─────────────────────────────────────────────────────────────────────────────
-- Une création Instagram est vérifiée UNE fois, au dépôt. Après quoi son auteur
-- peut supprimer son post, passer son compte en privé, ou l'archiver — et la
-- galerie de /iergday continuerait d'afficher une carte qui renvoie vers un
-- 404. La tâche `campagnes:instagram` repasse donc sur les liens déposés.
--
-- Sans cette colonne, cette tâche n'aurait aucun moyen de savoir ce qu'elle a
-- déjà vu : chaque passe horaire réinterrogerait Meta sur la TOTALITÉ de la
-- table. `collecte_le` ne peut pas servir de repère — il date du dépôt, pas de
-- la vérification, et l'écraser à chaque passe effacerait l'information « quand
-- cette création est-elle entrée ».
--
-- `null` = jamais revalidée depuis le dépôt. C'est l'état de toutes les lignes
-- existantes, et c'est exact : la vérification du dépôt et celle du cron ne sont
-- pas la même mesure (l'une accepte, l'autre retire).
--
-- REJOUABLE : `add column if not exists`, `create index if not exists`.

begin;

alter table public.campagne_creations_instagram
	add column if not exists verifie_le timestamptz;

comment on column public.campagne_creations_instagram.verifie_le is
	'Dernière revalidation du permalien chez Meta par la tâche campagnes:instagram. NULL = jamais revalidée depuis le dépôt.';

-- L'ordre de passage du cron : le plus ancien d'abord, jamais vérifié en tête.
-- `nulls first` est ce qui garantit qu'une création tout juste déposée passe
-- avant une création déjà contrôlée hier.
create index if not exists campagne_creations_instagram_a_verifier_idx
	on public.campagne_creations_instagram (verifie_le nulls first);

-- ⚠ L'ordre revoke -> grant reste impératif (un GRANT au niveau table masque
-- silencieusement tout REVOKE par colonne). On rejoue le dispositif entier
-- plutôt que d'ajouter un grant sur la seule colonne neuve : `grant select` sur
-- la table couvre déjà `verifie_le`, et redonner la liste ici garde la migration
-- lisible seule.
revoke all on public.campagne_creations_instagram from anon, authenticated;
grant select on public.campagne_creations_instagram to anon, authenticated;
grant select, insert, update, delete on public.campagne_creations_instagram to service_role;

commit;
