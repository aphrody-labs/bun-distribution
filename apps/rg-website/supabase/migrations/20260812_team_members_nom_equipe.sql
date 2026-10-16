-- Normalisation de `team_members.team_name`.
--
-- Constat (12/8/2026) : sur 129 lignes, 30 avaient `team_name` à NULL — toutes
-- issues de la synchronisation Discord, et toutes porteuses d'un
-- `discord_user_id`. Or la colonne est lue publiquement par
-- `apps/website/src/app/profil/[username]/page.tsx` :
--
--   SELECT role, team_name FROM team_members WHERE discord_user_id = $1
--
-- pour afficher « Rôle • Équipe » sur la fiche publique. Ces 30 membres
-- perdaient donc leur équipe. Par ailleurs `assoteam` portait deux libellés
-- concurrents (« Association » et « Membres de l'Association ») selon la ligne.
--
-- Le libellé est entièrement déterminé par `team_id` : on le dérive une fois
-- pour l'existant, puis un déclencheur le maintient — y compris pour les
-- écritures qui ne passent pas par l'administration (synchronisation Discord).
-- Le référentiel doit rester aligné sur `src/app/admin/staff/teams.ts`.

begin;

create or replace function public.rg_libelle_equipe(id_equipe text)
returns text
language sql
immutable
as $$
	select case id_equipe
		when 'bureauteam'      then 'Bureau de l''Association'
		when 'assoteam'        then 'Membres de l''Association'
		when 'loreteam'        then 'Équipe Lore'
		when 'dessinateurteam' then 'Équipe Dessinateur'
		when 'productionteam'  then 'Équipe Production'
		when 'socialteam'      then 'Équipe Réseaux'
		when 'achilleateam'    then 'Équipe Achilléa'
		when 'azaleeteam'      then 'Équipe Azalée'
		when 'mediationteam'   then 'Cellule de Médiation'
		when 'collabteam'      then 'Partenaires & Collaborateurs'
		else null
	end;
$$;

comment on function public.rg_libelle_equipe(text) is
	'Libellé lisible d''une équipe Rose Griffon ; miroir de src/app/admin/staff/teams.ts.';

create or replace function public.rg_team_members_nom_equipe()
returns trigger
language plpgsql
as $$
begin
	new.team_name := coalesce(public.rg_libelle_equipe(new.team_id), new.team_name);
	return new;
end;
$$;

drop trigger if exists team_members_nom_equipe_trigger on public.team_members;

create trigger team_members_nom_equipe_trigger
	before insert or update of team_id, team_name on public.team_members
	for each row
	execute function public.rg_team_members_nom_equipe();

-- Reprise de l'existant : seules les lignes dont le libellé diffère sont
-- touchées, et une équipe hors référentiel garde sa valeur actuelle.
update public.team_members
set team_name = public.rg_libelle_equipe(team_id)
where public.rg_libelle_equipe(team_id) is not null
	and team_name is distinct from public.rg_libelle_equipe(team_id);

commit;
