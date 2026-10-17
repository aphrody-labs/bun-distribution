-- Performance advisors (Supabase database linter), generated from the catalog.
--   0003 auth_rls_initplan      : wrap auth.<fn>() in (select ...) so it is
--                                 evaluated once per statement (initPlan)
--                                 instead of once per row. USING / WITH CHECK
--                                 logic, roles, command and permissiveness are
--                                 unchanged (ALTER POLICY keeps them).
--   0009 duplicate_index        : drop the redundant copy, keep the index that
--                                 backs the primary key / original constraint.
--   0001 unindexed_foreign_keys : covering btree index for every foreign key.

begin;

-- 0003 auth_rls_initplan
alter policy "Users manage own bookmarks" on public.article_bookmarks
  using ((user_id = (select auth.uid())));
alter policy "Création de commentaire par l'auteur" on public.article_comments
  with check (((select auth.uid()) = user_id));
alter policy "Modification de commentaire par l'auteur" on public.article_comments
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));
alter policy "Suppression de commentaire par l'auteur ou un admin" on public.article_comments
  using ((((select auth.uid()) = user_id) OR public.is_admin()));
alter policy "Users manage own reactions" on public.article_reactions
  using ((user_id = (select auth.uid())));
alter policy "Chronicles admin all" on public.chronicles
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy comment_reports_insert_authenticated on public.comment_reports
  with check ((reporter_id = (select auth.uid())));
alter policy "Authenticated users can insert comments" on public.comments
  with check (((select auth.uid()) = user_id));
alter policy "Users can delete their own comments" on public.comments
  using (((select auth.uid()) = user_id));
alter policy "Users can update their own comments" on public.comments
  using (((select auth.uid()) = user_id));
alter policy "Discord sync logs admin read" on public.discord_sync_logs
  using (((select auth.uid()) IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.role = 'admin'::text))));
alter policy "Email templates admin all" on public.email_templates
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Events admin all" on public.events
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Awakenings" on public.inagle_awakenings
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Formations" on public.inagle_formations
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Keshins" on public.inagle_keshins
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Miximax" on public.inagle_miximax
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write ModeChanges" on public.inagle_mode_changes
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Passives" on public.inagle_passives
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Quests" on public.inagle_quests
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy "Admin Write Souls" on public.inagle_souls
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy newsletter_delete_own on public.newsletter_subscriptions
  using ((user_id = (select auth.uid())));
alter policy newsletter_insert_authenticated on public.newsletter_subscriptions
  with check ((user_id = (select auth.uid())));
alter policy newsletter_select_own on public.newsletter_subscriptions
  using (((user_id = (select auth.uid())) OR public.is_admin()));
alter policy newsletter_update_own on public.newsletter_subscriptions
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy orders_select_admin on public.orders
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE (((profiles.id)::text = ((select auth.uid()))::text) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text]))))));
alter policy orders_select_own on public.orders
  using ((((select auth.uid()))::text = user_id));
alter policy orders_service_role_all on public.orders
  using (((select auth.role()) = 'service_role'::text))
  with check (((select auth.role()) = 'service_role'::text));
alter policy patreon_legacy_read on public.patreon_legacy_members
  using ((public.is_admin() OR (resolved_user_id = (select auth.uid()))));
alter policy patreon_memberships_owner_read on public.patreon_memberships
  using (((user_id = (select auth.uid())) OR public.is_admin()));
alter policy patreon_tokens_owner on public.patreon_oauth_tokens
  using (((user_id = (select auth.uid())) OR public.is_admin()))
  with check (((user_id = (select auth.uid())) OR public.is_admin()));
alter policy patreon_webhook_events_admin_read on public.patreon_webhook_events
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE (((profiles.id)::text = ((select auth.uid()))::text) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text]))))));
alter policy patreon_webhook_events_service_role on public.patreon_webhook_events
  using (((select auth.role()) = 'service_role'::text))
  with check (((select auth.role()) = 'service_role'::text));
alter policy "Profils réclamés visibles par tous" on public.profiles
  using (((claimed_at IS NOT NULL) OR ((select auth.uid()) = id)));
alter policy "Users can update their own profile." on public.profiles
  using (((select auth.uid()) = id));
alter policy "Création de son propre historique" on public.reading_history
  with check (((select auth.uid()) = user_id));
alter policy "Lecture de son propre historique" on public.reading_history
  using (((select auth.uid()) = user_id));
alter policy "Mise à jour de son propre historique" on public.reading_history
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));
alter policy "Suppression de son propre historique" on public.reading_history
  using (((select auth.uid()) = user_id));
alter policy "Settings admin update" on public.settings
  using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));
alter policy share_tracking_insert_authenticated on public.share_tracking
  with check (((user_id = (select auth.uid())) OR (user_id IS NULL)));
alter policy "Stream schedules admin manage" on public.stream_schedules
  using ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = (select auth.uid()))) = 'admin'::text))
  with check ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = (select auth.uid()))) = 'admin'::text));
alter policy user_preferences_delete_own on public.user_preferences
  using ((user_id = (select auth.uid())));
alter policy user_preferences_insert_own on public.user_preferences
  with check ((user_id = (select auth.uid())));
alter policy user_preferences_select_own on public.user_preferences
  using ((user_id = (select auth.uid())));
alter policy user_preferences_update_own on public.user_preferences
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "Users can delete their own teams" on public.user_teams
  using (((select auth.uid()) = user_id));
alter policy "Users can insert their own teams" on public.user_teams
  with check (((select auth.uid()) = user_id));
alter policy "Users can update their own teams" on public.user_teams
  using (((select auth.uid()) = user_id));
alter policy "Users can view their own teams" on public.user_teams
  using (((select auth.uid()) = user_id));

-- 0009 duplicate_index
-- achillea.schema_migrations: schema_migrations_pkey (version) is kept.
drop index if exists achillea.schema_migrations_version_idx;
-- public.article_reactions: two identical UNIQUE (article_id, user_id,
-- reaction_type) constraints; the default-named one is kept.
alter table public.article_reactions drop constraint if exists unique_user_article_reaction;

-- 0001 unindexed_foreign_keys
create index if not exists clan_application_clan_id_idx on achillea.clan_application (clan_id);
create index if not exists clan_application_user_id_idx on achillea.clan_application (user_id);
create index if not exists clan_experience_log_clan_id_idx on achillea.clan_experience_log (clan_id);
create index if not exists clan_invite_clan_id_idx on achillea.clan_invite (clan_id);
create index if not exists clan_invite_inviter_id_idx on achillea.clan_invite (inviter_id);
create index if not exists clan_invite_user_id_idx on achillea.clan_invite (user_id);
create index if not exists clan_member_user_id_idx on achillea.clan_member (user_id);
create index if not exists clan_member_history_clan_id_idx on achillea.clan_member_history (clan_id);
create index if not exists clan_member_history_user_id_idx on achillea.clan_member_history (user_id);
create index if not exists clan_team_captain_id_idx on achillea.clan_team (captain_id);
create index if not exists clan_team_clan_id_idx on achillea.clan_team (clan_id);
create index if not exists clan_team_member_added_by_id_idx on achillea.clan_team_member (added_by_id);
create index if not exists clan_team_member_team_id_idx on achillea.clan_team_member (team_id);
create index if not exists contract_creator_id_idx on achillea.contract (creator_id);
create index if not exists event_clan_a_id_idx on achillea.event (clan_a_id);
create index if not exists event_clan_b_id_idx on achillea.event (clan_b_id);
create index if not exists event_organization_id_idx on achillea.event (organization_id);
create index if not exists event_ruleset_entity_id_idx on achillea.event (ruleset_entity_id);
create index if not exists event_series_id_idx on achillea.event (series_id);
create index if not exists event_announcement_event_id_idx on achillea.event_announcement (event_id);
create index if not exists event_managers_user_id_idx on achillea.event_managers (user_id);
create index if not exists event_participants_tournament_participant_id_idx on achillea.event_participants (tournament_participant_id);
create index if not exists interclan_lineup_clan_id_idx on achillea.interclan_lineup (clan_id);
create index if not exists interclan_lineup_event_id_idx on achillea.interclan_lineup (event_id);
create index if not exists interclan_lineup_member_lineup_id_idx on achillea.interclan_lineup_member (lineup_id);
create index if not exists interclan_lineup_member_user_id_idx on achillea.interclan_lineup_member (user_id);
create index if not exists lobby_event_id_idx on achillea.lobby (event_id);
create index if not exists lobby_host_user_id_idx on achillea.lobby (host_user_id);
create index if not exists lobby_match_lobby_id_idx on achillea.lobby_match (lobby_id);
create index if not exists lobby_user_lobby_id_idx on achillea.lobby_user (lobby_id);
create index if not exists organization_owner_id_idx on achillea.organization (owner_id);
create index if not exists organization_preapproved_by_id_idx on achillea.organization (preapproved_by_id);
create index if not exists organization_manager_user_id_idx on achillea.organization_manager (user_id);
create index if not exists organization_validation_organization_id_idx on achillea.organization_validation (organization_id);
create index if not exists organization_validation_reviewer_id_idx on achillea.organization_validation (reviewer_id);
create index if not exists player_note_author_id_idx on achillea.player_note (author_id);
create index if not exists player_note_resolved_by_id_idx on achillea.player_note (resolved_by_id);
create index if not exists ranked_queue_entry_ranked_id_idx on achillea.ranked_queue_entry (ranked_id);
create index if not exists ranked_queue_entry_user_id_idx on achillea.ranked_queue_entry (user_id);
create index if not exists ruleset_parent_ruleset_id_idx on achillea.ruleset (parent_ruleset_id);
create index if not exists tournament_event_actor_id_idx on achillea.tournament_event (actor_id);
create index if not exists tournament_event_target_id_idx on achillea.tournament_event (target_id);
create index if not exists tournament_participant_user_id_idx on achillea.tournament_participant (user_id);
create index if not exists tournament_series_organization_id_idx on achillea.tournament_series (organization_id);
create index if not exists user_experience_log_user_id_idx on achillea.user_experience_log (user_id);
create index if not exists vote_proposal_id_idx on achillea.vote (proposal_id);
create index if not exists vote_voter_id_idx on achillea.vote (voter_id);
create index if not exists vote_proposal_eligible_voters_user_id_idx on achillea.vote_proposal_eligible_voters (user_id);
create index if not exists "agentCapabilityGrant_deniedBy_idx" on public."agentCapabilityGrant" ("deniedBy");
create index if not exists comments_user_id_idx on public.comments (user_id);
create index if not exists discord_polls_visual_message_id_idx on public.discord_polls (visual_message_id);

commit;
