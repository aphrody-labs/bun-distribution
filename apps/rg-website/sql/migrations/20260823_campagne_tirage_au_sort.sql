-- Le tirage au sort d'une campagne : roster canonique, œuvres dédoublonnées, tirages vérifiables.
--
-- Application :
--   export PGPASSWORD=$(grep -oP 'postgresql://rg:\K[^@]+' ../rg/.env | head -1)
--   psql -h 127.0.0.1 -U rg -d rg -v ON_ERROR_STOP=1 -f apps/website/sql/migrations/20260823_campagne_tirage_au_sort.sql
--
-- REJOUABLE : `create table if not exists`, `create index if not exists`,
-- `drop constraint if exists` avant chaque `add constraint`, `drop trigger if exists`
-- avant chaque `create trigger`, `drop policy if exists` avant chaque `create policy`,
-- `create or replace function`, et un amorçage en `on conflict … do update`.
--
-- ⚠ POURQUOI `20260823` ET NON `20260822` : le fichier a été écrit et appliqué le
-- 23/8/2026 à 02:00 UTC (l'horloge du VPS, qui tourne en UTC, fait foi). Le préfixe
-- est la date de la migration, c'est la convention du répertoire. Et l'écart n'est
-- pas cosmétique : les migrations se rejouent dans l'ordre alphabétique, or
-- `20260822_campagne_tirage_au_sort.sql` se serait glissé AVANT
-- `20260822_iergday_participations_instagram.sql` (« c » < « i »), c'est-à-dire
-- avant que les deux créations Instagram d'orphelinalius n'existent — et l'amorçage
-- ci-dessous leur attribue deux œuvres.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI CINQ TABLES, ET PAS UNE COLONNE `gagnant` SUR `x_campagnes`
-- ─────────────────────────────────────────────────────────────────────────────
-- Un tirage au sort n'est pas un résultat, c'est une PREUVE. Écrire « le gagnant
-- est X » demande de croire celui qui l'écrit ; ces cinq tables permettent à un
-- tiers de refaire le calcul sans rien nous demander. Chacune répond à une
-- question distincte, et les fusionner ferait perdre exactement la propriété qui
-- rend le dispositif vérifiable :
--
--   1. `x_campagne_participants` — QUI est une personne. Une personne n'est pas
--      un compte : quatre participantes ont publié le même dessin sur Discord
--      PUIS sur X, et deux de ces liens (kittyshadow_/kittycaillou,
--      Fujo_Kiran/fujorin) étaient INVISIBLES à toute règle de pseudo. Sans cette
--      table, quatre humains auraient deux tickets.
--   2. `x_campagne_oeuvres` — CE QUI compte pour un ticket. L'unité n'est pas la
--      publication mais le DESSIN : 20 créations retenues ne font que 16 œuvres.
--   3. `x_campagne_tirages` — l'ENGAGEMENT, puis le tirage. ⚠ La ligne naît à
--      l'engagement, pas au tirage : `graine`, `balise_signature` et `effectue_le`
--      restent NULL jusqu'à ce que le round drand visé tombe. C'est tout
--      l'intérêt — le roster est gelé et son empreinte publiée AVANT que l'aléa
--      n'existe.
--   4. `x_campagne_tirage_entrees` — le GEL. Le roster tel qu'il était au moment
--      de l'engagement, puis `u`, `cle_tri`, `empreinte` et `rang` une fois tiré.
--      Sans elle, « l'empreinte du roster » ne serait vérifiable que par nous.
--   5. `x_campagne_tirage_gagnants` — le résultat, avec une clé étrangère vers
--      les entrées gelées : on ne PEUT PAS insérer un gagnant qui n'était pas
--      dans le roster gelé, ce n'est pas une discipline, c'est la structure.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI `cle` N'EST JAMAIS UN PSEUDO
-- ─────────────────────────────────────────────────────────────────────────────
-- Un pseudo change. Mesuré dans NOTRE corpus, sur un participant de cette
-- campagne même : `fujorin` a auto-déclaré en 2023 un handle X « Kiran_inazuma »
-- et publie aujourd'hui sous « Fujo_Kiran ». Ailleurs dans `tweets`, l'author_id
-- 1451855639592849409 porte deux handles historiques (« yukun_0073DQ » puis
-- « yukun073DQ ») : l'identifiant numérique, lui, survit.
-- La clé est donc `<plateforme>:<identifiant immuable>`, et le CHECK
-- `x_campagne_participants_cle_immuable` le rend STRUCTUREL : `x:2870776923`
-- passe, `x:San_La_Vraie` est refusé par la base.
-- ⚠ SEULE EXCEPTION, et c'est le point fragile de tout le dispositif :
-- `campagne_creations_instagram` n'a AUCUNE colonne d'identifiant numérique,
-- seulement `auteur_pseudo`. `instagram:orphelinalius` ne survivrait donc pas à
-- un changement de pseudo Instagram. Le jour où l'on tiendra un identifiant
-- numérique Instagram, c'est cette clé-là qu'il faudra migrer.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI AUCUN DELETE
-- ─────────────────────────────────────────────────────────────────────────────
-- Un `revoke delete` ne vaut RIEN ici : l'application se connecte en `rg`, qui est
-- PROPRIÉTAIRE des tables, donc exempté des droits comme de la RLS. Seul un
-- TRIGGER s'applique au propriétaire. `x_tirage_suppression_interdite()` est donc
-- posé `before delete … for each row` ET `before truncate … for each statement`
-- (un TRUNCATE contourne les triggers de ligne) sur les trois tables de tirage.
-- Un tirage abandonné s'ANNULE (`annule_le` + `motif_annulation`), il ne
-- s'efface pas : effacer une preuve, c'est la remplacer par une affirmation.
--
-- ⚠ CONSÉQUENCE ASSUMÉE : `x_campagnes … on delete cascade` devient IMPOSSIBLE
-- dès qu'une campagne a un tirage — la cascade déclenche le trigger, qui lève. La
-- procédure est : annuler le tirage, puis, si l'on tient vraiment à supprimer la
-- campagne, `alter table public.x_campagne_tirages disable trigger
-- x_campagne_tirages_pas_de_delete;` explicitement, à la main, en connaissance de
-- cause. C'est le but : supprimer une campagne tirée efface la preuve du tirage.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUI EST PUBLIC ET CE QUI NE L'EST PAS
-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC : `x_campagne_tirages` (liste blanche PAR COLONNE) et
-- `x_campagne_tirage_gagnants`, sous policy `publie and annule_le is null and
-- graine_origine = 'balise'`, croisée avec `x_campagnes.publiee`.
-- FERMÉ, RLS activée SANS AUCUNE policy et AUCUN grant à personne —
-- `service_role` compris : `x_campagne_participants`, `x_campagne_oeuvres`,
-- `x_campagne_tirage_entrees`.
--
-- La raison tient en une ligne de donnée réelle :
-- `identifiants` porte le lien `discord:683044704967065626 ↔
-- x:1481333548074344451 ↔ kittycaillou / kittyshadow_ / sigmimi`. Ce lien
-- inter-plateformes, PERSONNE ne l'a publié — c'est nous qui l'avons établi à
-- l'empreinte d'image et à une signature peinte dans l'illustration. L'exposer en
-- lecture publique par PostgREST publierait un graphe d'identités que quatre
-- participantes n'ont jamais rendu public. `motif_ineligible` et `notes` sont en
-- plus de la prose de modération nominative.
-- La vérifiabilité n'en souffre pas : le classement publié porte
-- `pseudo_affichage`, `poids`, `rang` et une clé PSEUDONYMISÉE
-- (`clePublique(slug, cle)`, 16 hex, fonction publique de `tirage.ts` — chacun
-- recompose la sienne depuis son propre identifiant).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MESURÉ LE 23/8/2026, EN BASE, AVANT D'ÉCRIRE UNE SEULE LIGNE
-- ─────────────────────────────────────────────────────────────────────────────
--   * PostgreSQL 18.6 ; 145 tables dans `public` ; AUCUNE des cinq tables de ce
--     fichier n'existait (`x_campagne_%` ne rendait que `x_campagnes`,
--     `x_campagne_posts`, `x_campagne_relais`, `x_campagne_curseurs`).
--   * `public.tg_set_updated_at()` existe déjà et pose `NEW.updated_at = now()` :
--     on la RÉUTILISE, on n'en écrit pas une seconde.
--   * Campagne `iergday` : `publiee = true`, `principale = true`,
--     `debut_le = NULL`, `fin_le = 2026-08-22 21:59:59+00`,
--     `hashtags = {iergday}`, `salons_depot = {1537458038623965194}`,
--     `comptes_organisateurs = {rose_griffon}`.
--   * Créations, clauses de visibilité RECOPIÉES À LA MAIN (le rôle `rg` est
--     propriétaire, la RLS ne le filtre pas) : X 9 / 0 masquée, Discord 10 /
--     1 masquée, Instagram 2 / 0. TOTAL 21 brutes, 1 masquée, 20 retenues.
--     La seule écartée est `discord:1537477294497468556`, le rappel du règlement
--     posté par le staff, `motif_masquage` déjà renseigné en base.
--   * Les autres filtres retirent ZÉRO ligne, et c'est vérifié et non supposé :
--     `a_media` vrai partout, `deleted_at is null` partout, `suivi` vrai partout,
--     aucune création hors fenêtre, et `comptes_organisateurs` n'en retire aucune
--     (le tweet d'annonce de @rose_griffon existe dans `tweets` mais n'a jamais
--     été rattaché à `x_campagne_posts`).
--   * 20 créations retenues → 27 images → 16 œuvres. Et le piège, mesuré :
--     les 27 images ont 27 SHA-256 DISTINCTS. Une déduplication octet à octet
--     trouve ZÉRO doublon et attribue 4 chances de trop, parce que X ré-encode
--     systématiquement en JPEG.
--   * `pg_default_acl` accorde `arwdDxtm` à `anon`, `authenticated` et
--     `service_role` sur toute table créée dans `public` PAR LE RÔLE `postgres`.
--     Ce fichier est appliqué en `rg`, qui n'a pas de default ACL — mais si
--     quelqu'un l'applique un jour en `postgres` (peer auth), les cinq tables
--     naîtraient en écriture publique. C'est le `revoke all` ci-dessous, posé
--     APRÈS les `create table`, qui referme ce cas.
--
begin;

-- ── 1. LES PERSONNES ───────────────────────────────────────────────────────
--
-- Une ligne = un HUMAIN, pas un compte. `sources` dit sur quelles plateformes on
-- l'a vu, `identifiants` porte les identités absorbées par une fusion.

create table if not exists public.x_campagne_participants (
	campagne_slug       text not null references public.x_campagnes(slug) on delete cascade,
	cle                 text not null,
	pseudo_affichage    text not null,
	sources             text[] not null default '{}',
	identifiants        jsonb  not null default '{}'::jsonb,
	nb_oeuvres          integer not null default 0,
	nb_creations_brutes integer not null default 0,
	premiere_le         timestamptz,
	derniere_le         timestamptz,
	eligible            boolean not null default true,
	motif_ineligible    text,
	fusionne_dans       text,
	notes               text,
	verrouille          boolean not null default false,
	construit_le        timestamptz not null default now(),
	updated_at          timestamptz not null default now(),
	primary key (campagne_slug, cle),
	foreign key (campagne_slug, fusionne_dans)
		references public.x_campagne_participants(campagne_slug, cle) on delete set null
);

-- Les CHECK vivent hors du `create table` : sur une base où la table existe déjà,
-- `create table if not exists` ne les poserait jamais. Drop-puis-add les rend
-- rejouables ET modifiables.
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_cle_immuable;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_pas_soi_meme;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_motif_si_ineligible;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_alias_sans_poids;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_sources;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_compteurs;
alter table public.x_campagne_participants drop constraint if exists x_campagne_participants_fenetre;

-- C'EST ICI que « la clé est un identifiant, jamais un pseudo » cesse d'être une
-- convention pour devenir une contrainte. Instagram est la seule plateforme à
-- accepter un pseudo, faute d'identifiant numérique en base (cf. l'en-tête).
alter table public.x_campagne_participants
	add constraint x_campagne_participants_cle_immuable
	check (cle ~ '^((discord|x):[0-9]{6,25}|instagram:[a-z0-9._]{1,30})$');

alter table public.x_campagne_participants
	add constraint x_campagne_participants_pas_soi_meme
	check (fusionne_dans is null or fusionne_dans <> cle);

-- Une personne écartée SANS motif est une décision cachée dans la donnée. La base
-- refuse qu'elle existe : l'écran d'admin exige donc un motif écrit, et le
-- journal d'audit en garde trace.
alter table public.x_campagne_participants
	add constraint x_campagne_participants_motif_si_ineligible
	check (eligible or (motif_ineligible is not null and btrim(motif_ineligible) <> ''));

-- Un alias ne porte AUCUN poids : ses œuvres ont été déplacées sur la ligne
-- canonique. Sans ce CHECK, une fusion mal appliquée laisserait le ticket des
-- deux côtés et donnerait deux chances au même humain — précisément ce que la
-- fusion venait d'empêcher.
alter table public.x_campagne_participants
	add constraint x_campagne_participants_alias_sans_poids
	check (fusionne_dans is null or nb_oeuvres = 0);

-- `<@` (arraycontained) est IMMUTABLE, donc admis dans un CHECK — contrairement à
-- `array_to_string()`, seulement STABLE, et à `unnest` en sous-requête, que
-- PostgreSQL refuse net (« cannot use subquery in check constraint »).
alter table public.x_campagne_participants
	add constraint x_campagne_participants_sources
	check (sources <@ array['x','discord','instagram']::text[]);

alter table public.x_campagne_participants
	add constraint x_campagne_participants_compteurs
	check (nb_oeuvres >= 0 and nb_creations_brutes >= 0 and nb_oeuvres <= nb_creations_brutes);

alter table public.x_campagne_participants
	add constraint x_campagne_participants_fenetre
	check (premiere_le is null or derniere_le is null or derniere_le >= premiere_le);

-- ⚠ ACYCLICITÉ DE `fusionne_dans` : LA CLÉ ÉTRANGÈRE NE SUFFIT PAS.
-- A→B et B→A satisfont parfaitement la FK, et un cycle rendrait
-- `participantsDuTirage()` incapable de dire qui porte le ticket. On n'écrit pas
-- un parcours récursif : on INTERDIT LA PROFONDEUR 2, ce qui rend tout cycle
-- impossible par construction — tout cycle contient un alias dont la cible est
-- elle-même un alias.
create or replace function public.x_participants_fusion_profondeur_1() returns trigger
language plpgsql set search_path to 'public','pg_catalog' as $$
begin
	if new.fusionne_dans is not null then
		-- (a) la cible doit être CANONIQUE
		if exists (select 1 from public.x_campagne_participants c
		            where c.campagne_slug = new.campagne_slug and c.cle = new.fusionne_dans
		              and c.fusionne_dans is not null) then
			raise exception 'Fusion en chaîne interdite : % pointe sur %, qui est déjà un alias.',
				new.cle, new.fusionne_dans using errcode = 'check_violation';
		end if;
		-- (b) personne ne doit pointer sur NEW, qui devient un alias
		if exists (select 1 from public.x_campagne_participants c
		            where c.campagne_slug = new.campagne_slug and c.fusionne_dans = new.cle) then
			raise exception 'Fusion en chaîne interdite : % est déjà la cible d''une fusion.',
				new.cle using errcode = 'check_violation';
		end if;
	end if;
	return new;
end; $$;

drop trigger if exists x_campagne_participants_fusion on public.x_campagne_participants;
create trigger x_campagne_participants_fusion
	after insert or update of fusionne_dans on public.x_campagne_participants
	for each row execute function public.x_participants_fusion_profondeur_1();

-- `tg_set_updated_at()` existe déjà en base (vérifiée ce jour) : on la réutilise.
drop trigger if exists x_campagne_participants_touch on public.x_campagne_participants;
create trigger x_campagne_participants_touch
	before update on public.x_campagne_participants
	for each row execute function public.tg_set_updated_at();

-- Index calqués sur les deux seules requêtes qui les servent : la liste des
-- personnes qui portent un ticket, et la résolution des alias.
create index if not exists x_campagne_participants_canoniques_idx
	on public.x_campagne_participants (campagne_slug, pseudo_affichage)
	where eligible and fusionne_dans is null;
create index if not exists x_campagne_participants_alias_idx
	on public.x_campagne_participants (campagne_slug, fusionne_dans)
	where fusionne_dans is not null;

comment on table public.x_campagne_participants is
	'Une ligne = un HUMAIN d''une campagne, pas un compte. Table FERMÉE (aucun grant, RLS sans policy) : identifiants porte un graphe d''identités inter-plateformes que personne n''a publié.';
comment on column public.x_campagne_participants.cle is
	'<plateforme>:<identifiant IMMUABLE> — jamais un pseudo (un pseudo change ; mesuré sur cette campagne même). Le CHECK …_cle_immuable le garantit. Instagram fait exception faute d''identifiant numérique en base : cette clé-là ne survivrait pas à un changement de pseudo.';
comment on column public.x_campagne_participants.identifiants is
	'Identités ABSORBÉES par une fusion (discord_id, x_id, instagram_pseudo, cle_lisible, preuve_fusion). reconstruireRoster() les lit pour ne pas ressusciter une identité déjà rattachée, ce qui rendrait deux tickets au même humain.';
comment on column public.x_campagne_participants.fusionne_dans is
	'Clé canonique qui absorbe cette ligne. Profondeur 1 UNIQUEMENT, imposée par trigger : la FK seule laisserait passer A→B→A.';
comment on column public.x_campagne_participants.verrouille is
	'Ligne arbitrée à la main : ni cette migration ni reconstruireRoster() n''y touchent. C''est le seul moyen qu''une décision humaine survive à une reconstruction automatique.';
comment on column public.x_campagne_participants.motif_ineligible is
	'Obligatoire dès que eligible = false (CHECK …_motif_si_ineligible). Prose de modération NOMINATIVE : jamais publique.';

-- ── 2. LES ŒUVRES ──────────────────────────────────────────────────────────
--
-- L'unité qui porte un ticket. Ce n'est PAS la publication : Munfurawa, Cieran et
-- kittycaillou ont publié DEUX fois le même dessin (Discord puis X) — une chance,
-- pas deux ; ThunderAce a envoyé 7 fichiers d'une seule séance — une ; Jenn
-- Scarlet a joint 2 fichiers d'un seul dessin — une.
--
-- ⚠ DEUX COLONNES QUI RÉPONDENT À DEUX QUESTIONS DIFFÉRENTES, à ne jamais
-- confondre :
--   * `creation_gardee_*` = la publication qui ATTESTE L'ÉLIGIBILITÉ. La règle 1
--     du règlement en base dit « Postez une image […] sur Twitter ou Instagram » :
--     c'est le post X ou Instagram qui compte, Discord n'étant que le salon de
--     dépôt. C'est vers elle que pointe le lien de l'annonce.
--   * `image_master_*` = le fichier LE MIEUX DÉFINI, quelle que soit sa source.
--     Mesuré sur les 4 groupes : le PNG Discord en G1 (1730x1440 sans perte
--     contre un JPEG de 206 Ko), G3 (2734x2269, 10,9 Mo contre 1,4 Mo) et G4
--     (1720x2428 contre 850x1200, deux fois plus défini), mais le JPEG X en G2
--     (4096x3459 contre 2558x2160 — la seule participante à avoir mis en ligne
--     une version PLUS définie sur X).
-- Servir un JPEG deux fois plus petit parce que « X compte » abîmerait le dessin
-- pour une raison administrative ; créditer Discord parce que le fichier y est
-- meilleur contredirait le règlement. Les deux colonnes existent pour n'avoir pas
-- à trancher entre les deux.

create table if not exists public.x_campagne_oeuvres (
	campagne_slug          text not null references public.x_campagnes(slug) on delete cascade,
	oeuvre_id              text not null,
	cle                    text not null,
	creation_gardee_source text not null,
	creation_gardee_id     text not null,
	creations              jsonb not null default '[]'::jsonb,
	nb_creations           smallint not null default 1,
	sha256                 text,
	dhash                  text,
	phash                  text,
	largeur                integer,
	hauteur                integer,
	image_master_source    text,
	image_master_id        text,
	image_master_index     smallint not null default 0,
	image_master_chemin    text,
	image_master_url       text,
	motif_regroupement     text,
	construit_le           timestamptz not null default now(),
	primary key (campagne_slug, oeuvre_id),
	foreign key (campagne_slug, cle)
		references public.x_campagne_participants(campagne_slug, cle) on delete cascade
);

alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_creations_tableau;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_nb_creations;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_gardee_source;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_id_derive;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_empreintes;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_master_source;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_master_index;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_master_affichable;
alter table public.x_campagne_oeuvres drop constraint if exists x_campagne_oeuvres_dimensions;

-- `jsonb_typeof` et `jsonb_array_length` sont IMMUTABLE : admis dans un CHECK.
alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_creations_tableau
	check (jsonb_typeof(creations) = 'array');

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_nb_creations
	check (nb_creations >= 1 and nb_creations = jsonb_array_length(creations));

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_gardee_source
	check (creation_gardee_source in ('x','discord','instagram'));

-- `oeuvre_id` est DÉRIVÉ, pas choisi : « <source>:<identifiant de la création
-- gardée> ». Déterministe, lisible dans un journal, et surtout idempotent — le
-- script d'empreintes peut être relancé sans créer de doublon d'œuvre.
alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_id_derive
	check (oeuvre_id = creation_gardee_source || ':' || creation_gardee_id);

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_empreintes
	check (
		(sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
		and (dhash is null or dhash ~ '^[0-9a-f]{16}$')
		and (phash is null or phash ~ '^[0-9a-f]{16}$')
	);

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_master_source
	check (image_master_source is null or image_master_source in ('x','discord','instagram'));

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_master_index
	check (image_master_index >= 0);

-- L'animation doit pouvoir MONTRER quelque chose : une source de master déclarée
-- sans chemin ni URL laisserait la carte gagnante vide au moment précis où tout
-- le monde regarde.
alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_master_affichable
	check (image_master_source is null or image_master_chemin is not null or image_master_url is not null);

alter table public.x_campagne_oeuvres
	add constraint x_campagne_oeuvres_dimensions
	check ((largeur is null or largeur > 0) and (hauteur is null or hauteur > 0));

-- Une création gardée ne peut fonder qu'UNE œuvre : sans cet index, un second
-- passage du script d'empreintes pourrait fabriquer deux œuvres sur le même post
-- et donner deux tickets.
create unique index if not exists x_campagne_oeuvres_gardee_unique
	on public.x_campagne_oeuvres (campagne_slug, creation_gardee_source, creation_gardee_id);
create index if not exists x_campagne_oeuvres_par_participant_idx
	on public.x_campagne_oeuvres (campagne_slug, cle);
create index if not exists x_campagne_oeuvres_doublons_idx
	on public.x_campagne_oeuvres (campagne_slug) where nb_creations > 1;

comment on table public.x_campagne_oeuvres is
	'Un DESSIN, pas une publication : 20 créations retenues d''iergday ne font que 16 œuvres. Table FERMÉE (aucun grant, RLS sans policy) : elle expose par sa clé le rattachement à une personne.';
comment on column public.x_campagne_oeuvres.oeuvre_id is
	'DÉRIVÉ : creation_gardee_source || '':'' || creation_gardee_id. Déterministe et idempotent, imposé par le CHECK …_id_derive.';
comment on column public.x_campagne_oeuvres.creation_gardee_source is
	'La publication qui ATTESTE l''éligibilité (règle 1 : « sur Twitter ou Instagram »). Rien à voir avec image_master_source, qui désigne le meilleur FICHIER.';
comment on column public.x_campagne_oeuvres.creation_gardee_id is
	'Identifiant de la création gardée dans sa source : tweet_id, message_id Discord, ou shortcode Instagram.';
comment on column public.x_campagne_oeuvres.image_master_source is
	'Source du fichier LE MIEUX DÉFINI, indépendamment de la création gardée : PNG Discord en G1/G3/G4, JPEG X en G2. C''est ce fichier que montre l''animation.';
comment on column public.x_campagne_oeuvres.image_master_index is
	'Index de l''image DANS la création (jsonb images). Vaut 1 pour discord:1540784107729064108 : le fichier 0 est un recadrage vertical du fichier 1.';
comment on column public.x_campagne_oeuvres.creations is
	'[{"source","identifiant"}] — TOUTES les publications de ce même dessin, la gardée comprise. C''est la trace de ce qui a été regroupé.';
comment on column public.x_campagne_oeuvres.sha256 is
	'Empreinte binaire du fichier MASTER. Ne sert PAS au dédoublonnage : les 27 images d''iergday ont 27 sha256 distincts, X ré-encodant systématiquement en JPEG.';

-- ── 3. LES TIRAGES ─────────────────────────────────────────────────────────
--
-- ⚠ LA LIGNE NAÎT À L'ENGAGEMENT, PAS AU TIRAGE. C'est tout l'intérêt du
-- dispositif : `empreinte_participants` et `empreinte_engagement` sont écrites et
-- publiées AVANT que le round drand visé n'existe, donc avant que quiconque —
-- nous compris — puisse connaître le résultat. `graine`, `empreinte_graine`,
-- `balise_signature` et `effectue_le` restent NULL jusqu'au tirage.
--
-- `empreinte_engagement` ne figurait PAS au cahier des charges initial, et c'est
-- délibéré qu'elle soit là : sans elle, le nombre de gagnants et les lots ne sont
-- couverts par rien. Or choisir N après avoir vu le classement, c'est choisir les
-- gagnants sans toucher une seule ligne du tirage. Elle est gelée par le trigger
-- d'immuabilité, et `executerEtEnregistrer()` REFUSE de tirer si elle ne se
-- recalcule pas à l'identique.

create table if not exists public.x_campagne_tirages (
	id                         uuid primary key default gen_random_uuid(),
	campagne_slug              text not null references public.x_campagnes(slug) on delete cascade,
	numero                     integer not null,
	graine                     text,
	empreinte_graine           text,
	empreinte_participants     text not null,
	empreinte_engagement       text not null,
	nb_participants            integer not null,
	nb_gagnants                integer not null,
	poids_mode                 text not null,
	parametres                 jsonb not null default '{}'::jsonb,
	graine_origine             text not null,
	balise_reseau              text,
	balise_chaine              text,
	balise_round               bigint,
	balise_signature           text,
	balise_recuperee_le        timestamptz,
	engagement_le              timestamptz not null default now(),
	engagement_message_id      text,
	effectue_par               uuid,
	effectue_le                timestamptz,
	publie                     boolean not null default false,
	publie_le                  timestamptz,
	annonce_discord_salon_id   text,
	annonce_discord_message_id text,
	annonce_le                 timestamptz,
	annule_le                  timestamptz,
	motif_annulation           text
);

alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_modes;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_empreintes;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_comptages;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_tire_coherent;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_balise_complete;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_balise_apres_engagement;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_balise_round;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_locale_jamais_publique;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_publie_coherent;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_annule_motive;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_annule_non_publie;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_annonce_coherente;
alter table public.x_campagne_tirages drop constraint if exists x_campagne_tirages_parametres_objet;

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_modes
	check (poids_mode in ('un_par_personne','par_oeuvre') and graine_origine in ('balise','locale'));

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_empreintes
	check (
		(graine is null or graine ~ '^[0-9a-f]{64}$')
		and (empreinte_graine is null or empreinte_graine ~ '^[0-9a-f]{64}$')
		and empreinte_participants ~ '^[0-9a-f]{64}$'
		and empreinte_engagement   ~ '^[0-9a-f]{64}$'
	);

-- `nb_gagnants <= nb_participants` : tirer 20 gagnants parmi 14 personnes est un
-- tirage sans remise impossible, pas un tirage généreux.
alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_comptages
	check (nb_participants >= 1 and nb_gagnants between 1 and 50 and nb_gagnants <= nb_participants);

-- Tiré, ou pas du tout. `num_nulls` est IMMUTABLE (vérifié sur cette base) : il
-- dit en une expression ce qu'une conjonction de trois `is null` dirait en six.
alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_tire_coherent
	check (num_nulls(graine, empreinte_graine, effectue_le) in (0,3));

-- Une balise drand incomplète, c'est un tirage invérifiable. On l'exige dès que
-- le tirage a EU LIEU (pas à l'engagement : à ce moment-là le round n'existe pas
-- encore, c'est le principe). Signature BLS sur G1 = 48 octets = 96 hex.
alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_balise_complete
	check (
		graine_origine <> 'balise' or effectue_le is null or (
			balise_reseau is not null
			and balise_chaine ~ '^[0-9a-f]{64}$'
			and balise_round is not null
			and balise_signature ~ '^[0-9a-f]{96}$'
			and balise_recuperee_le is not null
		)
	);

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_balise_apres_engagement
	check (balise_recuperee_le is null or balise_recuperee_le >= engagement_le);

-- ⚠ 0 EST LÉGITIME : c'est la sentinelle du mode `locale` (BALISE_LOCALE dans
-- tirage.ts, round 0, chaîne vide). Un `>= 1` casserait toute répétition. En mode
-- `balise`, c'est `recupererBalise()` qui refuse tout round < 1 avant le réseau —
-- `https://api.drand.sh/<chaine>/public/0` répond 200 avec le DERNIER round
-- publié, ce qui aurait dérivé une graine d'une balise que personne n'avait
-- engagée (mesuré le 23/8/2026).
alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_balise_round
	check (balise_round is null or balise_round >= 0);

-- ⚠ LA LIGNE LA PLUS IMPORTANTE DU FICHIER.
-- Un tirage en graine LOCALE est un JOURNAL, pas une preuve d'équité : c'est nous
-- qui tirons la graine, donc nous pourrions recommencer jusqu'à obtenir le
-- résultat voulu — mesuré, 28 884 tirages par seconde et 902 essais pour imposer
-- un trio exact. Il ne peut donc être ni publié ni annoncé, et c'est LA BASE qui
-- le refuse, pas le TSX : un garde-fou d'interface se contourne, une contrainte
-- non.
alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_locale_jamais_publique
	check (
		graine_origine <> 'locale'
		or (not publie and publie_le is null and annonce_discord_message_id is null and annonce_le is null)
	);

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_publie_coherent
	check (publie = (publie_le is not null) and (not publie or graine is not null));

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_annule_motive
	check (annule_le is null or (motif_annulation is not null and length(btrim(motif_annulation)) >= 10));

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_annule_non_publie
	check (annule_le is null or not publie);

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_annonce_coherente
	check (
		num_nulls(annonce_discord_message_id, annonce_le, annonce_discord_salon_id) in (0,3)
		and (annonce_discord_message_id is null or publie)
	);

alter table public.x_campagne_tirages
	add constraint x_campagne_tirages_parametres_objet
	check (jsonb_typeof(parametres) = 'object');

create unique index if not exists x_campagne_tirages_numero_unique
	on public.x_campagne_tirages (campagne_slug, numero);
-- AU PLUS UN tirage vivant publié par campagne : deux listes de gagnants
-- concurrentes sur la même page, ce sont deux vérités.
create unique index if not exists x_campagne_tirages_un_seul_publie
	on public.x_campagne_tirages (campagne_slug) where publie and annule_le is null;
-- Idempotence de l'annonce au niveau de l'INDEX et pas seulement du code : c'est
-- le filet sous le compare-and-set d'`enregistrerAnnonce()`.
create unique index if not exists x_campagne_tirages_annonce_unique
	on public.x_campagne_tirages (annonce_discord_message_id)
	where annonce_discord_message_id is not null;
create index if not exists x_campagne_tirages_campagne_idx
	on public.x_campagne_tirages (campagne_slug, numero desc);

comment on table public.x_campagne_tirages is
	'Un tirage au sort. La ligne naît à l''ENGAGEMENT (roster gelé, empreintes publiées), le tirage ne fait que la compléter quand le round drand visé tombe.';
comment on column public.x_campagne_tirages.graine_origine is
	'''balise'' = aléa public drand quicknet, publiable. ''locale'' = répétition, que la base interdit de publier ou d''annoncer. Gelée dès l''engagement par le trigger d''immuabilité : aucun repli silencieux de l''une vers l''autre n''est possible.';
comment on column public.x_campagne_tirages.empreinte_engagement is
	'Couvre le mode de poids, N, les lots, le roster ET le round visé. Publiée dans le message d''engagement Discord AVANT le round. Sans elle, on pourrait choisir N après avoir vu le classement — c''est-à-dire choisir les gagnants.';
comment on column public.x_campagne_tirages.balise_signature is
	'Signature BLS du round drand (96 hex, G1, schéma bls-unchained-g1-rfc9380). C''est ELLE qu''on hache pour la graine, pas randomness : la signature se vérifie seule, hors ligne, des années après.';
comment on column public.x_campagne_tirages.balise_round is
	'Round drand VISÉ, dans le futur au moment de l''engagement. Vaut 0 en mode locale (sentinelle BALISE_LOCALE). bigint : node-postgres rend les int8 en CHAÎNE — toute lecture doit passer par versNombre().';
comment on column public.x_campagne_tirages.annonce_discord_message_id is
	'Snowflake du message d''annonce. Trois couches d''idempotence le protègent : verrou de ligne, compare-and-set, et l''index unique partiel …_annonce_unique.';
comment on column public.x_campagne_tirages.effectue_par is
	'uuid du membre du staff qui a lancé le tirage. HORS de la liste blanche publique : vérifier un tirage ne demande pas de savoir qui a cliqué.';

-- ── 4. LE GEL DU ROSTER ────────────────────────────────────────────────────
--
-- Écrite à l'ENGAGEMENT, avec `u`, `cle_tri`, `empreinte` et `rang` à NULL. C'est
-- cette table qui rend l'engagement OPPOSABLE : la ligne existe avant que le
-- round visé n'existe.
--
-- `empreinte` (les 32 octets du HMAC en hex) et `oeuvres` s'ajoutent au cahier
-- des charges initial. Sans `empreinte`, le départage de deux clés de tri égales
-- n'est pas rejouable par un tiers ; sans `oeuvres`, l'entrée gelée ne justifie
-- pas son propre poids.

create table if not exists public.x_campagne_tirage_entrees (
	tirage_id        uuid not null references public.x_campagne_tirages(id) on delete restrict,
	cle              text not null,
	pseudo_affichage text not null,
	poids            integer not null,
	oeuvres          text[] not null default '{}',
	u                double precision,
	cle_tri          double precision,
	empreinte        text,
	rang             integer,
	primary key (tirage_id, cle)
);

alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_poids;
alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_u_ouvert;
alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_cle_tri;
alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_rang;
alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_empreinte;
alter table public.x_campagne_tirage_entrees drop constraint if exists x_campagne_tirage_entrees_calcul_atomique;

-- Plafond 64 pour deux raisons indépendantes : le comparateur de référence en
-- BigInt calcule a^w, que 64 borne déjà à ~3 400 bits ; et 65 œuvres d'une seule
-- personne sur une campagne est une erreur de donnée, pas un cas d'usage.
alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_poids
	check (poids between 1 and 64);

-- INTERVALLE OUVERT, et les deux bornes comptent : u = 0 donne une clé de tri
-- infinie, u = 1 une clé nulle (donc un gagnant automatique). uDepuisEmpreinte()
-- rend (2k+1)/2^53, exactement borné par 2^-53 et 1 - 2^-53.
alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_u_ouvert
	check (u is null or (u > 0 and u < 1));

alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_cle_tri
	check (cle_tri is null or cle_tri > 0);

alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_rang
	check (rang is null or rang >= 1);

alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_empreinte
	check (empreinte is null or empreinte ~ '^[0-9a-f]{64}$');

-- Les quatre ensemble, ou aucun : une entrée à moitié calculée est une entrée
-- qu'on ne peut ni vérifier ni ignorer.
alter table public.x_campagne_tirage_entrees
	add constraint x_campagne_tirage_entrees_calcul_atomique
	check (num_nulls(u, cle_tri, rang, empreinte) in (0,4));

create unique index if not exists x_campagne_tirage_entrees_rang_unique
	on public.x_campagne_tirage_entrees (tirage_id, rang) where rang is not null;

comment on table public.x_campagne_tirage_entrees is
	'Le roster GELÉ d''un tirage, écrit à l''engagement. Table FERMÉE : elle porte la clé de plateforme. C''est tirage-queries.ts, en rôle rg et derrière la garde admin, qui en dérive la forme publique pseudonymisée.';
comment on column public.x_campagne_tirage_entrees.empreinte is
	'hex(HMAC-SHA256(graine, cle)), 32 octets. Sert au départage exact de deux clés de tri égales — sans elle, c''est l''ordre du roster, donc l''organisateur, qui trancherait.';
comment on column public.x_campagne_tirage_entrees.oeuvres is
	'Identifiants des œuvres qui fondent le poids de cette entrée. C''est ce qui rend le poids justifiable après coup, et c''est parmi elles que tirerOeuvre() choisit celle mise en avant.';

-- ── 5. LES GAGNANTS ────────────────────────────────────────────────────────
--
-- La clé étrangère composite `(tirage_id, cle)` vers les entrées gelées est la
-- garantie structurelle forte de tout le dispositif : ON NE PEUT PAS insérer un
-- gagnant qui n'était pas dans le roster gelé. Ce n'est pas une vérification
-- qu'on pourrait oublier d'écrire, c'est la forme de la table.

create table if not exists public.x_campagne_tirage_gagnants (
	tirage_id            uuid not null references public.x_campagne_tirages(id) on delete restrict,
	rang                 integer not null,
	cle                  text not null,
	pseudo_affichage     text not null,
	creation_source      text not null,
	creation_identifiant text not null,
	oeuvre_id            text,
	lot                  text,
	primary key (tirage_id, rang),
	foreign key (tirage_id, cle)
		references public.x_campagne_tirage_entrees(tirage_id, cle) on delete restrict
);

alter table public.x_campagne_tirage_gagnants drop constraint if exists x_campagne_tirage_gagnants_rang;
alter table public.x_campagne_tirage_gagnants drop constraint if exists x_campagne_tirage_gagnants_source;

alter table public.x_campagne_tirage_gagnants
	add constraint x_campagne_tirage_gagnants_rang check (rang >= 1);
alter table public.x_campagne_tirage_gagnants
	add constraint x_campagne_tirage_gagnants_source
	check (creation_source in ('x','discord','instagram'));

-- Tirage SANS REMISE : personne ne gagne deux fois.
create unique index if not exists x_campagne_tirage_gagnants_cle_unique
	on public.x_campagne_tirage_gagnants (tirage_id, cle);

comment on table public.x_campagne_tirage_gagnants is
	'Les gagnants d''un tirage. La FK (tirage_id, cle) vers les entrées gelées interdit STRUCTURELLEMENT d''inscrire quelqu''un qui n''était pas dans le roster gelé.';
comment on column public.x_campagne_tirage_gagnants.oeuvre_id is
	'L''œuvre mise en avant. TIRÉE, pas choisie : seconde dérivation du même aléa (HMAC(graine, ["RGOEUVRE1", cle])), donc vérifiable. « La plus récente » aurait été un choix éditorial posé APRÈS la révélation du gagnant.';
comment on column public.x_campagne_tirage_gagnants.lot is
	'Libellé du lot pour ce rang. Couvert par empreinte_engagement : le corriger après l''engagement casse la vérification, et c''est exactement ce qu''on veut voir.';

-- ── AUCUN DELETE — IMPOSÉ PAR TRIGGER, PAS PAR GRANT ───────────────────────
--
-- Rappel de l'en-tête : `revoke delete` ne protège de rien quand l'application se
-- connecte en `rg`, PROPRIÉTAIRE des tables. Seul un trigger s'applique au
-- propriétaire.

create or replace function public.x_tirage_suppression_interdite() returns trigger
language plpgsql set search_path to 'public','pg_catalog' as $$
begin
	raise exception 'Un tirage ne se supprime pas, il s''annule (annule_le + motif_annulation). Table %.', tg_table_name
		using errcode = 'restrict_violation',
		      hint = 'update public.x_campagne_tirages set annule_le = now(), motif_annulation = ''…'', publie = false, publie_le = null where id = …';
end; $$;

drop trigger if exists x_campagne_tirages_pas_de_delete          on public.x_campagne_tirages;
drop trigger if exists x_campagne_tirages_pas_de_truncate        on public.x_campagne_tirages;
drop trigger if exists x_campagne_tirage_entrees_pas_de_delete   on public.x_campagne_tirage_entrees;
drop trigger if exists x_campagne_tirage_entrees_pas_de_truncate on public.x_campagne_tirage_entrees;
drop trigger if exists x_campagne_tirage_gagnants_pas_de_delete   on public.x_campagne_tirage_gagnants;
drop trigger if exists x_campagne_tirage_gagnants_pas_de_truncate on public.x_campagne_tirage_gagnants;

create trigger x_campagne_tirages_pas_de_delete
	before delete on public.x_campagne_tirages
	for each row execute function public.x_tirage_suppression_interdite();
-- ⚠ Un TRUNCATE contourne les triggers de LIGNE : il faut le sien, en statement.
create trigger x_campagne_tirages_pas_de_truncate
	before truncate on public.x_campagne_tirages
	for each statement execute function public.x_tirage_suppression_interdite();

create trigger x_campagne_tirage_entrees_pas_de_delete
	before delete on public.x_campagne_tirage_entrees
	for each row execute function public.x_tirage_suppression_interdite();
create trigger x_campagne_tirage_entrees_pas_de_truncate
	before truncate on public.x_campagne_tirage_entrees
	for each statement execute function public.x_tirage_suppression_interdite();

create trigger x_campagne_tirage_gagnants_pas_de_delete
	before delete on public.x_campagne_tirage_gagnants
	for each row execute function public.x_tirage_suppression_interdite();
create trigger x_campagne_tirage_gagnants_pas_de_truncate
	before truncate on public.x_campagne_tirage_gagnants
	for each statement execute function public.x_tirage_suppression_interdite();

-- ── IMMUABILITÉ ────────────────────────────────────────────────────────────
--
-- Deux gels successifs sur la même ligne : ce qui DÉFINIT le tirage est figé dès
-- l'engagement, ce que le tirage a PRODUIT est figé dès le tirage. Restent
-- mutables : publie, publie_le, annonce_*, annule_le, motif_annulation,
-- engagement_message_id, effectue_par — et `parametres`, dont toute modification
-- casse `empreinte_engagement` à la vérification, ce qui est le comportement
-- voulu (une correction de lot après engagement DOIT se voir).

create or replace function public.x_tirage_resultat_immuable() returns trigger
language plpgsql set search_path to 'public','pg_catalog' as $$
begin
	-- Gelé DÈS L'ENGAGEMENT : ce qui définit le tirage.
	if new.numero <> old.numero or new.campagne_slug <> old.campagne_slug
	   or new.empreinte_participants <> old.empreinte_participants
	   or new.empreinte_engagement  <> old.empreinte_engagement
	   or new.nb_participants <> old.nb_participants or new.nb_gagnants <> old.nb_gagnants
	   or new.poids_mode <> old.poids_mode or new.graine_origine <> old.graine_origine
	   or new.engagement_le <> old.engagement_le then
		raise exception 'Colonnes d''engagement immuables sur le tirage %.', old.id
			using errcode = 'check_violation';
	end if;
	-- Gelé DÈS LE TIRAGE : ce que le tirage a produit.
	if old.graine is not null and (new.graine is distinct from old.graine
	   or new.empreinte_graine is distinct from old.empreinte_graine
	   or new.balise_signature is distinct from old.balise_signature
	   or new.balise_round is distinct from old.balise_round
	   or new.effectue_le is distinct from old.effectue_le) then
		raise exception 'Résultat immuable : le tirage % a déjà eu lieu.', old.id
			using errcode = 'check_violation';
	end if;
	return new;
end; $$;

drop trigger if exists x_campagne_tirages_immuable on public.x_campagne_tirages;
create trigger x_campagne_tirages_immuable
	before update on public.x_campagne_tirages
	for each row execute function public.x_tirage_resultat_immuable();

-- Jumeau sur les entrées : une entrée dont le rang est posé est calculée, donc
-- close. `executerEtEnregistrer()` écrit u/cle_tri/empreinte/rang EN UNE FOIS,
-- alors que `old.rang` est encore NULL — le trigger laisse donc passer ce seul
-- passage, et refuse tous les suivants.
create or replace function public.x_tirage_entree_immuable() returns trigger
language plpgsql set search_path to 'public','pg_catalog' as $$
begin
	if old.rang is not null then
		raise exception 'Entrée gelée : le tirage % a déjà classé % au rang %.', old.tirage_id, old.cle, old.rang
			using errcode = 'check_violation';
	end if;
	return new;
end; $$;

drop trigger if exists x_campagne_tirage_entrees_immuable on public.x_campagne_tirage_entrees;
create trigger x_campagne_tirage_entrees_immuable
	before update on public.x_campagne_tirage_entrees
	for each row execute function public.x_tirage_entree_immuable();

-- ── PROPRIÉTAIRE ───────────────────────────────────────────────────────────
--
-- ⚠ Toutes les tables de cette base appartiennent à `rg`, et l'application s'y
-- connecte SOUS CE RÔLE. Appliquer ce fichier en `postgres` (le seul rôle qui
-- passe en authentification peer sur ce VPS) laisserait cinq tables appartenant à
-- `postgres`, sur lesquelles `rg` n'aurait aucun droit : le site lèverait
-- « permission denied » au premier engagement, longtemps après la migration et
-- loin d'elle.

alter table public.x_campagne_participants    owner to rg;
alter table public.x_campagne_oeuvres         owner to rg;
alter table public.x_campagne_tirages         owner to rg;
alter table public.x_campagne_tirage_entrees  owner to rg;
alter table public.x_campagne_tirage_gagnants owner to rg;

-- ── DROITS ET RLS ──────────────────────────────────────────────────────────
--
-- ⚠ ORDRE IMPÉRATIF : revoke → grant → enable rls → drop policy → create policy.
-- Inversé, le REVOKE effacerait le GRANT. Et le revoke TABLE doit précéder toute
-- liste blanche PAR COLONNE : un GRANT resté au niveau table masque
-- silencieusement tout REVOKE par colonne (cf. 20260811_profiles_pii.sql).
--
-- `service_role` est révoqué sur les CINQ tables, y compris les deux publiques —
-- ce qui va plus loin que la lecture publique décrite plus haut, et volontairement.
-- Vérifié ce jour : aucun chemin de code n'atteint ces tables par supabase-js,
-- tout passe par `getPgPool()` en rôle `rg`. Or `service_role` contourne la RLS
-- par conception : lui laisser l'écriture, ce serait laisser forger un tirage par
-- PostgREST, sans verrou consultatif, sans compare-and-set et sans
-- l'auto-vérification qui précède le commit — c'est-à-dire par-dessous tout
-- l'appareil que ce fichier installe.

revoke all on public.x_campagne_participants    from anon, authenticated, service_role;
revoke all on public.x_campagne_oeuvres         from anon, authenticated, service_role;
revoke all on public.x_campagne_tirage_entrees  from anon, authenticated, service_role;
revoke all on public.x_campagne_tirages         from anon, authenticated, service_role;
revoke all on public.x_campagne_tirage_gagnants from anon, authenticated, service_role;

-- PUBLIC nº1 : les tirages, PAR COLONNE.
-- HORS de la liste, et chacune pour une raison : `effectue_par` (uuid d'un membre
-- du staff), `motif_annulation` (prose de modération), `engagement_message_id` /
-- `annonce_discord_salon_id` / `annonce_discord_message_id` (plomberie interne).
-- Rien de tout cela n'est nécessaire pour VÉRIFIER un tirage.
--
-- ⚠ `annule_le` EST DANS LA LISTE, ET IL DOIT Y ÊTRE — piège trouvé par
-- l'exécution, pas par la lecture. La policy de `x_campagne_tirage_gagnants` lit
-- `t.annule_le` dans une sous-requête sur CETTE table-ci. Or l'expression d'une
-- policy portant sur une AUTRE table est évaluée avec les droits de l'appelant,
-- privilèges de COLONNE compris — contrairement à l'expression d'une policy sur
-- sa propre table, qui, elle, n'y est pas soumise (c'est pourquoi la lecture des
-- tirages fonctionnait alors que celle des gagnants échouait). Sans ce grant,
-- `select … from x_campagne_tirage_gagnants` en `anon` répond
-- « permission denied for table x_campagne_tirages » : la liste des gagnants,
-- c'est-à-dire LE SUJET de l'annonce, serait illisible par le public.
-- Aucune information n'est divulguée pour autant : la policy de cette table
-- n'expose que les lignes `annule_le is null`, donc `annule_le` n'est jamais
-- lisible qu'à NULL. Vérifié dans les deux sens le 23/8/2026 — une fois le tirage
-- annulé, `anon` compte 0 tirage ET 0 gagnant.
grant select (id, campagne_slug, numero, graine, empreinte_graine, empreinte_participants,
              empreinte_engagement, nb_participants, nb_gagnants, poids_mode, parametres,
              graine_origine, balise_reseau, balise_chaine, balise_round, balise_signature,
              balise_recuperee_le, engagement_le, publie, publie_le, annonce_le, annule_le)
	on public.x_campagne_tirages to anon, authenticated;

-- PUBLIC nº2 : les gagnants, en entier. Un gagnant publié EST une information
-- publique — c'est le sujet de l'annonce.
grant select on public.x_campagne_tirage_gagnants to anon, authenticated;

alter table public.x_campagne_participants    enable row level security;
alter table public.x_campagne_oeuvres         enable row level security;
alter table public.x_campagne_tirage_entrees  enable row level security;
alter table public.x_campagne_tirages         enable row level security;
alter table public.x_campagne_tirage_gagnants enable row level security;

drop policy if exists "Lecture publique des tirages publies" on public.x_campagne_tirages;
create policy "Lecture publique des tirages publies" on public.x_campagne_tirages for select
	using (publie and annule_le is null and graine_origine = 'balise'
	       and exists (select 1 from public.x_campagnes c
	                    where c.slug = campagne_slug and c.publiee));

drop policy if exists "Lecture publique des gagnants" on public.x_campagne_tirage_gagnants;
create policy "Lecture publique des gagnants" on public.x_campagne_tirage_gagnants for select
	using (exists (select 1 from public.x_campagne_tirages t
	                where t.id = tirage_id and t.publie and t.annule_le is null
	                  and t.graine_origine = 'balise'
	                  and exists (select 1 from public.x_campagnes c
	                               where c.slug = t.campagne_slug and c.publiee)));

-- Roster, œuvres et entrées gelées : RLS activée SANS AUCUNE POLICY = tout
-- refusé, et c'est exactement l'intention (même doctrine que x_campagne_curseurs).

-- ── TRIGGERS REALTIME — RETIRÉS EXPLICITEMENT ──────────────────────────────
--
-- Le flux SSE de rg-realtime N'EST PAS AUTHENTIFIÉ et rediffuse `to_jsonb(NEW)`
-- ENTIER. Sur ces tables il diffuserait le graphe d'identités inter-plateformes,
-- `motif_ineligible`, `notes`, ET la graine d'un tirage engagé mais pas encore
-- tiré — c'est-à-dire le résultat avant l'annonce. Décision de sécurité, pas un
-- oubli ; répétée à chaque rejeu pour qu'un ajout ultérieur ne survive pas.
drop trigger if exists rg_realtime_x_campagne_participants    on public.x_campagne_participants;
drop trigger if exists rg_realtime_x_campagne_oeuvres         on public.x_campagne_oeuvres;
drop trigger if exists rg_realtime_x_campagne_tirages         on public.x_campagne_tirages;
drop trigger if exists rg_realtime_x_campagne_tirage_entrees  on public.x_campagne_tirage_entrees;
drop trigger if exists rg_realtime_x_campagne_tirage_gagnants on public.x_campagne_tirage_gagnants;

-- ═══════════════════════════════════════════════════════════════════════════
--  AMORÇAGE DU ROSTER RÉEL D'IERGDAY — 14 PERSONNES, 16 ŒUVRES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tout ce qui précède est GÉNÉRIQUE : rien n'y est spécifique à `iergday`, tout
-- est porté par `campagne_slug`. Ce qui suit est la seule partie propre à cette
-- campagne, et c'est un CONSTAT, pas une règle.
--
-- ── LES CINQ FUSIONS AUTOMATIQUES SONT DÉJÀ APPLIQUÉES ─────────────────────
-- Les identités absorbées n'ont PAS de ligne : leurs preuves vivent dans
-- `identifiants->>'preuve_fusion'`, et c'est `identifiants` que lit
-- `reconstruireRoster()` pour ne pas les ressusciter. Chacune a soit deux niveaux
-- de preuve indépendants, soit une empreinte d'image décisive. Quatre l'ont été
-- par l'IMAGE (Sanada, Munfurawa, Cieran/FujoRin, kittycaillou), la cinquième —
-- `inazo__` — par le PSEUDO seul.
--
-- ⚠ DEUX DES QUATRE FUSIONS PAR L'IMAGE ÉTAIENT INVISIBLES À TOUTE RÈGLE DE
-- PSEUDO, et c'est ce qui justifie d'avoir calculé des empreintes :
--   * kittyshadow_ / kittycaillou (nom affiché X : « sigmimi ») — 5 caractères de
--     préfixe commun, aucune égalité après normalisation ;
--   * Fujo_Kiran / fujorin — 4 caractères de préfixe commun.
-- Sans les empreintes d'image, ces deux personnes auraient été comptées DOUBLE et
-- auraient eu deux chances chacune. Inversement, la fusion `inazo__` était
-- invisible à l'image (sa ligne Discord est le règlement masqué, sans dessin à
-- comparer) et n'a pu être établie QUE par le pseudo. Aucun des deux niveaux de
-- preuve ne suffit seul.
--
-- ── CE QUE `on conflict do update` REJOUE, ET CE QU'IL NE TOUCHE JAMAIS ─────
-- Rejoué, l'amorçage remet les colonnes MÉCANIQUES (pseudo, sources,
-- identifiants, compteurs, fenêtre de dates, notes) et NE TOUCHE PAS aux
-- ARBITRAGES humains : `eligible`, `motif_ineligible`, `fusionne_dans`,
-- `verrouille`. Une ligne `verrouille` est intégralement épargnée.
-- ⚠ Une ligne devenue ALIAS l'est aussi, et pas par élégance : le CHECK
-- `…_alias_sans_poids` impose `nb_oeuvres = 0` sur un alias — sans cette garde, le
-- rejeu tenterait d'y réécrire 2 œuvres et la migration échouerait le jour où un
-- admin aurait fusionné une ligne.

insert into public.x_campagne_participants
	(campagne_slug, cle, pseudo_affichage, sources, identifiants,
	 nb_oeuvres, nb_creations_brutes, premiere_le, derniere_le, notes)
values
	-- 3 publications, 2 dessins : G3 regroupe le dépôt Discord et le tweet du même dessin.
	('iergday', 'discord:908269053347504170', 'Sanada', '{discord,x}',
	 '{"discord_id":"908269053347504170","discord_handle":"san_la_vraie","x_id":"1471410215086170112","x_handle":"San_La_Vraie","cle_lisible":"sanada","preuve_fusion":"Niveaux (a) image ET (b) pseudo, concordants. G3 : dHash=2, pHash=0, pHash-centre=0, ecart de recadrage 0,064 entre discord:1539898224503033877 et x:2090455666267713840, definition identique 2734x2269. La signature manuscrite @San_La_Vraie est peinte DANS le dessin des deux cotes. Egalite mecanique en prime : San_La_Vraie -> sanlavraie == san_la_vraie -> sanlavraie."}'::jsonb,
	 2, 3, '2026-08-20T07:25:46.647+00'::timestamptz, '2026-08-21T10:09:56.417+00'::timestamptz,
	 'Son 2e dessin (discord:1540301925298348062) n''existe QUE sur Discord, sans pendant X ni Instagram. Appliquée à la lettre, la règle 1 la ferait passer de 2 œuvres à 1. Arbitrage humain, signalé et non appliqué.'),

	-- Mono-source Instagram : la seule clé du roster qui ne soit pas un identifiant numérique.
	('iergday', 'instagram:orphelinalius', 'orphelinalius', '{instagram}',
	 '{"instagram_pseudo":"orphelinalius","cle_lisible":"instagram:orphelinalius","limite":"campagne_creations_instagram n a aucune colonne d identifiant numerique : cette cle ne survivrait pas a un changement de pseudo Instagram."}'::jsonb,
	 2, 2, '2026-08-21T19:13:55.054+00'::timestamptz, '2026-08-22T21:16:18.065+00'::timestamptz,
	 'Deux croquis DIFFÉRENTS, vérifiés à l''œil : 2 œuvres, pas un doublon. Sa 2e publication tombe 43 min 41 s avant la clôture.'),

	('iergday', 'x:1946965962932301825', 'Ruvi_Seiya', '{x}',
	 '{"x_id":"1946965962932301825","x_handle":"Ruvi_Seiya","cle_lisible":"x:ruvi_seiya"}'::jsonb,
	 1, 1, '2026-08-13T15:22:56+00'::timestamptz, '2026-08-13T15:22:56+00'::timestamptz, null),

	-- ⚠ ARBITRAGE OUVERT, cf. le bloc « ARBITRAGES » plus bas.
	('iergday', 'discord:531549483067244566', 'Inazo', '{x}',
	 '{"discord_id":"531549483067244566","discord_handle":"inazo__","x_id":"1148897100387770369","x_handle":"inazo__","cle_lisible":"inazo","preuve_fusion":"Niveau (b) pseudo UNIQUEMENT : sa ligne Discord est le reglement masque, sans dessin a comparer. Egalite exacte apres normalisation : X inazo__ -> inazo == Discord inazo__ -> inazo == nom affiche Inazo. Corroboration forte trouvee en base : le compte Discord 531549483067244566 a lui-meme poste le 2023-08-07 un lien vers twitter.com/inazo__/status/1688667275706892288, soit vers SON PROPRE compte X."}'::jsonb,
	 1, 1, '2026-08-13T15:25:08+00'::timestamptz, '2026-08-13T15:25:08+00'::timestamptz,
	 'A publié le rappel du règlement dans le salon de dépôt (message 1537477294497468556, masqué en base). Sa création X — son OC Nobingo accompagné de Xene — est COMPTÉE : x_campagnes.comptes_organisateurs ne contient QUE rose_griffon. Si le staff ne doit pas concourir, c''est cette colonne-là qu''il faut compléter ; l''écran d''admin bascule alors `eligible` en un clic, avec un motif écrit et un journal d''audit. sources = {x} et non {discord,x} parce que sa seule ligne Discord est écartée.'),

	('iergday', 'x:1284815033395023872', 'Grimnape', '{x}',
	 '{"x_id":"1284815033395023872","x_handle":"grimnape","cle_lisible":"x:grimnape"}'::jsonb,
	 1, 1, '2026-08-13T20:22:57+00'::timestamptz, '2026-08-13T20:22:57+00'::timestamptz, null),

	-- author_id à 10 chiffres : un vieux compte X. Le CHECK accepte 6 à 25 chiffres,
	-- et c'est pour ce cas-là que la borne basse n'est pas 15.
	('iergday', 'x:2870776923', 'Lya', '{x}',
	 '{"x_id":"2870776923","x_handle":"CuicoLya","cle_lisible":"x:cuicolya"}'::jsonb,
	 1, 1, '2026-08-20T18:57:25+00'::timestamptz, '2026-08-20T18:57:25+00'::timestamptz, null),

	('iergday', 'x:1674730916139216897', 'Haroldinho', '{x}',
	 '{"x_id":"1674730916139216897","x_handle":"Haroldinho_jr","cle_lisible":"x:haroldinho_jr"}'::jsonb,
	 1, 1, '2026-08-21T20:22:51+00'::timestamptz, '2026-08-21T20:22:51+00'::timestamptz,
	 'Son nom affiché X est en italiques mathématiques Unicode. Toute normalisation de pseudo DOIT passer par NFKD : un filtrage naïf [^a-z0-9] viderait entièrement la chaîne, et deux pseudos entièrement non-ASCII se « ressembleraient » alors parfaitement.'),

	('iergday', 'discord:306135978316136448', 'Munfurawa', '{discord,x}',
	 '{"discord_id":"306135978316136448","discord_handle":"munfurawa","x_id":"1035885928173260800","x_handle":"FurawaMun","cle_lisible":"munfurawa","preuve_fusion":"Niveaux (a) ET (b), la preuve la plus forte du lot. G1 : dHash STRICTEMENT identique (4e1b1d1f9f1f0f0f), pHash identique (4ea6399a7879193c), definition identique au pixel 1730x1440. Chronologie corroborante : le message Discord (20:24:27Z) dit Je cours la mettre sur Twitter, et le tweet parait 6 minutes plus tard (20:30:27Z)."}'::jsonb,
	 1, 2, '2026-08-21T20:24:27.681+00'::timestamptz, '2026-08-21T20:30:27+00'::timestamptz,
	 '2 publications, 1 seul dessin (G1) : UNE chance, pas deux.'),

	('iergday', 'discord:309031721016229890', 'Cieran / FujoRin', '{discord,x}',
	 '{"discord_id":"309031721016229890","discord_handle":"fujorin","x_id":"860237203674472450","x_handle":"Fujo_Kiran","ancien_handle_x_autodeclare":"Kiran_inazuma","cle_lisible":"cieran-fujorin","preuve_fusion":"Niveau (a) UNIQUEMENT : le pseudo seul n aurait PAS suffi (Fujo_Kiran -> fujokiran contre fujorin, 4 caracteres de prefixe commun, aucune egalite). G4 : dHash=2, pHash=2, pHash-centre=0, ecart de recadrage 0,034 entre discord:1540508422804471819 (PNG 1720x2428) et x:2091112393455632493 (JPEG 850x1200) — le groupe le plus fortement reduit (facteur 2,02) et l empreinte tient. Corroborations : les deux noms affiches mentionnent CIERAN et le meme statut de commissions."}'::jsonb,
	 1, 2, '2026-08-21T23:50:29.259+00'::timestamptz, '2026-08-22T10:37:00+00'::timestamptz,
	 '2 publications, 1 seul dessin (G4) : UNE chance.'),

	('iergday', 'discord:683044704967065626', 'kittycaillou / sigmimi', '{discord,x}',
	 '{"discord_id":"683044704967065626","discord_handle":"kittycaillou","x_id":"1481333548074344451","x_handle":"kittyshadow_","x_nom_affiche":"sigmimi","cle_lisible":"kitty-shirel","preuve_fusion":"Niveau (a) UNIQUEMENT, et le cas ou toute methode par pseudo aurait ECHOUE : kittyshadow_ et kittycaillou ne partagent que le prefixe kitty, et le nom affiche X est sigmimi. G2 : dHash=1, pHash=0, pHash-centre=0, ecart de recadrage 0,046. Preuve independante lisible a l oeil : la signature @Kittyshadow_ est ecrite DANS le dessin, y compris dans la version deposee sur Discord par kittycaillou. Corroboration textuelle : les deux messages nomment le meme OC, Shirel."}'::jsonb,
	 1, 2, '2026-08-22T15:19:05.275+00'::timestamptz, '2026-08-22T16:08:37+00'::timestamptz,
	 '2 publications, 1 seul dessin (G2) : UNE chance. Seul groupe où le fichier X est le MEILLEUR master (4096x3459 contre 2558x2160).'),

	('iergday', 'discord:469900328758935552', 'Jenn Scarlet', '{discord}',
	 '{"discord_id":"469900328758935552","discord_handle":"jennscarlet","x_handle_autodeclare":"JennScarlet87","cle_lisible":"jennscarlet"}'::jsonb,
	 1, 1, '2026-08-22T18:05:57.667+00'::timestamptz, '2026-08-22T18:05:57.667+00'::timestamptz,
	 'Sa création porte 2 FICHIERS mais UN SEUL dessin : le fichier 0 est un recadrage vertical du fichier 1 (erreur absolue moyenne 5,47/255 à y=654, contre 93,64 pour un témoin négatif). 1 œuvre, pas 2. ⚠ Règle 1 : dépôt Discord sans pendant X ni Instagram, alors qu''elle POSSÈDE un compte X (@JennScarlet87, qu''elle a elle-même lié deux fois depuis Discord) et ne s''en est pas servie ici. Arbitrage humain.'),

	('iergday', 'discord:443473435512012800', 'Isma', '{discord}',
	 '{"discord_id":"443473435512012800","discord_handle":"cacabueno","cle_lisible":"cacabueno"}'::jsonb,
	 1, 1, '2026-08-22T19:43:15.126+00'::timestamptz, '2026-08-22T19:43:15.126+00'::timestamptz,
	 'Règle 1 : dépôt Discord sans pendant X ni Instagram. Signalé, non appliqué.'),

	-- ⚠ L'ARBITRAGE LE PLUS LOURD DE LA CAMPAGNE, cf. le bloc « ARBITRAGES ».
	('iergday', 'discord:460001633053704192', 'ThunderAce / Kaze', '{discord}',
	 '{"discord_id":"460001633053704192","discord_handle":"thunder_ace","cle_lisible":"thunder_ace"}'::jsonb,
	 1, 1, '2026-08-22T21:36:13.767+00'::timestamptz, '2026-08-22T21:36:13.767+00'::timestamptz,
	 '7 FICHIERS, 1 œuvre. Les 7 images ont été REGARDÉES : ce sont des photos d''un écran de télévision (moiré et reflets visibles) montrant son OC Fulgur en match — une image de dribble, une du telop « Tempête stellaire », et CINQ frames successives du même telop « Tir petri 2 ». Son message dit « je vais vous envoyer des screens de mon Oc Fulgur qui fait ses techs ! » : un seul acte de participation. Compter 7 lui donnerait 7 tickets sur 22, soit 32 % du tirage, pour avoir appuyé sept fois sur le déclencheur. Lecture alternative défendable : 3 œuvres (dribble / Tempête stellaire / Tir petri 2). Ce qui n''est PAS défendable, c''est 7. Règle 1 : dépôt Discord sans pendant, comme les trois autres.'),

	('iergday', 'discord:689064409100058624', 'Deb', '{discord}',
	 '{"discord_id":"689064409100058624","discord_handle":"deborah6625","cle_lisible":"deborah6625"}'::jsonb,
	 1, 1, '2026-08-22T21:59:40.906+00'::timestamptz, '2026-08-22T21:59:40.906+00'::timestamptz,
	 'Création limite, vérifiée et ÉLIGIBLE : publiée 18,094 secondes avant fin_le. Son message dit lui-même « Poster à la dernière minute et pas fini mais tant pis ». Règle 1 : dépôt Discord sans pendant.')

on conflict (campagne_slug, cle) do update set
	pseudo_affichage    = excluded.pseudo_affichage,
	sources             = excluded.sources,
	identifiants        = excluded.identifiants,
	nb_oeuvres          = excluded.nb_oeuvres,
	nb_creations_brutes = excluded.nb_creations_brutes,
	premiere_le         = excluded.premiere_le,
	derniere_le         = excluded.derniere_le,
	notes               = excluded.notes
where not public.x_campagne_participants.verrouille
  and public.x_campagne_participants.fusionne_dans is null;

-- ── LES 16 ŒUVRES ──────────────────────────────────────────────────────────
--
-- 4 groupes de doublons (nb_creations = 2) et 12 œuvres uniques.
--
-- ⚠ POURQUOI `image_master_url` PORTE `?name=orig`, ET POURQUOI C'EST
-- OBLIGATOIRE : sans ce paramètre, `pbs.twimg.com` sert la variante « large »,
-- plafonnée à 2048 px de bord long. Les empreintes ci-dessous (sha256, dhash,
-- phash) et les dimensions ont TOUTES été calculées sur `?name=orig` ; pointer
-- l'URL nue ferait décrire un fichier par les empreintes d'un autre, et un
-- vérificateur qui recalculerait le sha256 trouverait un écart sans faute.
-- Contrôle fait à la collecte : les dimensions des fichiers téléchargés en
-- `?name=orig` correspondent exactement à celles déclarées dans `tweets.media`.
--
-- ⚠ ET POURQUOI `sha256` NE SERT PAS AU DÉDOUBLONNAGE : les 27 images ont 27
-- sha256 DISTINCTS. Une déduplication octet à octet trouve ZÉRO doublon et
-- attribue 4 chances de trop. Les 4 vrais doublons ne sont visibles que
-- perceptuellement, X ré-encodant systématiquement en JPEG.

insert into public.x_campagne_oeuvres
	(campagne_slug, oeuvre_id, cle, creation_gardee_source, creation_gardee_id, creations, nb_creations,
	 sha256, dhash, phash, largeur, hauteur,
	 image_master_source, image_master_id, image_master_index, image_master_chemin, image_master_url,
	 motif_regroupement)
values
	-- ── G1 · Munfurawa ──────────────────────────────────────────────────────
	('iergday', 'x:2090899354148368577', 'discord:306135978316136448', 'x', '2090899354148368577',
	 '[{"source":"discord","identifiant":"1540456574588559440"},{"source":"x","identifiant":"2090899354148368577"}]'::jsonb, 2,
	 '8f0082bcfb4caccdf6cb4d46de9814487616e389d7990c4b2aa9ed064a350d21', '4e1b1d1f9f1f0f0f', '4ea6399a7879193c', 1730, 1440,
	 'discord', '1540456574588559440', 0, 'campagnes/iergday/discord/1540456574588559440-1540456574030708976.png', null,
	 'Même dessin, la preuve la plus forte des quatre : dHash STRICTEMENT identique (4e1b1d1f9f1f0f0f), pHash identique, définition identique au pixel 1730x1440. Confirmé à l''œil : Aurore et son keshin loup Grand Fenrir, cadrage identique. Le message Discord dit « Je cours la mettre sur Twitter- » et le tweet paraît 6 minutes plus tard. Création gardée = le post X (règle 1 : « sur Twitter ou Instagram »). Image master = le PNG Discord, sans perte et de même définition, là où X ne sert qu''un JPEG de 206 Ko.'),

	-- ── G2 · kittycaillou / kittyshadow_ ────────────────────────────────────
	('iergday', 'x:2091195848247885914', 'discord:683044704967065626', 'x', '2091195848247885914',
	 '[{"source":"discord","identifiant":"1540742112713379840"},{"source":"x","identifiant":"2091195848247885914"}]'::jsonb, 2,
	 'bc729a41095cce703f9bd40f87ab777926efc3570c4d07a011c0a9baaf57d296', '373b1f0f0d277365', '51cc323349b6676d', 4096, 3459,
	 'x', '2091195848247885914', 0, null, 'https://pbs.twimg.com/media/HQVqv-GXwAAn-pt.jpg?name=orig',
	 'Même dessin : dHash=1, pHash=0, pHash-centre=0, écart de recadrage 0,046. Affiche « IERGDAY 22.08.2026 » avec deux OC et un cadre à pois verts ; la signature « @Kittyshadow_ » est peinte DANS l''illustration des deux côtés. Création gardée = le post X (règle 1). Image master = le fichier X : SEUL groupe où X sert la MEILLEURE définition (4096x3459 contre 2558x2160 sur Discord).'),

	-- ── G3 · Sanada ─────────────────────────────────────────────────────────
	('iergday', 'x:2090455666267713840', 'discord:908269053347504170', 'x', '2090455666267713840',
	 '[{"source":"discord","identifiant":"1539898224503033877"},{"source":"x","identifiant":"2090455666267713840"}]'::jsonb, 2,
	 '4204055e1195e92f8e7fe81a51224f504e7f9d39bbae5853147e0b822824fbe3', '2a7234b495b435b0', '37cce03f9c614a36', 2734, 2269,
	 'discord', '1539898224503033877', 0, 'campagnes/iergday/discord/1539898224503033877-1539898224402366574.png', null,
	 'Même dessin : dHash=2, pHash=0, pHash-centre=0, écart de recadrage 0,064, définition identique 2734x2269. Deux OC allongés avec un ballon, fond rayé vert, mention « IE 18 #IERGDay », signature « @San_La_Vraie » lisible dans les deux images. Création gardée = le post X (règle 1). Image master = le PNG Discord (10,9 Mo sans perte) ; le JPEG X (1,4 Mo) n''en est qu''une compression.'),

	-- ── G4 · Cieran / FujoRin ───────────────────────────────────────────────
	('iergday', 'x:2091112393455632493', 'discord:309031721016229890', 'x', '2091112393455632493',
	 '[{"source":"discord","identifiant":"1540508422804471819"},{"source":"x","identifiant":"2091112393455632493"}]'::jsonb, 2,
	 '723fd195645d38b1d1d59b2a89a3fac8a98965606c73edac5d0cc1fbe65809b7', '97077331626c4d58', '52d6ce9966653398', 1720, 2428,
	 'discord', '1540508422804471819', 0, 'campagnes/iergday/discord/1540508422804471819-1540508421680271470.png', null,
	 'Même dessin : dHash=2, pHash=2, pHash-centre=0, écart de recadrage 0,034. Trois OC en gros plan dans un parc. C''est le groupe le plus fortement réduit (Discord 1720x2428 vers X 850x1200, facteur 2,02) et l''empreinte tient quand même. Création gardée = le post X (règle 1). Image master = le PNG Discord, DEUX FOIS plus défini que ce que X sert — l''écart le plus marqué des quatre groupes.'),

	-- ── 12 œuvres uniques ───────────────────────────────────────────────────
	('iergday', 'x:2087922862803841524', 'x:1946965962932301825', 'x', '2087922862803841524',
	 '[{"source":"x","identifiant":"2087922862803841524"}]'::jsonb, 1,
	 '0d13041f57cef747d22f48ab1cc0373af149114b6a3288de14ae57fac761b2ec', '0185111301000100', '05d75d1d26a92a3b', 3000, 4000,
	 'x', '2087922862803841524', 0, null, 'https://pbs.twimg.com/media/HPnKxf9XwAAFhDq.jpg?name=orig', null),

	('iergday', 'x:2087923415000789199', 'discord:531549483067244566', 'x', '2087923415000789199',
	 '[{"source":"x","identifiant":"2087923415000789199"}]'::jsonb, 1,
	 '47d7790bc3138e22b8d7333224b41fc0bd9c61b8ae4bf93e405ece41e794a123', 'd3f1f351f0f2f2f3', '36b6920a0d5cf2b7', 1920, 1080,
	 'x', '2087923415000789199', 0, null, 'https://pbs.twimg.com/media/HPnLRy3WEAA9MAp.jpg?name=orig', null),

	('iergday', 'x:2087998363211825503', 'x:1284815033395023872', 'x', '2087998363211825503',
	 '[{"source":"x","identifiant":"2087998363211825503"}]'::jsonb, 1,
	 'f2e3de7246c378e3d466940dbac9c00087010b13321cd14065168fdef8a8e4d7', '09992b0b33360737', '1635696b3b903373', 1919, 977,
	 'x', '2087998363211825503', 0, null, 'https://pbs.twimg.com/media/HPoPai1WQAEXb2J.jpg?name=orig', null),

	('iergday', 'x:2090513552087879823', 'x:2870776923', 'x', '2090513552087879823',
	 '[{"source":"x","identifiant":"2090513552087879823"}]'::jsonb, 1,
	 'fb0a3086c15ff0cda07ddc90824ca8a229a107b95f0be709e282353524279dbb', '8191b0060c3ca242', '0ba7b4cdd8386539', 2160, 3055,
	 'x', '2090513552087879823', 0, null, 'https://pbs.twimg.com/media/HQL-_mdXcAA06Gq.jpg?name=orig', null),

	('iergday', 'x:2090897441985896710', 'x:1674730916139216897', 'x', '2090897441985896710',
	 '[{"source":"x","identifiant":"2090897441985896710"}]'::jsonb, 1,
	 '0f3157f6310c76c90c8f6fb3294fbeb01ae329ae42cc7b0fd484523a7eeb5cc6', 'e87b692763c39359', '14692eb6699f1b2c', 2048, 1204,
	 'x', '2090897441985896710', 0, null, 'https://pbs.twimg.com/media/HQRcI-OWgAA2mwC.jpg?name=orig', null),

	-- Le 2e dessin de Sanada : Discord SEUL, sans pendant X ni Instagram (règle 1).
	('iergday', 'discord:1540301925298348062', 'discord:908269053347504170', 'discord', '1540301925298348062',
	 '[{"source":"discord","identifiant":"1540301925298348062"}]'::jsonb, 1,
	 '598493423211aa8fa4d0fff0d54168e1ae8175e505ba5c1c7f289e7e04ec71c2', '72e0f8f9f8d2e6a4', '362c99c6c5994e6d', 2115, 2663,
	 'discord', '1540301925298348062', 0, 'campagnes/iergday/discord/1540301925298348062-1540301924673388635.png', null, null),

	-- ⚠ image_master_index = 1, seule œuvre du lot dans ce cas.
	('iergday', 'discord:1540784107729064108', 'discord:469900328758935552', 'discord', '1540784107729064108',
	 '[{"source":"discord","identifiant":"1540784107729064108"}]'::jsonb, 1,
	 'a46e63af7807e69d3a486248313fad9cfc1a9505c2462b382067b002738122ea', 'ecf8929332a18b96', '076ae82dc2177d87', 2550, 3507,
	 'discord', '1540784107729064108', 1, 'campagnes/iergday/discord/1540784107729064108-1540784106776961125.png', null,
	 '2 FICHIERS, 1 seul dessin : le fichier 0 (2550x1938) est un recadrage vertical du fichier 1 (2550x3507), prouvé au pixel — erreur absolue moyenne 5,47/255 à l''offset y=654, contre 93,64 pour un témoin négatif. Le master est donc le fichier 1, le plus complet. ⚠ LIMITE DU SEUIL, à connaître : le dHash de ces deux fichiers vaut 19 et leur pHash 26, EN PLEIN dans la zone « dessins différents ». Le seuil ne voit PAS les recadrages ; ici cela ne fausse rien (même création), mais un doublon recadré entre deux créations DISTINCTES passerait sous le radar. La recherche de recadrage dédiée doit tourner à chaque collecte.'),

	('iergday', 'discord:1540808591806570586', 'discord:443473435512012800', 'discord', '1540808591806570586',
	 '[{"source":"discord","identifiant":"1540808591806570586"}]'::jsonb, 1,
	 '47040b77e18cfa19e65ebaeb1e228d2ae5fc922083c0db11bdc1558b7748b7ac', '4ac0c4a4d28cccc2', '3ff0c40fc2096b3e', 3840, 2160,
	 'discord', '1540808591806570586', 0, 'campagnes/iergday/discord/1540808591806570586-1540808591366295684.png', null, null),

	-- ⚠ 7 FICHIERS, 1 œuvre. L'arbitrage le plus lourd de la campagne.
	('iergday', 'discord:1540837023487631391', 'discord:460001633053704192', 'discord', '1540837023487631391',
	 '[{"source":"discord","identifiant":"1540837023487631391"}]'::jsonb, 1,
	 '9f1b54dc87fe7a5667a204df14264c246d228f7feb99e43c68231c10fc4eebd9', 'f7373d3f2bab2723', '556a331dfa4825e3', 3225, 1857,
	 'discord', '1540837023487631391', 0, 'campagnes/iergday/discord/1540837023487631391-1540837021109457066.jpg', null,
	 '7 fichiers, UNE œuvre. Ce sont des photos d''un écran de télévision montrant son OC Fulgur en match, dont CINQ frames successives du même telop « Tir petri 2 » : un seul acte de participation, et son message le dit. Ces 7 fichiers ne sont PAS regroupés entre eux par l''empreinte (leur paire interne la plus proche est à dHash 22) — c''est la lecture du contenu, pas le seuil, qui tranche ici. Compter 7 lui donnerait 32 % du tirage.'),

	('iergday', 'discord:1540842925456359557', 'discord:689064409100058624', 'discord', '1540842925456359557',
	 '[{"source":"discord","identifiant":"1540842925456359557"}]'::jsonb, 1,
	 '0397e5d1502cd5eff91b8b0d854d875bd6254089504c1a0ec51e2ce47ca63882', '0f4fc949474b4349', '1c4b4592cd6e2dd3', 1839, 1381,
	 'discord', '1540842925456359557', 0, 'campagnes/iergday/discord/1540842925456359557-1540842925292785694.png', null, null),

	('iergday', 'instagram:DcUEDDKoTgP', 'instagram:orphelinalius', 'instagram', 'DcUEDDKoTgP',
	 '[{"source":"instagram","identifiant":"DcUEDDKoTgP"}]'::jsonb, 1,
	 '4263767b14310c7ee166aa9258a20fa715f7abf99590acd79f2595ae3ccacc27', '414d514d45476777', '0015051d2b3f3fbf', 640, 853,
	 'instagram', 'DcUEDDKoTgP', 0, 'campagnes/iergday/instagram/DcUEDDKoTgP.jpg', null, null),

	('iergday', 'instagram:DcW22ScIdYv', 'instagram:orphelinalius', 'instagram', 'DcW22ScIdYv',
	 '[{"source":"instagram","identifiant":"DcW22ScIdYv"}]'::jsonb, 1,
	 '88836f4c2844c396fa40e097bbf8da81954fdcd26fe778f2e03a33619d9b9738', '4517735732584e53', '00915ded37f834f4', 640, 853,
	 'instagram', 'DcW22ScIdYv', 0, 'campagnes/iergday/instagram/DcW22ScIdYv.jpg', null, null)

on conflict (campagne_slug, oeuvre_id) do update set
	cle                    = excluded.cle,
	creation_gardee_source = excluded.creation_gardee_source,
	creation_gardee_id     = excluded.creation_gardee_id,
	creations              = excluded.creations,
	nb_creations           = excluded.nb_creations,
	sha256                 = excluded.sha256,
	dhash                  = excluded.dhash,
	phash                  = excluded.phash,
	largeur                = excluded.largeur,
	hauteur                = excluded.hauteur,
	image_master_source    = excluded.image_master_source,
	image_master_id        = excluded.image_master_id,
	image_master_index     = excluded.image_master_index,
	image_master_chemin    = excluded.image_master_chemin,
	image_master_url       = excluded.image_master_url,
	motif_regroupement     = excluded.motif_regroupement;

-- ── FUSIONS SUGGÉRÉES, NON APPLIQUÉES ──────────────────────────────────────
--
-- Elles ne sont PAS un `insert`, et ne le seront jamais depuis une migration :
-- une fusion erronée prive quelqu'un de sa participation. Elles vivent ici et
-- dans une carte de l'écran d'admin, avec un bouton « Appliquer » et un bouton
-- « Écarter définitivement » qui trace l'écart. Aucune des trois ne change un
-- seul comptage : ce sont des identités SANS création sur cette campagne.
--
--  1) discord:469900328758935552 (jennscarlet)  ↔  x:JennScarlet87
--     INDICE : auto-déclaration, en base et deux fois. Le compte Discord
--     jennscarlet a posté un lien vers un tweet de « JennScarlet87 » le
--     2023-08-07 puis le 2023-09-01, donc vers son propre compte X. Le pseudo va
--     dans le même sens (inclusion stricte : jennscarlet ⊂ jennscarlet87).
--     POURQUOI ON NE L'APPLIQUE PAS : « JennScarlet87 » est TOTALEMENT ABSENT du
--     corpus `tweets` (0 ligne) et n'a aucune création sur cette campagne. La
--     fusion ne changerait ni le nombre de personnes ni le nombre d'œuvres.
--     CE QU'ELLE DOCUMENTE QUAND MÊME, et c'est pour cela qu'elle est écrite :
--     jennscarlet POSSÈDE un compte X et ne s'en est pas servie pour l'IERG Day.
--     Cela pèse sur l'arbitrage de la règle 1 la concernant.
--     Confiance : ÉLEVÉE sur l'identité, NULLE sur l'effet.
--
--  2) discord:309031721016229890 (fujorin)  ↔  x:Kiran_inazuma
--     INDICE : ancien handle X auto-déclaré. fujorin a posté deux liens vers des
--     tweets de « Kiran_inazuma » (2023-08-03 et 2023-08-17). Le handle actuel
--     « Fujo_Kiran » partage le radical Kiran.
--     POURQUOI ON NE L'APPLIQUE PAS : non recoupable. « Kiran_inazuma » est
--     absent du corpus `tweets` (0 ligne) ; seul « Fujo_Kiran » y figure
--     (author_id 860237203674472450). Aucun `author_id` commun à vérifier, aucune
--     création de campagne de ce côté.
--     CE QU'ELLE DOCUMENTE : un exemple concret, sur un participant de CETTE
--     campagne, d'un handle X qui change avec le temps — l'argument direct pour
--     clé sur l'identifiant numérique.
--     Confiance : MOYENNE ; effet nul sur les comptages.
--
--  3) instagram:orphelinalius  ↔  discord:309031721016229890 (Cieran / FujoRin)
--     ⚠ REJETÉE SUR PIÈCE. Écrite ici pour montrer qu'elle a été EXAMINÉE et
--     écartée, pas oubliée. Seule ressemblance : « Cierra » (nom d'un OC dessiné
--     par orphelinalius) contre « Cieran » (alias de la personne fujorin) — un
--     nom d'OC face à un nom de personne, deux catégories différentes. Et les OC
--     de fujorin sont explicitement nommés dans son tweet (« Tanguy, Sage et
--     Nora ») : aucun ne s'appelle Cierra.
--     Vérifications complémentaires faites : « orphelinalius » n'apparaît NULLE
--     PART ailleurs en base (0 message Discord, 0 auteur Discord, 0 compte X) ;
--     les seules occurrences de « alius » sont « Pierre Alius », personnage canon
--     d'Alius Academy, donc du bruit.
--     Confiance : TRÈS FAIBLE — rejetée.
--
-- ── ARBITRAGES OUVERTS, DÉLIBÉRÉMENT NON TRANCHÉS PAR CETTE MIGRATION ──────
--
-- Le code ne tranche rien ; il rend l'arbitrage impossible à cacher. Chacun de
-- ces points est un `Switch` d'éligibilité assorti d'un motif que le CHECK
-- `…_motif_si_ineligible` rend OBLIGATOIRE, et d'une entrée de journal d'audit.
--
--  * RÈGLE 1 — « Postez une image mettant en scène un OC accompagné du #IERGDay
--    sur Twitter ou Instagram. » CINQ créations n'existent QUE sur Discord, sans
--    pendant : jennscarlet, cacabueno (Isma), thunder_ace, deborah6625 (Deb), et
--    le 2e dessin de Sanada. Appliquée à la lettre, cette règle retire TOUTE
--    chance à 4 personnes sur 14 et fait passer Sanada de 2 œuvres à 1. Discord
--    n'est que le salon de dépôt (salons_depot = {1537458038623965194}), pas une
--    surface de publication citée par la règle.
--  * INAZO — tout indique un membre du staff (rappel du règlement dans le salon
--    de dépôt, 437 tweets dans le corpus, relais des annonces @rose_griffon
--    depuis 2023). Mais `comptes_organisateurs` ne contient QUE `rose_griffon`,
--    et écarter quelqu'un sur une impression est exactement ce qu'un tirage
--    vérifiable est censé rendre impossible. La vraie correction n'est pas de
--    bidouiller son éligibilité : c'est de compléter `comptes_organisateurs`.
--  * THUNDERACE — 7 fichiers comptés pour 1 œuvre (cf. son `motif_regroupement`).
--    Lecture alternative défendable : 3 œuvres. 7 ne l'est pas.
--
-- ET LE RAPPEL QUI SURPLOMBE LES TROIS : aucun lot ni tirage n'a JAMAIS été
-- annoncé pendant cette campagne — le règlement en base ne comporte que 4 règles,
-- aucune mention de récompense. La mécanique de tirage est NEUVE et rétroactive.
-- Toute règle d'éligibilité durcie après coup retire une chance à quelqu'un qui
-- n'a jamais su qu'il en avait une.

-- ── CONTRÔLE DE COHÉRENCE — LA MIGRATION REFUSE DE COMMITTER SI ELLE MENT ───
--
-- Un amorçage recopié à la main peut se tromper en silence : une ligne oubliée,
-- un compteur décalé, et le tirage distribue les chances de travers sans que rien
-- ne le signale. Ce bloc rejoue les comptages MESURÉS en base avant écriture et
-- fait échouer la transaction entière au moindre écart.

do $$
declare
	nb_personnes int; somme_oeuvres int; somme_brutes int;
	-- ⚠ `total_oeuvres` et NON `nb_oeuvres` : une variable PL/pgSQL homonyme d'une
	-- colonne rend « column reference is ambiguous » sur le premier `sum()`.
	total_oeuvres int; nb_doublons int; nb_incoherentes int; nb_orphelines int;
begin
	select count(*), coalesce(sum(nb_oeuvres), 0), coalesce(sum(nb_creations_brutes), 0)
	  into nb_personnes, somme_oeuvres, somme_brutes
	  from public.x_campagne_participants where campagne_slug = 'iergday';

	if nb_personnes <> 14 or somme_oeuvres <> 16 or somme_brutes <> 20 then
		raise exception 'Roster iergday incohérent : % personnes, % œuvres, % créations brutes (attendu 14 / 16 / 20).',
			nb_personnes, somme_oeuvres, somme_brutes;
	end if;

	select count(*), count(*) filter (where nb_creations = 2)
	  into total_oeuvres, nb_doublons
	  from public.x_campagne_oeuvres where campagne_slug = 'iergday';

	if total_oeuvres <> 16 or nb_doublons <> 4 then
		raise exception 'Œuvres iergday incohérentes : % œuvres dont % doublons (attendu 16 dont 4).',
			total_oeuvres, nb_doublons;
	end if;

	-- L'invariant qui compte VRAIMENT : le compteur d'une personne doit égaler le
	-- nombre d'œuvres qui lui sont réellement rattachées. C'est lui qui décide du
	-- POIDS, donc des chances. Les deux comptages ci-dessus pourraient tomber
	-- juste avec des œuvres attribuées à la mauvaise personne ; celui-ci non.
	select count(*) into nb_incoherentes
	  from public.x_campagne_participants p
	 where p.campagne_slug = 'iergday'
	   and p.nb_oeuvres <> (select count(*) from public.x_campagne_oeuvres o
	                         where o.campagne_slug = p.campagne_slug and o.cle = p.cle);
	if nb_incoherentes <> 0 then
		raise exception '% personne(s) dont nb_oeuvres ne correspond pas aux œuvres réellement rattachées.', nb_incoherentes;
	end if;

	-- Personne sans œuvre : ce serait un ticket sans dessin.
	select count(*) into nb_orphelines
	  from public.x_campagne_participants p
	 where p.campagne_slug = 'iergday' and p.eligible and p.fusionne_dans is null and p.nb_oeuvres = 0;
	if nb_orphelines <> 0 then
		raise exception '% personne(s) éligible(s) sans aucune œuvre.', nb_orphelines;
	end if;

	raise notice 'iergday : % personnes, % œuvres (dont % doublons regroupés), % créations brutes. Poids par_oeuvre = %, un_par_personne = %.',
		nb_personnes, total_oeuvres, nb_doublons, somme_brutes, somme_oeuvres, nb_personnes;
end $$;

commit;
