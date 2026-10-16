-- Retrait des bannières de campagne qui n'existent pas.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260813_01_campagnes_couvertures_inexistantes.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260812_04 a posé `image_couverture` sur les cinq campagnes archivées en
-- écrivant l'URL ATTENDUE par la convention de stockage, sans attendre que le
-- fichier soit réellement téléversé. Or il n'existe de bannière que pour
-- `inazuma-rg` (l'illustration tirée au sort du 10/9/2023, 3000×1500, message
-- Discord 1150448205956382815). Les quatre autres campagnes n'en ont jamais eu :
-- l'association n'a publié pour elles qu'une affiche, au format portrait, qui
-- porte du texte et ne peut pas être recadrée en bandeau sans le mutiler.
--
-- Mesuré le 13/8/2026, un `curl` par URL réellement posée en base :
--
--   inazuma-rg/couverture.webp        200 image/webp
--   iergday/couverture.webp           200 image/webp
--   inatober-rg-2023/couverture.webp  404 application/json
--   inatober-rg-2024/couverture.webp  404 application/json
--   inatober-rg-2025/couverture.webp  404 application/json
--   inazuma-rg-2/couverture.webp      404 application/json
--
-- Conséquence à l'écran : `apps/website/src/app/iergday/page.tsx:353` passe
-- l'URL au bandeau dès qu'elle est non NULL, et `:193-197` la déclare comme
-- image `openGraph`. Quatre campagnes sur sept servaient donc une image morte à
-- `next/image` ET l'annonçaient aux réseaux sociaux et aux moteurs de recherche.
-- Une URL qui répond 404 est pire qu'une absence : le composant a déjà un
-- rendu sans image (`image={... : undefined}`), sobre et complet.
--
-- On ne fabrique PAS de bannière de remplacement. Recadrer une affiche
-- portrait en bandeau couperait précisément ce qu'elle écrit (le hashtag, les
-- dates, la liste des thèmes) ; et le CDN du jeu n'a rien à voir avec ces
-- campagnes communautaires. Si l'association produit un jour ces bannières,
-- `scripts/campagnes/importer-visuels-discord.ts` les téléverse et un UPDATE
-- d'une ligne repose l'URL.
--
-- REJOUABLE : garde `is distinct from`, aucune ligne touchée au second passage.

begin;

update public.x_campagnes
   set image_couverture = null,
       updated_at       = now()
 where slug in ('inatober-rg-2023', 'inatober-rg-2024', 'inatober-rg-2025', 'inazuma-rg-2')
   and image_couverture is distinct from null;

commit;
