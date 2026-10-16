-- Vidéos officielles des techniques (zukan.inazuma.jp), 1 ligne = 1 vidéo.
--
-- POURQUOI UNE TABLE ET PAS UNE COLONNE.
-- `inagle_skills.video_url` / `poster_url` sont scalaires : elles ne peuvent porter
-- qu'UNE vidéo. Or 236 techniques sur les 895 publiées par zukan en exposent DEUX
-- (mesuré sur les deux pages `?per_page=500`) — un tir a sa réussite et son échec,
-- un blocage a sa version « Defence » et sa version « Shot Block ». Écraser la
-- seconde perdrait de l'information réelle ; la sérialiser en JSON dans une colonne
-- la rendrait injoignable en SQL et illisible dans le miroir SQLite.
--
-- Une table de liaison règle les trois points :
--   * une variante de plus ne coûte rien (pas de migration de schéma) ;
--   * le libellé du bouton — seule chose qui distingue les variantes chez zukan —
--     est conservé tel quel, pas déduit ;
--   * le préfixe `inagle_` suffit à la faire embarquer par le dump nocturne du
--     miroir (`backup-supabase-to-sqlite.ts --prefix=inagle_`, découverte
--     dynamique via information_schema) : azalee la voit sans configuration.
--
-- `inagle_skills.video_url` / `poster_url` restent renseignées avec la vidéo
-- PRINCIPALE (`position = 0`) : toutes les lectures existantes continuent de
-- fonctionner, la table n'ajoute que ce qu'elles ne pouvaient pas porter.
--
-- Les URL sont stockées en `.webm` : le `.wmv` annoncé par zukan est
-- systématiquement servi en 403 par CloudFront, et le `.webm` (même chemin, même
-- hash) pèse la moitié du `.mp4`.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260813_inagle_skill_videos.sql

begin;

-- La vignette webp de la liste zukan est UNE par technique (pas une par variante) :
-- elle reste donc sur `inagle_skills`, là où la liste du wiki la lit déjà en `select *`.
-- ~6 Ko contre ~70 Ko pour le poster jpg : c'est elle qu'on veut dans une grille de 60.
alter table public.inagle_skills
	add column if not exists thumbnail_url text;

comment on column public.inagle_skills.thumbnail_url is
	'Vignette webp zukan (~6 Ko) affichée dans la grille des techniques.';

create table if not exists public.inagle_skill_videos (
	skill_id text not null references public.inagle_skills (id) on delete cascade,
	-- Rang d'apparition dans le `.btnBox` de zukan. 0 = vidéo principale, celle
	-- recopiée dans `inagle_skills.video_url`.
	position integer not null default 0,
	-- Libellé du bouton chez zukan : Shot, Success, Failure, Defence, Offence,
	-- Shot Block. C'est la seule étiquette que la source donne à ses variantes.
	label text not null,
	video_url text not null,
	poster_url text,
	-- D'où vient la ligne : `zukan` (scrapée) ou `dreamscape` (reskin qui réutilise
	-- l'animation d'un move parent). Dire lequel évite de confondre une donnée
	-- constatée avec une donnée déduite.
	source text not null default 'zukan' check (source in ('zukan', 'dreamscape')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	primary key (skill_id, position)
);

-- Même propriétaire que le reste du schéma : appliquée en `postgres` (superutilisateur),
-- la table naîtrait à lui et le rôle applicatif `rg` se heurterait à sa propre RLS.
alter table public.inagle_skill_videos owner to rg;

comment on table public.inagle_skill_videos is
	'Vidéos de techniques publiées par zukan.inazuma.jp — 1 ligne par variante (236 techniques en ont 2).';
comment on column public.inagle_skill_videos.position is
	'Rang dans le .btnBox zukan ; 0 = principale (recopiée dans inagle_skills.video_url).';
comment on column public.inagle_skill_videos.label is
	'Libellé du bouton zukan : Shot / Success / Failure / Defence / Offence / Shot Block.';
comment on column public.inagle_skill_videos.source is
	'zukan = constatée sur le site ; dreamscape = animation empruntée au move parent.';

-- Reprise : la vignette a d'abord été posée sur les variantes avant d'être
-- reconnue comme un attribut de la technique. Retirée ici pour qu'une seconde
-- application de cette migration converge vers le schéma décrit plus haut.
alter table public.inagle_skill_videos
	drop column if exists thumbnail_url;

-- La lecture de la fiche : toutes les variantes d'une technique, dans l'ordre.
create index if not exists inagle_skill_videos_skill_idx
	on public.inagle_skill_videos (skill_id, position);

alter table public.inagle_skill_videos enable row level security;

-- Même exposition que `inagle_skills` : donnée de jeu publique, lecture pour tous.
drop policy if exists "Public Read" on public.inagle_skill_videos;
create policy "Public Read" on public.inagle_skill_videos for select using (true);

grant select on public.inagle_skill_videos to anon, authenticated;
grant all on public.inagle_skill_videos to service_role;

commit;
