import { describe, expect, test } from "bun:test";

import { createAchilleaClient, type AchilleaFetch } from "../src/v1";

const organization = {
  id: 7,
  name: "Team Vitality",
  normalizedName: "TEAM VITALITY",
  logo: "https://example.test/logo.png",
  description: "Structure de test",
  state: 0,
  preapproved: false,
  origin: "FR",
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
  owner: { id: "owner-1", username: "owner" },
  managers: [],
};

describe("contrat organisations déployé", () => {
  test("normalise { data, count } en page même sans meta", async () => {
    const fetch: AchilleaFetch = async () => Response.json({ data: [], count: 0 });
    const client = createAchilleaClient({ baseUrl: "https://api.example.test", fetch });

    const result = await client.organizations.list({ page: 1, pagination: 5 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ data: [], meta: { total: 0 } });
  });

  test("accepte l'organisation renvoyée après création", async () => {
    let requestBody: unknown;
    const fetch: AchilleaFetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ success: true, data: organization });
    };
    const client = createAchilleaClient({ baseUrl: "https://api.example.test", fetch });

    const result = await client.organizations.create({
      name: organization.name,
      normalizedName: organization.normalizedName,
      logo: organization.logo,
      description: organization.description,
      origin: organization.origin,
      orgManagers: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.data?.id).toBe(7);
    expect(requestBody).toEqual({
      name: organization.name,
      normalizedName: organization.normalizedName,
      logo: organization.logo,
      description: organization.description,
      origin: organization.origin,
      orgManagers: [],
    });
  });
});
