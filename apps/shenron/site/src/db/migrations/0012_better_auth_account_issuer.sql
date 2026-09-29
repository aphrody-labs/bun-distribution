-- Better Auth 1.6 requires issuer on its account model for OAuth linking.
ALTER TABLE public."ba_account"
  ADD COLUMN IF NOT EXISTS "issuer" text;
