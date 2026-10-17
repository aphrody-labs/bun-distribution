-- Buckets Supabase Storage — fin du service de fichiers self-host.
--
-- `rg-storage` servait `/storage/v1` depuis un disque local et indexait les
-- objets dans `storage.objects`. Supabase Storage reprend la même surface
-- (`/storage/v1/object/public/<bucket>/…`) : on y recrée les huit buckets et
-- leurs policies à l'identique du dernier état de production.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('assets', 'assets', true, null, null),
  ('menu', 'menu', true, 10485760, null),
  ('article', 'article', true, 10485760, '{image/png,image/jpeg,image/webp,image/gif}'::text[]),
  ('avatars', 'avatars', true, 2097152, '{image/png,image/jpeg,image/webp}'::text[]),
  ('patreon', 'patreon', false, 52428800, '{image/jpeg,image/png,image/webp,image/gif,image/avif}'::text[]),
  ('tweets', 'tweets', true, 52428800, '{image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm}'::text[]),
  ('images', 'images', true, 6291456, '{image/png,image/jpeg,image/webp,image/gif,image/svg+xml}'::text[]),
  ('ranked-proofs', 'ranked-proofs', false, 6291456, '{image/png,image/jpeg,image/webp}'::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists article_admin_delete on storage.objects;
CREATE POLICY article_admin_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'article'::text) AND public.is_admin()));
drop policy if exists article_admin_insert on storage.objects;
CREATE POLICY article_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'article'::text) AND public.is_admin()));
drop policy if exists article_admin_update on storage.objects;
CREATE POLICY article_admin_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'article'::text) AND public.is_admin()));
drop policy if exists article_public_read on storage.objects;
CREATE POLICY article_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'article'::text));
drop policy if exists avatars_public_read on storage.objects;
CREATE POLICY avatars_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'avatars'::text));
drop policy if exists avatars_user_delete on storage.objects;
CREATE POLICY avatars_user_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'avatars'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR public.is_admin())));
drop policy if exists avatars_user_insert on storage.objects;
CREATE POLICY avatars_user_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
drop policy if exists avatars_user_update on storage.objects;
CREATE POLICY avatars_user_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
drop policy if exists menu_admin_delete on storage.objects;
CREATE POLICY menu_admin_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'menu'::text) AND public.is_admin()));
drop policy if exists menu_admin_insert on storage.objects;
CREATE POLICY menu_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'menu'::text) AND public.is_admin()));
drop policy if exists menu_admin_update on storage.objects;
CREATE POLICY menu_admin_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'menu'::text) AND public.is_admin()));
drop policy if exists menu_public_read on storage.objects;
CREATE POLICY menu_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'menu'::text));
drop policy if exists "patreon storage admin read" on storage.objects;
CREATE POLICY "patreon storage admin read" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'patreon'::text) AND public.is_admin()));
drop policy if exists "patreon storage admin write" on storage.objects;
CREATE POLICY "patreon storage admin write" ON storage.objects TO authenticated USING (((bucket_id = 'patreon'::text) AND public.is_admin())) WITH CHECK (((bucket_id = 'patreon'::text) AND public.is_admin()));
drop policy if exists tweets_admin_delete on storage.objects;
CREATE POLICY tweets_admin_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'tweets'::text) AND public.is_admin()));
drop policy if exists tweets_admin_insert on storage.objects;
CREATE POLICY tweets_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'tweets'::text) AND public.is_admin()));
drop policy if exists tweets_admin_update on storage.objects;
CREATE POLICY tweets_admin_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'tweets'::text) AND public.is_admin()));
drop policy if exists tweets_public_read on storage.objects;
CREATE POLICY tweets_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'tweets'::text));

commit;
