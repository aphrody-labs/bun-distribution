// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { QueryBuilder, Type, type RelationshipFields } from "@rosegriffon/patreon-bun";

const campaignRelationships: RelationshipFields<Type.Campaign>[] = [
  "benefits",
  "creator",
  "goals",
  "live_access_rules",
  "tiers",
];

describe("published Patreon query contract", () => {
  test("encodes pagination and sorting", () => {
    const { query } = QueryBuilder.campaigns.build()(undefined, { count: 100, sort: "created" });
    expect(query).toBe("?" + new URLSearchParams({ "page[count]": "100", sort: "created" }));
  });
  test("includes the documented campaign relationships", () => {
    expect(QueryBuilder.campaign.includeAll().relationships).toEqual(campaignRelationships);
    expect(QueryBuilder.campaign.schemaRelationships).toEqual(campaignRelationships);
  });
  test("replaces relationship attributes without duplicating the relationship", () => {
    const query = QueryBuilder.campaign
      .setRelationshipAttributes("creator", ["hide_pledges"])
      .setRelationshipAttributes("creator", ["full_name"]);
    expect(query.attributes).toEqual({ user: ["full_name"] });
    expect(query.relationships).toEqual(["creator"]);
  });
  test("includes the published campaign attribute schema", () => {
    expect(QueryBuilder.campaign.schemaResourceAttributes).toHaveLength(29);
  });
  test("rejects an unsupported resource", () => {
    expect(() => QueryBuilder.createRelationMap("invalid" as never)).toThrow();
  });
});
