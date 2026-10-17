// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { OvhClient } from "../src/client.js";
import { OvhEmail } from "../src/email.js";
import { OvhVps } from "../src/vps.js";

class MockEmailVpsClient extends OvhClient {
  constructor() {
    super({
      applicationKey: "mock_ak",
      applicationSecret: "mock_as",
      consumerKey: "mock_ck",
    });
  }

  public override async request<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string): Promise<T> {
    if (path === "/vps") {
      return ["vps-203bea89.vps.ovh.net"] as T;
    }
    if (path === "/vps/vps-203bea89.vps.ovh.net") {
      return {
        name: "vps-203bea89.vps.ovh.net",
        displayName: "rg",
        state: "running",
        cluster: "sbg6",
        zone: "sbg",
        model: { name: "vps-4-2026", memory: 8192, vcore: 4, disk: 160 },
        slaMonitoring: true,
      } as T;
    }
    if (path === "/vps/vps-203bea89.vps.ovh.net/ips") {
      return ["51.77.147.152"] as T;
    }
    if (path === "/vps/vps-203bea89.vps.ovh.net/ips/51.77.147.152") {
      return {
        ip: "51.77.147.152",
        type: "primary",
        gateway: "51.77.147.254",
      } as T;
    }
    if (path === "/vps/vps-203bea89.vps.ovh.net/status") {
      return { state: "running", ping: true, up: true } as T;
    }
    if (path === "/email/domain/aphrody.com") {
      return {
        domain: "aphrody.com",
        status: "ok",
        offer: "mxplan",
        allowedAccountSize: [5000],
      } as T;
    }
    if (path === "/email/domain/aphrody.com/account") {
      return ["contact", "admin"] as T;
    }
    if (path === "/email/domain/aphrody.com/redirection") {
      return ["12345"] as T;
    }
    if (path === "/email/domain/aphrody.com/redirection/12345") {
      return {
        id: "12345",
        from: "hello@aphrody.com",
        to: "contact@aphrody.com",
      } as T;
    }
    return {} as T;
  }
}

describe("OvhEmail and OvhVps Engines", () => {
  it("inspects VPS hardware details and cluster", async () => {
    const mock = new MockEmailVpsClient();
    const vps = new OvhVps(mock);

    const list = await vps.listVps();
    expect(list).toEqual(["vps-203bea89.vps.ovh.net"]);

    const details = await vps.getVps("vps-203bea89.vps.ovh.net");
    expect(details.displayName).toBe("rg");
    expect(details.state).toBe("running");
    expect(details.cluster).toBe("sbg6");
    expect(details.memory).toBe(8192);
    expect(details.vcore).toBe(4);
    expect(details.disk).toBe(160);

    const ips = await vps.getIps("vps-203bea89.vps.ovh.net");
    expect(ips[0].ip).toBe("51.77.147.152");
    expect(ips[0].version).toBe("v4");
  });

  it("inspects Email accounts and redirections", async () => {
    const mock = new MockEmailVpsClient();
    const email = new OvhEmail(mock);

    const domainInfo = await email.getDomain("aphrody.com");
    expect(domainInfo.domain).toBe("aphrody.com");
    expect(domainInfo.offer).toBe("mxplan");

    const redirections = await email.listRedirections("aphrody.com");
    expect(redirections.length).toBe(1);
    expect(redirections[0].from).toBe("hello@aphrody.com");
    expect(redirections[0].to).toBe("contact@aphrody.com");
  });
});
