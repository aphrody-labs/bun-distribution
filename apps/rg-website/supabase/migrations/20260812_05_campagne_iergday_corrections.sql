-- Corrections de la campagne IERG Day, après relecture adversariale de la page.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_05_campagne_iergday_corrections.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION CORRIGE, ET POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LA COQUILLE DE L'AFFICHE S'AFFICHAIT QUAND MÊME — deux fois.
--    Le confinement posé par 20260812_03_campagne_iergday_reelle.sql (hashtag de
--    rattrapage récolté mais jamais affiché) ne couvrait que des CHAMPS. Or :
--      a) la page publie l'affiche elle-même, et ce sont ses PIXELS qui portent la
--         consigne fautive — 0 occurrence dans le HTML ne veut pas dire 0 à
--         l'écran. D'où `note_affiche` : la rectification s'écrit À CÔTÉ de
--         l'image, seule façon de ne pas propager ce qu'on republie ;
--      b) le TEXTE des posts est rendu tel quel (extrait de carte, légende de la
--         visionneuse). Le premier participant qui recopie l'affiche aurait donc
--         reproduit la coquille sur notre page. D'où `x_masquer_hashtags()`,
--         appelée par `apps/website/src/lib/x-campagnes/queries.ts`, qui retire du
--         texte les seuls hashtags de rattrapage de LA campagne concernée — les
--         autres hashtags de l'auteur ne nous appartiennent pas et restent.
--
-- 2. LA DATE DE DÉBUT ÉTAIT UNE DÉDUCTION AFFICHÉE COMME UNE CERTITUDE.
--    20260812_03 posait `debut_le = 2026-07-22` en le disant noir sur blanc dans
--    son commentaire (« DÉDUCTION, PAS UNE DONNÉE. Aucun visuel ne l'écrit »),
--    mais l'écran, lui, rendait « Du 22 juillet 2026 au 22 août 2026 » au même
--    niveau que la date de fin, elle, écrite sur l'affiche. Un commentaire de
--    migration ne protège personne : la borne est remise à NULL, la page affiche
--    alors « Jusqu'au 22 août 2026 » — exact, et suffisant.
--    ⚠ Aucune conséquence sur la récolte : `requetes` porte `since:2026-07-01`,
--    volontairement plus large, et `debut_le` ne filtre RIEN. La campagne reste
--    « en cours » (`etatCampagne` : pas de début connu + fin future).
--    Si l'association donne la vraie date, un UPDATE d'une ligne la repose.
--
-- 3. LA DESCRIPTION PROMETTAIT LA GALERIE À TOUT LE MONDE, ET DÉPASSAIT 160.
--    « … postez une image mettant en scène un OC, elle rejoint la galerie » :
--    or la règle 1 accepte Instagram, que ce mur ne collecte pas — la page le dit
--    plus bas, mais la carte sociale et le résultat Google n'ont QUE cette phrase.
--    Elle faisait en prime 164 caractères pour une balise `description` coupée à
--    160. Nouvelle phrase : 153 caractères, sans promesse, avec l'échéance réelle.
--
-- 4. `inazuma-day-2026.sur_titre = 'Campagne en cours'` ÉTAIT UN ÉTAT FIGÉ EN BASE
--    alors que la pastille d'état, elle, est CALCULÉE. Le 1er septembre 2026, la
--    page aurait affiché « Campagne en cours » au-dessus de « Terminée ». Le
--    sur-titre reprend ce qu'est cette campagne (celle de LEVEL-5), pas où elle en
--    est.
--
-- 5. UNE RÈGLE COMPOSÉE D'ESPACES PASSAIT la contrainte `reglement_non_vide`
--    (`array['ok', ' ']` était accepté → puce numérotée vide à l'écran).
--
-- REJOUABLE : chaque UPDATE est gardé par `is distinct from`, les fonctions sont
-- en `create or replace`, les contraintes sont reposées à l'identique. Un second
-- passage ne touche aucune ligne et n'avance aucun `updated_at`.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Masquage des hashtags de rattrapage DANS LE TEXTE des publications
-- ─────────────────────────────────────────────────────────────────────────────
-- Prend le texte et la liste des variantes tues de la campagne ; rend le texte
-- sans elles. `hashtags_rattrapage` n'est ainsi jamais RENVOYÉE à l'application :
-- elle n'entre qu'en argument, ce qui laisse intacte la garantie posée par
-- `queries.ts` (« la page n'a aucun moyen d'afficher cette colonne »).
--
-- `\M` (fin de mot) évite de mordre sur un hashtag plus long qui commencerait par
-- la variante ; l'échappement des métacaractères protège d'un hashtag contenant
-- un caractère spécial de regex. Les espaces doubles laissées par le retrait sont
-- refermées, sinon l'extrait afficherait un trou.
create or replace function public.x_masquer_hashtags(texte text, tags text[])
returns text
language sql
immutable
as $fn$
	with motif as (
		select '#(' || string_agg(regexp_replace(tag, '([\^$.|?*+()\[\]{}\\])', '\\\1', 'g'), '|')
		       || ')\M' as expression
		  from unnest(tags) as tag
		 where tag is not null and btrim(tag) <> ''
	)
	select case
		when texte is null then texte
		when (select expression from motif) is null then texte
		else btrim(regexp_replace(
			regexp_replace(texte, (select expression from motif), '', 'gi'),
			'[ \t]{2,}', ' ', 'g'))
	end
$fn$;

comment on function public.x_masquer_hashtags(text, text[]) is
	'Retire d''un texte de publication les hashtags de rattrapage d''une campagne (variantes récoltées mais jamais affichées). Appelée par les lectures publiques de /iergday.';

-- Pas de RPC involontaire : PostgREST expose toute fonction du schéma `public`
-- exécutable par `anon`. Celle-ci n'a aucune raison d'être appelable depuis
-- l'extérieur — les lectures de la page passent par le rôle propriétaire.
revoke execute on function public.x_masquer_hashtags(text, text[]) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Une règle ne peut plus être « vide » au sens large
-- ─────────────────────────────────────────────────────────────────────────────
-- L'ancienne contrainte ne rejetait que la chaîne STRICTEMENT vide (`@> array['']`)
-- et le NULL : `array['ok', ' ']` passait, et rendait une puce numérotée sans
-- texte. Un CHECK n'accepte pas de sous-requête, d'où la fonction — IMMUTABLE, et
-- laissée exécutable par tous : elle est évaluée à chaque écriture, quel que soit
-- le rôle qui écrit.
create or replace function public.x_regles_non_vides(regles text[])
returns boolean
language sql
immutable
as $fn$
	select coalesce(bool_and(regle is not null and btrim(regle) <> ''), true)
	  from unnest(regles) as regle
$fn$;

comment on function public.x_regles_non_vides(text[]) is
	'Vrai si aucune règle n''est NULL ni composée uniquement d''espaces. Sert la contrainte x_campagnes_reglement_non_vide.';

alter table public.x_campagnes drop constraint if exists x_campagnes_reglement_non_vide;
alter table public.x_campagnes add constraint x_campagnes_reglement_non_vide
	check (public.x_regles_non_vides(reglement));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La rectification affichée sous l'affiche
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.x_campagnes
	add column if not exists note_affiche text;

comment on column public.x_campagnes.note_affiche is
	'Avertissement éditorial affiché SOUS l''affiche officielle (coquille, information périmée…). Le texte d''une image ne se corrige pas en base : on le rectifie à côté.';

alter table public.x_campagnes drop constraint if exists x_campagnes_note_affiche_non_vide;
alter table public.x_campagnes add constraint x_campagnes_note_affiche_non_vide
	check (note_affiche is null or btrim(note_affiche) <> '');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. IERG Day : description, note d'affiche, borne de début
-- ─────────────────────────────────────────────────────────────────────────────
-- La note ne CITE PAS la coquille — l'écrire la propagerait, ce que tout le
-- dispositif cherche à éviter. Elle dit ce qui est vrai : quel hashtag fait foi,
-- et que les participations portant la variante de l'affiche comptent quand même
-- (c'est exactement ce que fait le rattrapage silencieux côté récolte).
update public.x_campagnes
   set description  = 'Célébrons les 18 ans de la licence et les 3 ans de Rose Griffon avec une grande fresque : postez une image mettant en scène un OC, d''ici le 22 août 2026.',
       note_affiche = 'L''affiche porte une coquille : le hashtag officiel est #IERGDay, celui de la carte « Règles ». Les créations publiées avec la variante de l''affiche sont malgré tout collectées.',
       debut_le     = null,
       updated_at   = now()
 where slug = 'iergday'
   and (description, note_affiche, debut_le) is distinct from (
        'Célébrons les 18 ans de la licence et les 3 ans de Rose Griffon avec une grande fresque : postez une image mettant en scène un OC, d''ici le 22 août 2026.',
        'L''affiche porte une coquille : le hashtag officiel est #IERGDay, celui de la carte « Règles ». Les créations publiées avec la variante de l''affiche sont malgré tout collectées.',
        null::timestamptz);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Inazuma Day 2026 : un sur-titre qui ne périme pas
-- ─────────────────────────────────────────────────────────────────────────────
update public.x_campagnes
   set sur_titre  = 'Campagne LEVEL-5',
       updated_at = now()
 where slug = 'inazuma-day-2026'
   and sur_titre is distinct from 'Campagne LEVEL-5';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Garde-fous : on vérifie, on ne suppose pas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
	essai       text;
	longueur    int;
	sans_visuel int;
begin
	-- Le masquage fait-il vraiment ce qu'il annonce ? (le seul chemin par lequel
	-- la coquille pouvait encore atteindre l'écran)
	essai := public.x_masquer_hashtags(
		'Mon OC pour la fresque #InazumaRGday #IERGDay ! #InazumaEleven',
		array['inazumargday']);
	if essai <> 'Mon OC pour la fresque #IERGDay ! #InazumaEleven' then
		raise exception 'x_masquer_hashtags : résultat inattendu « % »', essai;
	end if;

	-- Un hashtag plus long qui COMMENCE par la variante ne doit pas être mordu.
	essai := public.x_masquer_hashtags('#inazumargdaybis', array['inazumargday']);
	if essai <> '#inazumargdaybis' then
		raise exception 'x_masquer_hashtags : frontière de mot non respectée (« % »)', essai;
	end if;

	-- Sans rattrapage, le texte doit ressortir intact.
	if public.x_masquer_hashtags('#InazumaDay', '{}'::text[]) <> '#InazumaDay' then
		raise exception 'x_masquer_hashtags : texte altéré sans hashtag de rattrapage';
	end if;

	select length(description) into longueur
	  from public.x_campagnes where slug = 'iergday';
	if longueur > 160 then
		raise warning 'IERG Day : description à % caractères, la balise meta en coupe à 160.', longueur;
	end if;

	-- Une note d'affiche sans affiche ne s'afficherait nulle part.
	select count(*) into sans_visuel
	  from public.x_campagnes where note_affiche is not null and image_affiche is null;
	if sans_visuel > 0 then
		raise exception 'note_affiche renseignée sans image_affiche sur % campagne(s)', sans_visuel;
	end if;
end
$$;

-- TEMPS RÉEL : on réaffirme le retrait des déclencheurs (cf. 20260812_03 et _04).
-- `rg_realtime_notify()` diffuse `to_jsonb(NEW)` ENTIER sur un flux SSE NON
-- authentifié : une campagne non publiée y partirait entière.
drop trigger if exists rg_realtime_x_campagnes on public.x_campagnes;
drop trigger if exists rg_realtime_x_campagne_posts on public.x_campagne_posts;

commit;
