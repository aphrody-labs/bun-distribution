import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

describe("API Route /api/email/inbound", () => {
  it("GET renvoie l'état du service de réception", async () => {
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.service).toBe("rg-email-inbound");
    expect(data.status).toBe("active");
    expect(data.categories).toContain("mediation");
    expect(data.categories).toContain("tournament");
  });

  it("POST traite un webhook d'email entrant", async () => {
    const payload = {
      from: "challenger@inazuma.jp",
      to: "tournoi@rosegriffon.fr",
      subject: "Inscription Tournoi",
      text: "Je confirme mon inscription.",
    };

    const req = new NextRequest("http://localhost:3000/api/email/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.email).toBeDefined();
    expect(data.email.category).toBe("tournament");
    expect(data.email.recipient).toBe("tournoi@rosegriffon.fr");
    expect(data.email.status).toBe("unread");
  });

  it("POST rejette une requête sans expéditeur valide", async () => {
    const payload = {
      to: "contact@rosegriffon.fr",
      subject: "Sans expéditeur",
      text: "Contenu anonyme",
    };

    const req = new NextRequest("http://localhost:3000/api/email/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("expediteur_manquant");
  });

  it("POST valide le secret d'autorisation quand EMAIL_INBOUND_SECRET est configuré", async () => {
    process.env.EMAIL_INBOUND_SECRET = "super-secret-key-123";
    try {
      const payload = {
        from: "member@inazuma.jp",
        to: "contact@rosegriffon.fr",
        subject: "Test Secret",
        text: "Message sécurisé",
      };

      // Sans secret -> 401
      const reqUnauthorized = new NextRequest("http://localhost:3000/api/email/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const resUnauthorized = await POST(reqUnauthorized);
      expect(resUnauthorized.status).toBe(401);

      // Avec secret dans le header Authorization -> 200
      const reqAuthorized = new NextRequest("http://localhost:3000/api/email/inbound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secret-key-123",
        },
        body: JSON.stringify(payload),
      });
      const resAuthorized = await POST(reqAuthorized);
      expect(resAuthorized.status).toBe(200);
    } finally {
      delete process.env.EMAIL_INBOUND_SECRET;
    }
  });
});
