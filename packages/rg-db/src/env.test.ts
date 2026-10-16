import { afterEach, expect, spyOn, test } from "bun:test";
import { getSupabasePublishableKey } from "./env";
import { createPostgresClient } from "./postgres-client";

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_INTERNAL_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Supabase Cloud accepts its public key format without promoting a server secret", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public_fixture";
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(getSupabasePublishableKey()).toBe("sb_publishable_public_fixture");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fixture.supabase.co";
  expect(() => getSupabasePublishableKey()).toThrow("publishable key");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co.invalid";
  expect(() => getSupabasePublishableKey()).toThrow("publishable key");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_fixture_must_never_be_public";
  expect(() => getSupabasePublishableKey()).toThrow("publishable key");
});

test("the legacy gateway keeps its JWT contract and does not send a Cloud opaque key", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:8800";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture.legacy.anon";
  expect(getSupabasePublishableKey()).toBe("fixture.legacy.anon");
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(() => getSupabasePublishableKey()).toThrow("legacy RG anon JWT");
});

test("opaque Cloud server keys are apikey headers while legacy JWTs retain their Bearer header", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  delete process.env.SUPABASE_INTERNAL_URL;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_private_server_fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture.legacy.service";
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]));
  try {
    const cloud = await createPostgresClient().storage.from("avatars").list();
    expect(cloud.error).toBeNull();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://fixture.supabase.co/storage/v1/object/list/avatars");
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      apikey: "sb_secret_private_server_fixture",
      "content-type": "application/json",
    });
    delete process.env.SUPABASE_SECRET_KEY;
    fetch.mockResolvedValue(Response.json([]));
    const legacy = await createPostgresClient().storage.from("avatars").list();
    expect(legacy.error).toBeNull();
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({
      apikey: "fixture.legacy.service",
      Authorization: "Bearer fixture.legacy.service",
      "content-type": "application/json",
    });
  } finally {
    fetch.mockRestore();
  }
});
