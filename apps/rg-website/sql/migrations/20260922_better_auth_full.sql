-- Better Auth admin, API-key, JWT and OAuth-provider schema.
-- Agent Auth tables already exist in this database and are not recreated here.

alter table if exists public."user"
  add column if not exists role text default 'user',
  add column if not exists banned boolean default false,
  add column if not exists "banReason" text,
  add column if not exists "banExpires" timestamptz;

update public."user" set role = 'user' where role is null or role = 'member';

alter table if exists public.session add column if not exists "impersonatedBy" text;

create table if not exists public.apikey (
  id text primary key, "configId" text not null, name text, start text,
  "referenceId" text not null, prefix text, key text not null,
  "refillInterval" integer, "refillAmount" integer, "lastRefillAt" timestamptz,
  enabled boolean default true, "rateLimitEnabled" boolean default true,
  "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer,
  remaining integer, "lastRequest" timestamptz, "expiresAt" timestamptz,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
  permissions text, metadata text
);

create table if not exists public.jwks (
  id text primary key, "publicKey" text not null, "privateKey" text not null,
  "createdAt" timestamptz not null, "expiresAt" timestamptz
);

create table if not exists public.passkey (
  id text primary key,
  name text,
  "publicKey" text not null,
  "userId" text not null references public."user" (id) on delete cascade,
  "credentialID" text not null unique,
  counter integer not null,
  "deviceType" text not null,
  "backedUp" boolean not null,
  transports text,
  "createdAt" timestamptz,
  aaguid text
);

-- Dependency order matters: oauth*Token and oauthConsent reference oauthClient.
create table if not exists public."oauthClient" (
  id text primary key, "clientId" text not null unique, "clientSecret" text,
  disabled boolean, "skipConsent" boolean, "enableEndSession" boolean,
  "subjectType" text, scopes jsonb,
  "userId" text references public."user" (id) on delete cascade,
  "createdAt" timestamptz, "updatedAt" timestamptz, name text, uri text, icon text,
  contacts jsonb, tos text, policy text, "softwareId" text,
  "softwareVersion" text, "softwareStatement" text, "redirectUris" jsonb not null,
  "postLogoutRedirectUris" jsonb, "tokenEndpointAuthMethod" text,
  "grantTypes" jsonb, "responseTypes" jsonb, public boolean, type text,
  "requirePKCE" boolean, "referenceId" text, metadata jsonb
);

create table if not exists public."oauthApplication" (
  id text primary key, name text not null, icon text, metadata text,
  "clientId" text not null unique, "clientSecret" text, "redirectUrls" text not null,
  type text not null, disabled boolean,
  "userId" text references public."user" (id) on delete cascade,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null
);

create table if not exists public."oauthRefreshToken" (
  id text primary key, token text not null unique,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "sessionId" text references public.session (id) on delete set null,
  "userId" text not null references public."user" (id) on delete cascade,
  "referenceId" text, "expiresAt" timestamptz not null, "createdAt" timestamptz not null,
  revoked timestamptz, "authTime" timestamptz, scopes jsonb not null
);

create table if not exists public."oauthAccessToken" (
  id text primary key, "accessToken" text not null unique,
  "refreshToken" text not null unique, "accessTokenExpiresAt" timestamptz not null,
  "refreshTokenExpiresAt" timestamptz not null,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "userId" text references public."user" (id) on delete cascade, scopes jsonb not null,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
  token text not null unique, "sessionId" text references public.session (id) on delete set null,
  "referenceId" text, "refreshId" text references public."oauthRefreshToken" (id) on delete cascade,
  "expiresAt" timestamptz not null
);

create table if not exists public."oauthConsent" (
  id text primary key,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "userId" text references public."user" (id) on delete cascade, scopes jsonb not null,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
  "consentGiven" boolean not null, "referenceId" text
);

create index if not exists "apikey_configId_idx" on public.apikey ("configId");
create index if not exists "apikey_referenceId_idx" on public.apikey ("referenceId");
create index if not exists "apikey_key_idx" on public.apikey (key);
create index if not exists "passkey_userId_idx" on public.passkey ("userId");
create index if not exists "oauthApplication_userId_idx" on public."oauthApplication" ("userId");
create index if not exists "oauthAccessToken_clientId_idx" on public."oauthAccessToken" ("clientId");
create index if not exists "oauthAccessToken_userId_idx" on public."oauthAccessToken" ("userId");
create index if not exists "oauthAccessToken_sessionId_idx" on public."oauthAccessToken" ("sessionId");
create index if not exists "oauthAccessToken_refreshId_idx" on public."oauthAccessToken" ("refreshId");
create index if not exists "oauthConsent_clientId_idx" on public."oauthConsent" ("clientId");
create index if not exists "oauthConsent_userId_idx" on public."oauthConsent" ("userId");
create index if not exists "oauthClient_userId_idx" on public."oauthClient" ("userId");
create index if not exists "oauthRefreshToken_clientId_idx" on public."oauthRefreshToken" ("clientId");
create index if not exists "oauthRefreshToken_sessionId_idx" on public."oauthRefreshToken" ("sessionId");
create index if not exists "oauthRefreshToken_userId_idx" on public."oauthRefreshToken" ("userId");
