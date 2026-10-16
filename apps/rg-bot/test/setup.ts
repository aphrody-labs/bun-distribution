// SPDX-License-Identifier: Apache-2.0
/** Test connections never inherit a developer/production database. */
function fixtureUrl(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (process.env.RG_TEST_DATABASE_IS_DISPOSABLE !== "1")
    throw new Error("SQL tests require RG_TEST_DATABASE_IS_DISPOSABLE=1 in addition to their fixture URL.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(`${name} must select an explicit disposable loopback PostgreSQL fixture.`);
  return value;
}
const fixture = fixtureUrl("RG_TEST_DATABASE_URL");
fixtureUrl("RANKED_TEST_DATABASE_URL");
process.env.DATABASE_URL = fixture ?? "postgres://fixture:fixture@127.0.0.1:1/rg_tests_unavailable";
process.env.DISCORD_BOT_TOKEN = "synthetic-rg-test-token";
process.env.JWT_SECRET_KEY = "synthetic-rg-test-signing-key";
