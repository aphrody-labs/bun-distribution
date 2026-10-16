-- La galerie d'une campagne ne montre plus deux fois le même dessin.
--
-- Application :
--   export PGPASSWORD=$(grep -oP 'postgresql://rg:\K[^@]+' ../rg/.env | head -1)
--   psql -h 127.0.0.1 -U rg -d rg -v ON_ERROR_STOP=1 -f apps/website/sql/migrations/20260823_02_galerie_privilegie_x.sql
--
-- REJOUABLE : `create or replace function` seul, aucune donnée touchée.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE ÇA RÉPARE
-- ─────────────────────────────────────────────────────────────────────────────
-- Quatre personnes ont publié le MÊME dessin sur X et sur Discord. La galerie,
-- qui lit l'union des trois sources, l'affichait donc DEUX FOIS : le mur de
-- l'IERG Day montrait 20 vignettes pour 16 dessins, et le compteur annonçait
-- 20 créations pour 14 personnes.
--
-- Ces doublons ne sont PAS détectables à l'octet : X ré-encode systématiquement
-- en JPEG, donc les 27 fichiers de la campagne ont 27 sha256 distincts. Ils ont
-- été établis à l'empreinte perceptuelle (dHash, pHash) puis confirmés à l'œil,
-- et matérialisés dans `x_campagne_oeuvres` : une ligne par ŒUVRE, la liste des
-- publications qui la portent, et laquelle on retient.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE FONCTION, ET PAS UNE CLAUSE RECOPIÉE TROIS FOIS
-- ─────────────────────────────────────────────────────────────────────────────
-- `SELECT_POSTS` (apps/website/src/lib/x-campagnes/queries.ts) est une union de
-- trois branches, et le fichier recopie volontairement les gardes de publication
-- dans chacune. Ici, recopier serait un piège : la clause est une sous-requête
-- sur du jsonb, et le jour où l'une des trois copies diverge, la galerie et le
-- COMPTEUR de la même page cesseraient de s'accorder — c'est exactement le bug
-- corrigé le 23/8/2026 au matin (l'en-tête annonçait 9 créations au-dessus d'une
-- galerie qui en montrait 20). Une définition, trois appels.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE LA FONCTION NE FAIT PAS
-- ─────────────────────────────────────────────────────────────────────────────
-- Elle ne décide pas quelle publication garder : `x_campagne_oeuvres` l'a déjà
-- décidé, avec son motif écrit en clair dans `motif_regroupement`. Elle ne
-- s'applique QU'AUX œuvres à plusieurs publications (`nb_creations > 1`) : une
-- campagne sans ligne dans cette table — les six campagnes archivées, et toute
-- campagne à venir tant que son roster n'est pas construit — n'est pas filtrée
-- du tout, et sa galerie reste exactement ce qu'elle était.

begin;

create or replace function public.x_creation_doublon_ecarte(
	p_campagne text,
	p_source text,
	p_identifiant text
) returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $fonction$
	select exists (
		select 1
		  from public.x_campagne_oeuvres o
		 where o.campagne_slug = p_campagne
		   -- Une œuvre publiée une seule fois n'a pas de doublon : on ne
		   -- déréférence même pas son tableau.
		   and o.nb_creations > 1
		   -- La publication RETENUE n'est jamais écartée, par construction.
		   and not (o.creation_gardee_source = p_source and o.creation_gardee_id = p_identifiant)
		   and exists (
		       select 1
		         from jsonb_array_elements(o.creations) as c
		        where c->>'source' = p_source
		          and c->>'identifiant' = p_identifiant
		   )
	);
$fonction$;

comment on function public.x_creation_doublon_ecarte(text, text, text) is
	'Vrai si cette publication porte une œuvre déjà représentée par une AUTRE publication retenue '
	'dans x_campagne_oeuvres. Sert à ne montrer qu''une fois un dessin posté sur plusieurs réseaux. '
	'Sans effet sur une campagne dont les œuvres n''ont pas été construites.';

-- La galerie publique s'exécute en rôle `anon` côté PostgREST, et en rôle
-- propriétaire côté Next : les deux doivent pouvoir appeler la fonction.
grant execute on function public.x_creation_doublon_ecarte(text, text, text)
	to anon, authenticated, service_role;

commit;

do $verif$
declare
	nb_ecartees int;
	nb_gardees int;
begin
	select count(*) filter (where public.x_creation_doublon_ecarte('iergday', 'discord', d.message_id)),
	       count(*) filter (where not public.x_creation_doublon_ecarte('iergday', 'discord', d.message_id))
	  into nb_ecartees, nb_gardees
	  from public.campagne_creations_discord d
	 where d.campagne_slug = 'iergday' and not d.masque;

	raise notice 'iergday : % création(s) Discord écartée(s) comme doublon, % gardée(s).',
		nb_ecartees, nb_gardees;

	if nb_ecartees <> 4 then
		raise warning 'ATTENDU 4 doublons Discord écartés pour iergday, trouvé %. '
			'Vérifier x_campagne_oeuvres avant de déployer.', nb_ecartees;
	end if;
end
$verif$;
