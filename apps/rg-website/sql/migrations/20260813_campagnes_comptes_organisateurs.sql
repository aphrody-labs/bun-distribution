-- L'ANNONCE D'UNE CAMPAGNE N'EST PAS UNE CRÉATION DE LA CAMPAGNE.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260813_campagnes_comptes_organisateurs.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUI S'EST PASSÉ
-- ─────────────────────────────────────────────────────────────────────────────
-- Le tweet qui LANCE une campagne porte son hashtag ET son affiche. La récolte X
-- ne fait la différence avec une participation, elle a donc retenu
-- `https://x.com/rose_griffon/status/2087918181033574427` — l'annonce d'IERG Day,
-- publiée par l'association elle-même — comme première « création » du mur.
-- Résultat mesuré le 13/8/2026, quelques minutes après l'ouverture : la page
-- publique affichait « 1 création, 1 participant » alors que personne n'avait
-- encore participé, et la vignette montrait l'affiche déjà publiée juste
-- au-dessus comme `image_affiche`.
--
-- Le pendant Discord de cette règle existe depuis le 12/8/2026
-- (`packages/cron/src/tasks/campagnes-discord.ts` : les salons d'annonces, type 5,
-- sont écartés — même raisonnement, même phrase dans le commentaire). Il
-- manquait côté X.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI EN BASE ET PAS EN DUR DANS LE CODE
-- ─────────────────────────────────────────────────────────────────────────────
-- Les comptes organisateurs changent d'une opération à l'autre : une campagne
-- co-organisée avec un autre serveur en déclarerait deux, une campagne relayée
-- par le compte du wiki en déclarerait trois. Comme `salons_depot`, c'est une
-- donnée de campagne, pilotable depuis `/admin/iergday` sans déploiement.
--
-- ⚠ LA RÈGLE DOIT RESTER ÉTROITE. Élargir « par prudence » (écarter tous les
-- comptes vérifiés, tous les comptes de l'association…) ne serait pas prudent :
-- ce serait faire disparaître la création d'un membre sans que personne ne le
-- sache — ni lui, ni nous. Seuls les comptes explicitement déclarés sont écartés.
--
-- REJOUABLE : `add column if not exists`, et l'UPDATE ne touche que les lignes
-- encore vides.

begin;

alter table public.x_campagnes
	add column if not exists comptes_organisateurs text[] not null default '{}';

comment on column public.x_campagnes.comptes_organisateurs is
	'Comptes X de l''organisateur (pseudos, sans @). Leurs publications ne sont jamais récoltées comme créations : ce sont les annonces de la campagne.';

-- La campagne en cours est annoncée par @rose_griffon (compte X de l'association,
-- cf. `apps/website/src/lib/social-config.ts`). Le compte Instagram
-- `@rose_griffonfr` n'a pas à figurer ici : la table Instagram se remplit par
-- dépôt manuel, où l'annonce ne passe pas.
update public.x_campagnes
   set comptes_organisateurs = array['rose_griffon'], updated_at = now()
 where slug = 'iergday' and comptes_organisateurs = '{}';

commit;
