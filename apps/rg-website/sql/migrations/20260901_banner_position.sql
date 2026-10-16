-- Le cadrage vertical de la bannière de profil.
--
-- ── POURQUOI UNE COLONNE ET PAS UN RECADRAGE À L'ENREGISTREMENT ───────────
-- Les illustrations du jeu font 3840×2160 ; une bannière de profil en montre
-- une bande large de quelques centaines de pixels de haut. Ce qui tombe dans
-- cette bande — un visage, un ballon, le vide au-dessus d'un stade — dépend de
-- l'image ET du goût de la personne. Découper le fichier à l'enregistrement
-- figerait ce choix et multiplierait les variantes en cache pour un réglage
-- qui se change en trois secondes.
--
-- La colonne garde donc une POSITION (0 = haut de l'image, 100 = bas), et
-- l'affichage la traduit en `object-position`. Le CDN continue de servir une
-- seule image par illustration, et changer son cadrage ne coûte rien.
--
-- Défaut 50 : le centre, ce que faisait `object-cover` avant ce réglage — les
-- bannières déjà choisies gardent donc exactement leur rendu actuel.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260901_banner_position.sql

begin;

alter table public.profiles
	add column if not exists banner_position smallint not null default 50
		constraint profiles_banner_position_bornes check (banner_position between 0 and 100);

-- Lisible publiquement comme le reste de la vitrine du profil : la fermeture
-- PII du 11/8/2026 protège l'e-mail et l'adresse, pas le cadrage d'une image.
grant select (banner_position) on public.profiles to anon, authenticated;

commit;
