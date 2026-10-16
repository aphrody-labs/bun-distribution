-- Les badges de profil deviennent les quatre éléments du jeu.
--
-- ── CE QUI CHANGE ─────────────────────────────────────────────────────────
-- Le catalogue passe de cinq distinctions — « Fondateur », « VIP »,
-- « Bêta-testeur », « Patreon », « Staff » — aux quatre éléments d'Inazuma
-- Eleven : feu, vent, forêt, montagne. Ce n'est pas qu'un habillage : deux des
-- anciens badges affirmaient quelque chose de vérifiable (appartenir à
-- l'équipe, soutenir le projet) que rien ne vérifiait, si bien que n'importe
-- quel compte pouvait porter « Membre de l'équipe d'administration » à côté de
-- son pseudo. Un élément ne prétend à rien — c'est une couleur, comme dans le
-- jeu où chaque joueur en a une.
--
-- ── POURQUOI NETTOYER PLUTÔT QUE LAISSER ──────────────────────────────────
-- Cinq profils portaient un ancien badge (`staff`, `founder`, `vip`, `beta`).
-- Ces valeurs ne s'affichent plus : la table de rendu ne les connaît pas. Le
-- code, lui, les ÉCARTE désormais au lieu de les refuser — sans quoi ces cinq
-- personnes auraient vu « Données invalides » au premier enregistrement, sur un
-- champ devenu invisible pour elles. La base est nettoyée pour la même raison :
-- une donnée qui n'a plus de sens nulle part n'a pas à survivre en silence.
--
-- Le rôle, lui, reste dans `profiles.role` et s'affiche toujours à côté du
-- pseudo (« Administrateur », « Modérateur »…) : l'information « c'est un
-- membre de l'équipe » n'est pas perdue, elle est simplement dite par la seule
-- source qui la connaisse vraiment.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260901_badges_elements.sql

begin;

-- Ne garde que les identifiants du nouveau catalogue. `array_remove` ne suffit
-- pas (il faudrait l'appeler par valeur retirée) : on reconstruit le tableau à
-- partir de la liste blanche, ce qui reste juste même si d'autres valeurs
-- traînent.
update public.profiles
   set badges = coalesce(
         (
           select array_agg(badge order by ordinalite)
             from unnest(badges) with ordinality as t(badge, ordinalite)
            where badge in ('fire', 'wind', 'forest', 'mountain')
         ),
         '{}'::text[]
       ),
       updated_at = now()
 where badges is not null
   and exists (
         select 1
           from unnest(badges) as badge
          where badge not in ('fire', 'wind', 'forest', 'mountain')
       );

commit;
