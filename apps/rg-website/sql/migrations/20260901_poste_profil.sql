-- Le poste du membre, comme sur une fiche de joueur du jeu.
--
-- La carte de profil reprend la composition d'Inazuma Eleven : nom, élément,
-- niveau… et poste. C'est la case qui manquait — celle qui affiche « DF » en
-- bleu sous le nom. Quatre valeurs, celles du jeu (`inagle_characters.position`
-- : Gardien, Défenseur, Milieu, Attaquant), stockées par leur abréviation.
--
-- `null` = non renseigné : la carte n'affiche alors pas de pastille plutôt que
-- d'attribuer un poste par défaut à quelqu'un qui n'en a pas choisi.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260901_poste_profil.sql

begin;

alter table public.profiles
	add column if not exists poste text
		constraint profiles_poste_valide check (poste is null or poste in ('GAR', 'DEF', 'MIL', 'ATT'));

grant select (poste) on public.profiles to anon, authenticated;

commit;
