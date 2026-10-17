import { describe, expect, test } from "bun:test";
import { configureLab, type LabApi, type LabPolicy, type Channel } from "../../src/lab/ai-lab.ts";

const policy: LabPolicy = {
  guildId: "guild",
  ownerId: "owner",
  name: "AI Lab",
  researcherRole: "Researcher",
  adminRole: "Admin",
  categories: [
    {
      name: "Lab",
      channels: [{ name: "assistant", topic: "Ask", guide: "Welcome" }],
    },
    {
      name: "Ops",
      adminOnly: true,
      channels: [{ name: "ops", topic: "Admin" }],
    },
  ],
  assistant: {
    profile: "aphrody",
    model: "model",
    pollSeconds: 5,
    maxTokens: 384,
    systemPrompt: "Lab",
  },
};
function fake(owner = "owner") {
  const channels: Channel[] = [{ id: "existing", name: "general", type: 0 }];
  const roles = [{ id: "admin", name: "Admin", permissions: "8" }];
  const writes: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let count = 0;
  const api: LabApi = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    if (method !== "GET") writes.push({ path, method, body: body as Record<string, unknown> });
    if (path === "/guilds/guild") return { id: "guild", owner_id: owner, name: "AI Lab" } as T;
    if (path === "/users/@me") return { id: "bot" } as T;
    if (path.endsWith("/roles")) {
      if (method === "POST") {
        const role = { id: "researcher", ...(body as object) };
        roles.push(role as (typeof roles)[number]);
        return role as T;
      }
      return roles as T;
    }
    if (path === "/guilds/guild/channels") {
      if (method === "POST") {
        const channel = { id: `c${++count}`, ...(body as object) } as Channel;
        channels.push(channel);
        return channel as T;
      }
      return structuredClone(channels) as T;
    }
    if (path.endsWith("/messages")) return { id: "guide" } as T;
    return {} as T;
  };
  return { api, channels, writes };
}
describe("Discord AI lab policy", () => {
  test("plan never writes", async () => {
    const f = fake();
    await configureLab(policy, f.api, false);
    expect(f.writes).toHaveLength(0);
  });
  test("owner mismatch refuses every mutation", async () => {
    const f = fake("stranger");
    await expect(configureLab(policy, f.api, true)).rejects.toThrow("owner mismatch");
    expect(f.writes).toHaveLength(0);
  });
  test("existing channels survive and admin category excludes researchers", async () => {
    const f = fake();
    await configureLab(policy, f.api, true);
    expect(f.channels.find(c => c.id === "existing")?.name).toBe("general");
    expect(f.writes.some(w => w.method === "DELETE")).toBe(false);
    const ops = f.writes.find(w => w.body.name === "Ops")!;
    expect((ops.body.permission_overwrites as { id: string }[]).some(o => o.id === "researcher")).toBe(false);
  });
  test("rerun reuses objects and does not repost guides", async () => {
    const f = fake();
    const state = await configureLab(policy, f.api, true);
    f.writes.length = 0;
    await configureLab(policy, f.api, true, state);
    expect(f.writes.some(w => w.method === "POST")).toBe(false);
  });
});
