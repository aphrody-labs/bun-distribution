-- -----------------------------------------------------------------------------
-- BUNDLE MIGRATION MANUELLE - 20 NOVEMBRE 2025
-- Ce fichier contient toutes les migrations en attente concaténées.
-- Copiez tout le contenu et exécutez-le dans le SQL Editor de Supabase.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. 20251119000002_create_rate_limits.sql
-- =============================================================================

create table if not exists public.rate_limits (
  key text not null,
  count integer default 1,
  last_request timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint rate_limits_pkey primary key (key)
);

-- Enable RLS (though this table is mostly for internal use, good practice)
alter table public.rate_limits enable row level security;

-- Policies (Service role only usually, but maybe authenticated users for their own limits?)
-- For now, let's allow service role full access and maybe public insert if we do client-side checks (not recommended).
-- Better: Only server-side logic accesses this, so RLS can be restrictive or we use service role client.

create policy "Service role has full access"
  on public.rate_limits for all
  to service_role
  using (true)
  with check (true);


-- =============================================================================
-- 2. 20251119000003_add_member_link_to_team_members.sql
-- =============================================================================

ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS member_link text;


-- =============================================================================
-- 3. 20251119000004_add_featured_image_to_chronicles.sql
-- =============================================================================

ALTER TABLE public.chronicles ADD COLUMN IF NOT EXISTS featured_image text;


-- =============================================================================
-- 4. 20251119000005_add_increment_article_views_function.sql
-- =============================================================================

-- Migration: Add increment_article_views function
-- Date: 19 novembre 2025
-- Description: Function to increment view count for articles

CREATE OR REPLACE FUNCTION public.increment_article_views(article_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.articles
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = article_id;
END;
$$;

COMMENT ON FUNCTION public.increment_article_views(UUID) IS 'Increments the view count for a specific article';


-- =============================================================================
-- 5. 20251119000006_add_address_to_profiles.sql
-- =============================================================================

-- Migration: Add address fields to profiles
-- Date: 19 novembre 2025
-- Description: Add address fields to profiles table

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS address_line1 text,
ADD COLUMN IF NOT EXISTS address_line2 text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS postal_code text,
ADD COLUMN IF NOT EXISTS country text;


-- =============================================================================
-- 6. 20251120000001_create_chronicles_media_bucket.sql
-- =============================================================================

-- Create the storage bucket for chronicles media
INSERT INTO storage.buckets (id, name, public)
VALUES ('chronicles-media', 'chronicles-media', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Public Read Access
-- Allows anyone to view files in the 'chronicles-media' bucket
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'chronicles-media' );

-- Policy: Authenticated Upload Access
-- Allows authenticated users to upload files to the 'chronicles-media' bucket
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'chronicles-media' );

-- Policy: Owner Update Access
-- Allows users to update files they own
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'chronicles-media' AND auth.uid() = owner );

-- Policy: Owner Delete Access
-- Allows users to delete files they own
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'chronicles-media' AND auth.uid() = owner );
