-- Fiche personnage : sections encyclopédiques et numéro de maillot.
--
-- Ces colonnes sont lues par le service wiki et restent nullables afin de ne pas
-- modifier les lignes existantes. La migration est volontairement idempotente :
-- elle peut être rejouée sur le miroir et sur Supabase sans erreur.

ALTER TABLE public.inagle_characters
	ADD COLUMN IF NOT EXISTS wiki_sections jsonb;

ALTER TABLE public.inagle_characters
	ADD COLUMN IF NOT EXISTS uniform_number integer;

COMMENT ON COLUMN public.inagle_characters.wiki_sections IS
	'Sections encyclopédiques de la fiche : [{"title": "...", "content": "..."}].';
COMMENT ON COLUMN public.inagle_characters.uniform_number IS
	'Numéro de maillot affiché sur la fiche. NULL = inconnu.';

NOTIFY pgrst, 'reload schema';
