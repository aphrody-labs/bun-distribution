import { describe, expect, test } from "bun:test";
import { getPublicClan, listPublicClans } from "./unified-clans";

const clan = {
  id: 1,
  name: "Rose Griffon",
  shortName: "RG",
  avatarUrl: "",
  biography: "",
  fame: 10,
  isRecruiting: true,
  membersLimit: false,
};

describe("annuaire clans unifié", () => {
  test("lit les pages API et respecte la limite de 50", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      return Response.json({
        data:
          url.searchParams.get("page") === "1"
            ? Array.from({ length: 50 }, (_, id) => ({ ...clan, id }))
            : [{ ...clan, id: 50 }],
        count: 51,
      });
    };
    const result = await listPublicClans(fetcher, "https://api.example.test");
    expect(result).toHaveLength(51);
    expect(urls).toEqual([
      "https://api.example.test/v1/achillea/clans?page=1&pageSize=50",
      "https://api.example.test/v1/achillea/clans?page=2&pageSize=50",
    ]);
  });

  test("rejette une réponse compacte incomplète", async () => {
    const fetcher = async () => Response.json({ data: [{ id: 1, name: "Incomplet" }], count: 1 });
    await expect(listPublicClans(fetcher)).rejects.toThrow("réponse invalide");
  });
});

describe("getPublicClan", () => {
  test("charge la projection publique unifiée", async () => {
    let requestedUrl = "";
    const result = await getPublicClan(
      61,
      async input => {
        requestedUrl = String(input);
        return Response.json({ ...clan, id: 61 });
      },
      "https://api.example.test",
    );

    expect(requestedUrl).toBe("https://api.example.test/v1/achillea/clans/61");
    expect(result).toEqual({ ...clan, id: 61 });
  });

  test("rejects invalid identifiers without requesting the API", async () => {
    let requested = false;
    await expect(
      getPublicClan(0, async () => {
        requested = true;
        return Response.json({ ...clan, id: 1 });
      }),
    ).rejects.toThrow("identifiant invalide");
    expect(requested).toBe(false);
  });

  test("rejects a response for a different clan", async () => {
    await expect(getPublicClan(61, async () => Response.json({ ...clan, id: 62 }))).rejects.toThrow("réponse invalide");
  });
});
