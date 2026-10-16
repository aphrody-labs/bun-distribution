-- Les cinq campagnes ARCHIVÉES de /iergday reprennent leur contenu réel.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_04_campagnes_archivees_reelles.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────
-- `20260812_01_campagnes_x.sql` a semé cinq lignes d'archive (Inazuma RG 1 et 2,
-- Inatober RG 2023, 2024, 2025) AVANT d'avoir lu quoi que ce soit de ces
-- campagnes. Leurs valeurs étaient donc des suppositions, et l'écran le montrait :
--   • `hashtags_affichage` vide -> la page annonçait « #inazumarg » là où
--     l'association a écrit « #inazumaRG » ;
--   • une `description` générique, RIGOUREUSEMENT IDENTIQUE pour les trois
--     Inatober (« Un mois, une liste de thèmes, un dessin par jour ») alors que
--     chaque édition annonce noir sur blanc un thème différent — saison 1, puis
--     saison 2, puis saison 3 (FFI) ;
--   • `reglement` à '{}' : aucune des consignes réellement écrites ;
--   • `debut_le`/`fin_le` arrondis à la louche (« 2023-08-01 -> 2023-09-15 ») ;
--   • aucun visuel.
--
-- Cette migration remplace ces suppositions par ce qui a été MESURÉ le 12/8/2026
-- dans `public.discord_messages` (salon `🚨〡annonces`, id `1073227462500163626`).
-- Chaque valeur ci-dessous cite l'identifiant du message qui la porte. Rien n'est
-- déduit sans le dire, et ce qui n'a pas été écrit reste vide : les campagnes
-- archivées n'ont pas de « carte Règles » (`image_reglement` reste NULL) et aucun
-- chiffre de participation n'est avancé — aucun n'a été compté.
--
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI :
--   • `titre`, `sur_titre` : déjà exacts, hors du défaut constaté.
--   • `requetes` : mesuré le 12/8/2026 — AUCUN des 12 998 tweets de
--     `public.tweets` ne porte `#inazumarg`, `#inatoberrg*` ni `#iergday`. La
--     récolte X ne peut rien remonter pour ces cinq campagnes (leurs créations
--     vivent sur Discord et Instagram). Changer les requêtes ne changerait rien ;
--     `actif = false` les tient de toute façon hors de la récolte.
--   • `iergday` et `inazuma-day-2026` : déjà justes (cf.
--     20260812_03_campagne_iergday_reelle.sql et 20260812_02_campagnes_hashtags_affichage.sql).
--     Aucune instruction de ce fichier ne les vise.
--
-- REJOUABLE : chaque UPDATE est gardé par `… is distinct from …` sur l'ensemble
-- des colonnes écrites — un second passage ne touche aucune ligne (0 rows) et
-- n'avance donc pas `updated_at`. Le garde `c.hashtags = array[…]` vérifie en
-- prime qu'on écrit bien sur la campagne attendue : si un slug était recyclé pour
-- un autre hashtag, l'UPDATE ne ferait rien plutôt que d'écraser un inconnu.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CASSE DES HASHTAGS : comptée, pas choisie
-- ─────────────────────────────────────────────────────────────────────────────
--   select m[1], count(*) from discord_messages t
--   cross join lateral regexp_matches(t.content,
--     '#([A-Za-z0-9]*(?:inazuma|inatober|inktober|ierg)[A-Za-z0-9]*)','gi') m
--   group by 1 order by 2 desc;
--   -> inazumaRG 3 | InatoberRG2023 2 | InazumaRG 2 | InazumaRG2 1
--      | inatoberRG2025 1 | InatoberRG2024 1
-- `hashtags_affichage` ne peut PAS dériver : la contrainte
-- `x_campagnes_affichage_aligne` exige `lower(hashtags_affichage::text) =
-- hashtags::text`, donc même liste, même ordre, à la casse près. Les cinq valeurs
-- posées ici la respectent (`hashtags` vaut déjà `{inazumarg}`, `{inatoberrg2023}`,
-- `{inazumarg2}`, `{inatoberrg2024}`, `{inatoberrg2025}`).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FUSEAU : les bornes sont écrites en heure de Paris
-- ─────────────────────────────────────────────────────────────────────────────
-- `iergday` est stocké en heure locale française (fin « 22 août 2026 23h59 (FR) »
-- = 2026-08-22 21:59:59+00). On s'aligne. Les bornes sont donc écrites
-- `timestamp '…' at time zone 'Europe/Paris'` plutôt qu'avec un décalage en dur :
-- octobre CHANGE d'heure en son milieu (dernier dimanche du mois), un `+02` figé
-- décalerait d'une heure le 31 octobre. Postgres résout le décalage correct pour
-- chaque date.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VISUELS : URL du bucket public `assets`
-- ─────────────────────────────────────────────────────────────────────────────
-- Même convention que `iergday` : `campagnes/<slug>/<clé>.webp` (+ un jumeau
-- `-original.webp` conservé à côté), servi par l'origine du site — nginx expose
-- `/storage/v1/` via `supabase-compat.inc`, donc zéro cross-origin, et
-- `rosegriffon.fr` est déjà dans `images.remotePatterns`. Les pièces jointes
-- Discord d'origine ne peuvent PAS être publiées telles quelles : leurs URL sont
-- signées (`ex=`/`is=`/`hm=`) et expirent.
-- `image_affiche` = le document officiel de la campagne (affiche de lancement pour
-- les Inazuma RG, liste des thèmes pour les Inatober), montré entier.
-- `image_couverture` = la bannière du haut de page, recadrée.
-- `image_reglement` reste NULL : aucune de ces cinq campagnes n'a publié de carte
-- « Règles » distincte — le règlement était écrit dans le message d'annonce, et
-- c'est ce texte qui est repris dans `reglement`.
--
-- ÉTAT MESURÉ DU BUCKET au 13/8/2026 00h20, après application :
--   affiche.webp    -> 200 pour les CINQ campagnes ;
--   couverture.webp -> 200 pour `inazuma-rg` seulement ; 404 pour les quatre
--                      autres, dont l'objet n'a pas (encore) été téléversé.
-- Les URL manquantes sont écrites QUAND MÊME, volontairement : elles décrivent
-- l'emplacement attendu, et le jour où le fichier arrive la page l'affiche sans
-- qu'une migration soit rejouée. Le coût est borné et connu : `PageShell` rend
-- alors un bandeau sans image (`/_next/image` renvoie 404 sur l'origine
-- manquante) — la page elle-même répond 200, vérifié. Si le visuel ne devait
-- jamais exister, c'est `image_couverture = null` qu'il faudrait poser, pour
-- retrouver le dégradé de repli du bandeau.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Inazuma RG — 1ʳᵉ édition, août 2023
-- ─────────────────────────────────────────────────────────────────────────────
-- Sources :
--   `1136329183199514734` (2023-08-02 18h06 Paris) — annonce de lancement,
--       pièce jointe `exp0.png` ; porte le hashtag ET les trois consignes.
--   `1137058997879443498` (2023-08-04) — 8 fonds `BG_39..46` : les maillots et le
--       survêtement en haute qualité, annoncés par le message précédent.
--   `1147292232970416159` (2023-09-02 00h09 Paris) — clôture : « c'est
--       officiellement la fin du InazumaRG ».
--   `1149788549563031603` (2023-09-08) — `inazuma_affiche_remerciement_rg.png`
--       2400×3000, l'affiche qui réunit toutes les participations.
--   `1150448205956382815` (2023-09-10) — `RG_challenge_banniere.png` 3000×1500,
--       illustration bannière : d'où vient `couverture.webp`.
--
-- CASSE : `inazumaRG` (3 occurrences) l'emporte sur `InazumaRG` (2) — et surtout
-- ce sont les DEUX phrases impératives de l'annonce (« nous lançons le
-- #inazumaRG », « partagez-nous vos créations avec le hashtag #inazumaRG ») qui
-- l'écrivent ainsi ; `InazumaRG` n'apparaît qu'après la clôture, dans des
-- messages de remerciement.
--
-- DATES : début = 2023-08-02, jour de l'annonce de lancement — et non le 1er août
-- que disait la base : rien n'a été annoncé avant, « le challenge dure tout le
-- mois d'Aout » décrit la durée, pas une ouverture le 1er. Fin = 2023-08-31
-- 23h59:59, terme du mois d'août ; la clôture est annoncée dans la nuit suivante.
-- L'ancienne borne de fin (2023-09-15) n'était sourcée nulle part.
update public.x_campagnes c
   set hashtags_affichage = v.hashtags_affichage,
       description        = v.description,
       reglement          = v.reglement,
       debut_le           = v.debut_le,
       fin_le             = v.fin_le,
       image_affiche      = v.image_affiche,
       image_couverture   = v.image_couverture,
       actif              = false,   -- campagne terminée : plus rien à récolter
       updated_at         = now()
  from (select
          array['inazumaRG']::text[] as hashtags_affichage,

          -- Écrite à partir de l'annonce `1136329183199514734` et de l'affiche de
          -- remerciement `1149788549563031603`. Aucun chiffre de participation :
          -- aucun n'a été compté.
          'Première campagne communautaire de l''association : porter les couleurs de Rose Griffon FR en dessinant qui l''on veut — soi-même, un OC, un personnage déjà existant — avec le maillot de l''équipe. Les designs des maillots et du survêtement ont été publiés avec l''annonce, le 2 août 2023. Le challenge a duré tout le mois d''août, à l''issue duquel les participations ont été réunies dans une grande affiche de remerciement.'::text as description,

          -- Les trois consignes de l'annonce, reformulées au plus près. Rien de
          -- plus : le message ne parle ni de salon de dépôt, ni d'un nombre de
          -- participations, ni d'une interdiction quelconque.
          array[
            'Portez les couleurs de Rose Griffon FR : dessinez qui vous voulez — vous-même, un OC, un personnage déjà existant — avec le maillot de l''équipe.',
            'Partagez-nous vos créations avec le hashtag #inazumaRG.',
            'Le challenge dure tout le mois d''août.'
          ]::text[] as reglement,

          (timestamp '2023-08-02 00:00:00' at time zone 'Europe/Paris') as debut_le,
          (timestamp '2023-08-31 23:59:59' at time zone 'Europe/Paris') as fin_le,

          -- Affiche = `exp0.png` du message de lancement ; bannière =
          -- `RG_challenge_banniere.png` (3000×1500, format d'une bannière).
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inazuma-rg/affiche.webp'::text as image_affiche,
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inazuma-rg/couverture.webp'::text as image_couverture
       ) v
 where c.slug = 'inazuma-rg'
   and c.hashtags = array['inazumarg']
   and (c.hashtags_affichage, c.description, c.reglement, c.debut_le, c.fin_le,
        c.image_affiche, c.image_couverture, c.actif)
       is distinct from
       (v.hashtags_affichage, v.description, v.reglement, v.debut_le, v.fin_le,
        v.image_affiche, v.image_couverture, false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Inatober RG 2023 — octobre 2023, thèmes de la SAISON 1
-- ─────────────────────────────────────────────────────────────────────────────
-- Sources :
--   `1152289058890977280` (2023-09-15) — annonce, pièce jointe
--       `F6FH69rXIAA6gzp.png` = la liste des thèmes ; porte le hashtag,
--       « toute forme d'art est acceptée » et le code couleur jaune/bleu.
--   `1157981993494130838` (2023-10-01) — ouverture, même image ; porte
--       « vous n'êtes pas obligé de faire tous les jours », le choix d'un ou des
--       deux thèmes du jour, et « sur Twitter(X) ou bien Instagram ».
--   Le THÈME de l'édition n'est pas écrit dans ces deux messages : il l'est dans
--   l'annonce de 2024 (`1290343058793173042`), « L'an dernier nous avions choisi
--   de proposer des thèmes autour de la saison 1 ». C'est la source de la mention
--   « saison 1 » ci-dessous.
--
-- CASSE : `InatoberRG2023`, seule écriture relevée (2 fois, dont l'annonce).
-- DATES : le mois d'octobre entier. La base disait « -> 2023-11-15 » : inventé.
update public.x_campagnes c
   set hashtags_affichage = v.hashtags_affichage,
       description        = v.description,
       reglement          = v.reglement,
       debut_le           = v.debut_le,
       fin_le             = v.fin_le,
       image_affiche      = v.image_affiche,
       image_couverture   = v.image_couverture,
       actif              = false,
       updated_at         = now()
  from (select
          array['InatoberRG2023']::text[] as hashtags_affichage,

          -- Ce que cette édition-CI demandait. Les trois Inatober ne partagent
          -- plus une ligne de texte : c'est le défaut que cette migration répare.
          'Premier Inatober de l''association : une liste de thèmes maison pour le mois d''octobre, bâtie autour de la saison 1 d''Inazuma Eleven. Chaque jour propose plusieurs thèmes — en jaune ceux liés à la licence, en bleu les plus globaux — et rien n''oblige à tenir les trente-et-un jours. Toute forme d''art est acceptée : dessin, edit, fanfic, cosplay.'::text as description,

          array[
            'Toute forme d''art est acceptée : un dessin, un edit, une fanfic, un cosplay…',
            'N''oubliez pas de mettre le #InatoberRG2023 quand vous postez, que ce soit sur Twitter (X) ou bien Instagram.',
            'Vous n''êtes pas obligé de faire tous les jours : choisissez les jours que vous voulez faire.',
            'Chaque jour propose plusieurs thèmes : choisissez-en un, ou faites une création qui comprend les deux.',
            'Les thèmes en jaune sont liés à Inazuma Eleven, ceux en bleu sont plus globaux.'
          ]::text[] as reglement,

          (timestamp '2023-10-01 00:00:00' at time zone 'Europe/Paris') as debut_le,
          -- 2023-10-31 : la France est repassée à UTC+1 le 29 octobre. D'où le
          -- `at time zone` plutôt qu'un `+02` en dur.
          (timestamp '2023-10-31 23:59:59' at time zone 'Europe/Paris') as fin_le,

          -- L'affiche EST la liste des thèmes : c'est le seul visuel publié, et
          -- c'est le document de référence du participant.
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2023/affiche.webp'::text as image_affiche,
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2023/couverture.webp'::text as image_couverture
       ) v
 where c.slug = 'inatober-rg-2023'
   and c.hashtags = array['inatoberrg2023']
   and (c.hashtags_affichage, c.description, c.reglement, c.debut_le, c.fin_le,
        c.image_affiche, c.image_couverture, c.actif)
       is distinct from
       (v.hashtags_affichage, v.description, v.reglement, v.debut_le, v.fin_le,
        v.image_affiche, v.image_couverture, false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Inazuma RG 2 — 2ᵉ édition, août 2024
-- ─────────────────────────────────────────────────────────────────────────────
-- Sources :
--   `1268993998148603950` (2024-08-02 20h09 Paris) — lancement, pièce jointe
--       `RG2v3.png` ; « le principe ne change pas », le hashtag, « du jour même
--       jusqu'au samedi 31 août inclus », et le lien vers le salon de dépôt.
--   `1279380328368046112` (2024-08-31) — dernier jour, `01_Annonce.png` :
--       « jusqu'à ce soir minuit », et la tolérance de 10 à 15 jours accordée sur
--       preuve d'avancement.
--   `1288530466428944385` (2024-09-25) — triptyque des participations
--       (`RG_TRIPTYQUE_…`, 3508×4961).
--
-- CASSE : `InazumaRG2`, seule écriture relevée.
-- DATES : 2024-08-02 (« à partir d'aujourd'hui ») -> 2024-08-31 23h59:59
-- (« jusqu'au samedi 31 août inclus », confirmé par « ce soir minuit »). La
-- tolérance de 10 à 15 jours ne déplace pas la borne : c'est une dérogation
-- individuelle, accordée en message privé, pas une prolongation de la campagne —
-- elle est dite dans le règlement, à sa place.
update public.x_campagnes c
   set hashtags_affichage = v.hashtags_affichage,
       description        = v.description,
       reglement          = v.reglement,
       debut_le           = v.debut_le,
       fin_le             = v.fin_le,
       image_affiche      = v.image_affiche,
       image_couverture   = v.image_couverture,
       actif              = false,
       updated_at         = now()
  from (select
          array['InazumaRG2']::text[] as hashtags_affichage,

          'Deuxième édition du challenge, lancée le 2 août 2024 pour le premier anniversaire de l''Inazuma RG. Le principe ne change pas : imaginer et dessiner qui l''on souhaite — OC, sona, personnage d''une autre série — dans les maillots dessinés par l''association. Débutants du crayon comme illustrateurs, tout le monde est invité à créer et partager, jusqu''au 31 août inclus. Les participations ont ensuite été réunies dans un triptyque.'::text as description,

          array[
            'Imaginez et dessinez qui vous le souhaitez dans notre maillot Rose Griffon : OCs, sonas, personnages d''autres séries.',
            'Venez créer et partager peu importe votre niveau, sous le #InazumaRG2.',
            'Le challenge commence le 2 août et court jusqu''au samedi 31 août inclus, minuit.',
            'Postez vos créations dans le salon dédié du Discord.',
            'Une création entamée mais non terminée le 31 août peut être achevée sous 10 à 15 jours, sur envoi d''une preuve d''avancement en message privé.'
          ]::text[] as reglement,

          (timestamp '2024-08-02 00:00:00' at time zone 'Europe/Paris') as debut_le,
          (timestamp '2024-08-31 23:59:59' at time zone 'Europe/Paris') as fin_le,

          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inazuma-rg-2/affiche.webp'::text as image_affiche,
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inazuma-rg-2/couverture.webp'::text as image_couverture
       ) v
 where c.slug = 'inazuma-rg-2'
   and c.hashtags = array['inazumarg2']
   and (c.hashtags_affichage, c.description, c.reglement, c.debut_le, c.fin_le,
        c.image_affiche, c.image_couverture, c.actif)
       is distinct from
       (v.hashtags_affichage, v.description, v.reglement, v.debut_le, v.fin_le,
        v.image_affiche, v.image_couverture, false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Inatober RG 2024 — octobre 2024, thèmes de la SAISON 2
-- ─────────────────────────────────────────────────────────────────────────────
-- Source unique : `1290343058793173042` (2024-09-30), pièce jointe
--   `20240930_inatober.png` = la liste des thèmes. Verbatim :
--   « L'an dernier nous avions choisi de proposer des thèmes autour de la saison
--   1 ; pour cette nouvelle édition nous avons donc préparé pleins d'idées
--   centrées sur la saison 2 ! », « Postez tout le long du mois vos créations
--   (dessin, édits, montage, fiction, ect) en nous mentionnant et en utilisant le
--   hashtag #InatoberRG2024 sur les réseaux (insta, twitter) ou ici dans
--   <#1153955426191278132> », « Les thèmes bleus sont plus généralistes et ceux
--   en jaunes sont spécialement centrés dans l'univers Inazuma ».
--
-- CASSE : `InatoberRG2024`, seule écriture relevée.
update public.x_campagnes c
   set hashtags_affichage = v.hashtags_affichage,
       description        = v.description,
       reglement          = v.reglement,
       debut_le           = v.debut_le,
       fin_le             = v.fin_le,
       image_affiche      = v.image_affiche,
       image_couverture   = v.image_couverture,
       actif              = false,
       updated_at         = now()
  from (select
          array['InatoberRG2024']::text[] as hashtags_affichage,

          'Deuxième Inatober maison : après une première liste centrée sur la saison 1, cette édition propose des thèmes tournés vers la saison 2. Les thèmes bleus sont plus généralistes, les jaunes spécialement centrés sur l''univers d''Inazuma Eleven — à chacun de choisir ceux qui l''inspirent le plus. Les créations, dessin comme édit, montage ou fiction, se postent tout au long du mois d''octobre 2024.'::text as description,

          array[
            'Postez tout le long du mois vos créations : dessin, édits, montage, fiction…',
            'Mentionnez-nous et utilisez le hashtag #InatoberRG2024 sur les réseaux (Instagram, Twitter), ou postez dans le salon dédié du Discord.',
            'Les thèmes bleus sont plus généralistes, les jaunes spécialement centrés dans l''univers Inazuma : choisissez ceux qui vous inspirent le plus.'
          ]::text[] as reglement,

          (timestamp '2024-10-01 00:00:00' at time zone 'Europe/Paris') as debut_le,
          (timestamp '2024-10-31 23:59:59' at time zone 'Europe/Paris') as fin_le,

          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2024/affiche.webp'::text as image_affiche,
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2024/couverture.webp'::text as image_couverture
       ) v
 where c.slug = 'inatober-rg-2024'
   and c.hashtags = array['inatoberrg2024']
   and (c.hashtags_affichage, c.description, c.reglement, c.debut_le, c.fin_le,
        c.image_affiche, c.image_couverture, c.actif)
       is distinct from
       (v.hashtags_affichage, v.description, v.reglement, v.debut_le, v.fin_le,
        v.image_affiche, v.image_couverture, false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Inatober RG 2025 — octobre 2025, thèmes de la SAISON 3 (FFI)
-- ─────────────────────────────────────────────────────────────────────────────
-- Source unique : `1422662293027815515` (2025-09-30), pièce jointe
--   `inatober_fr.png` = la liste des thèmes. Verbatim : « cette édition est
--   spécialement dans le thème de la saison 3 (FFI) », « Chaque jour deux thèmes
--   de création vous sont proposé : vous choisissez celui que vous préférez, le
--   jaune rassemblant les thèmes propres à la licence IE et le bleu se voulant
--   plus général », « en incluant le hashtag #inatoberRG2025 dans votre
--   publication et/ou bien dans le salon dédié <#1153955426191278132> ».
--
-- CASSE : `inatoberRG2025`, seule écriture relevée — minuscule initiale ASSUMÉE,
-- c'est ce que l'annonce écrit. On ne « corrige » pas l'association.
--
-- À NE PAS INVENTER : il n'y a PAS eu d'Inazuma RG en 2025. Message
-- `1413602936893739241` (2025-09-05) : « Pas de InazumaRG cette année ». Aucune
-- ligne n'est créée pour une édition qui n'a pas eu lieu.
update public.x_campagnes c
   set hashtags_affichage = v.hashtags_affichage,
       description        = v.description,
       reglement          = v.reglement,
       debut_le           = v.debut_le,
       fin_le             = v.fin_le,
       image_affiche      = v.image_affiche,
       image_couverture   = v.image_couverture,
       actif              = false,
       updated_at         = now()
  from (select
          array['inatoberRG2025']::text[] as hashtags_affichage,

          'Troisième Inatober maison, cette fois dans le thème de la saison 3 (FFI). Chaque jour, deux thèmes sont proposés : le jaune rassemble ceux propres à la licence Inazuma Eleven, le bleu se veut plus général — à chacun de choisir celui qu''il préfère. Les créations se partagent sur les réseaux, en mentionnant l''association, ou dans le salon dédié du Discord, tout au long du mois d''octobre 2025.'::text as description,

          array[
            'Chaque jour, deux thèmes de création vous sont proposés : choisissez celui que vous préférez — le jaune rassemble les thèmes propres à la licence Inazuma Eleven, le bleu se veut plus général.',
            'Postez votre art sur les réseaux en nous mentionnant et en incluant le hashtag #inatoberRG2025 dans votre publication.',
            'Vous pouvez aussi, ou à la place, poster dans le salon dédié du Discord.'
          ]::text[] as reglement,

          (timestamp '2025-10-01 00:00:00' at time zone 'Europe/Paris') as debut_le,
          (timestamp '2025-10-31 23:59:59' at time zone 'Europe/Paris') as fin_le,

          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2025/affiche.webp'::text as image_affiche,
          'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/inatober-rg-2025/couverture.webp'::text as image_couverture
       ) v
 where c.slug = 'inatober-rg-2025'
   and c.hashtags = array['inatoberrg2025']
   and (c.hashtags_affichage, c.description, c.reglement, c.debut_le, c.fin_le,
        c.image_affiche, c.image_couverture, c.actif)
       is distinct from
       (v.hashtags_affichage, v.description, v.reglement, v.debut_le, v.fin_le,
        v.image_affiche, v.image_couverture, false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Garde-fous : ce que la migration refuse de laisser passer
-- ─────────────────────────────────────────────────────────────────────────────
-- Une campagne archivée à la une, ou remise en récolte, serait une régression
-- silencieuse — la page d'accueil de /iergday afficherait un challenge clos de
-- 2023. On vérifie ici plutôt que d'espérer : la transaction échoue en bloc si
-- l'invariant est faux.
--
-- Le garde ne porte QUE sur les cinq archives. Il ne dit rien de la campagne
-- réellement à la une, qui changera (iergday ferme le 22 août 2026, une autre
-- prendra la vedette) : contraindre `principale = 'iergday'` rendrait ce fichier
-- irrejouable dès le mois prochain.
do $$
declare
	fautives text;
	vedette  text;
begin
	select string_agg(slug, ', ' order by slug) into fautives
	  from public.x_campagnes
	 where slug in ('inazuma-rg', 'inatober-rg-2023', 'inazuma-rg-2',
	                'inatober-rg-2024', 'inatober-rg-2025')
	   and (actif or principale);

	if fautives is not null then
		raise exception 'Campagnes archivées encore actives ou à la une : %', fautives;
	end if;

	select string_agg(slug, ', ' order by slug) into vedette
	  from public.x_campagnes where principale;
	raise notice 'Campagne à la une : %', coalesce(vedette, '(aucune)');
end
$$;

-- TEMPS RÉEL : on réaffirme le retrait des déclencheurs, comme
-- 20260812_03_campagne_iergday_reelle.sql. `rg_realtime_notify()` diffuse
-- `to_jsonb(NEW)` ENTIER sur un flux SSE NON authentifié : une campagne non
-- publiée y partirait entière.
drop trigger if exists rg_realtime_x_campagnes on public.x_campagnes;
drop trigger if exists rg_realtime_x_campagne_posts on public.x_campagne_posts;

commit;
