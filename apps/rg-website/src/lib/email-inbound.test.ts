import { describe, expect, it } from "bun:test";
import { categorizeEmail, extractEmailAddress, parseInboundWebhook, processInboundEmail } from "./email-inbound";

describe("Gestion de Réception de Mail (Inbound Email Service)", () => {
  describe("extractEmailAddress", () => {
    it("extrait l'adresse email et le nom depuis un format standard RFC", () => {
      const res = extractEmailAddress("Axel Blaze <axel.blaze@inazuma.jp>");
      expect(res.email).toBe("axel.blaze@inazuma.jp");
      expect(res.name).toBe("Axel Blaze");
    });

    it("gère les guillemets autour du nom", () => {
      const res = extractEmailAddress('"Mark Evans" <mark@raimon.jp>');
      expect(res.email).toBe("mark@raimon.jp");
      expect(res.name).toBe("Mark Evans");
    });

    it("gère une adresse email nue", () => {
      const res = extractEmailAddress("jude.sharp@royal.jp");
      expect(res.email).toBe("jude.sharp@royal.jp");
      expect(res.name).toBeUndefined();
    });

    it("gère une chaîne vide", () => {
      const res = extractEmailAddress("");
      expect(res.email).toBe("");
    });
  });

  describe("categorizeEmail", () => {
    it("catégorise les demandes pour la cellule de médiation", () => {
      expect(categorizeEmail(["mediation@rosegriffon.fr"], "Signalement")).toBe("mediation");
      expect(categorizeEmail(["contact@rosegriffon.fr"], "Demande d'aide médiation")).toBe("mediation");
    });

    it("catégorise les messages tournoi / achilléa / e-sport", () => {
      expect(categorizeEmail(["tournoi@rosegriffon.fr"], "Inscription")).toBe("tournament");
      expect(categorizeEmail(["esport@rosegriffon.fr"], "Question")).toBe("tournament");
      expect(categorizeEmail(["contact@rosegriffon.fr"], "Litige sur le tournoi Astral")).toBe("tournament");
    });

    it("catégorise les partenariats", () => {
      expect(categorizeEmail(["partenariat@rosegriffon.fr"], "Offre de sponsoring")).toBe("partnership");
    });

    it("catégorise les demandes de support technique", () => {
      expect(categorizeEmail(["support@rosegriffon.fr"], "Impossible de charger mon avatar")).toBe("support");
      expect(categorizeEmail(["contact@rosegriffon.fr"], "Bug sur la boutique")).toBe("support");
    });

    it("classe par défaut en général", () => {
      expect(categorizeEmail(["contact@rosegriffon.fr"], "Bonjour à l'équipe")).toBe("general");
    });
  });

  describe("parseInboundWebhook", () => {
    it("parse un webhook au format Resend Inbound", () => {
      const resendPayload = {
        type: "email.created",
        data: {
          email_id: "resend-msg-123",
          from: "Shawn Frost <shawn@hokkaido.jp>",
          to: ["tournoi@rosegriffon.fr"],
          subject: "Inscription Tournoi d'Hiver",
          text: "Bonjour, je souhaite m'inscrire.",
          html: "<p>Bonjour, je souhaite m'inscrire.</p>",
          attachments: [
            {
              filename: "licence.pdf",
              content_type: "application/pdf",
              size: 2048,
            },
          ],
        },
      };

      const parsed = parseInboundWebhook(resendPayload);
      expect(parsed.from).toBe("shawn@hokkaido.jp");
      expect(parsed.fromName).toBe("Shawn Frost");
      expect(parsed.to).toEqual(["tournoi@rosegriffon.fr"]);
      expect(parsed.category).toBe("tournament");
      expect(parsed.subject).toBe("Inscription Tournoi d'Hiver");
      expect(parsed.attachments?.length).toBe(1);
      expect(parsed.attachments?.[0].filename).toBe("licence.pdf");
    });

    it("parse un webhook au format Postmark Inbound", () => {
      const postmarkPayload = {
        MessageID: "postmark-uuid-456",
        From: "Nathan Swift <nathan@raimon.jp>",
        FromName: "Nathan Swift",
        To: "mediation@rosegriffon.fr",
        Subject: "Question confidentielle",
        TextBody: "Bonjour, question de médiation.",
        HtmlBody: "<p>Bonjour, question de médiation.</p>",
      };

      const parsed = parseInboundWebhook(postmarkPayload);
      expect(parsed.from).toBe("nathan@raimon.jp");
      expect(parsed.fromName).toBe("Nathan Swift");
      expect(parsed.category).toBe("mediation");
      expect(parsed.subject).toBe("Question confidentielle");
      expect(parsed.messageId).toBe("postmark-uuid-456");
    });

    it("parse un format générique JSON", () => {
      const genericPayload = {
        from: "hurley@okinawa.jp",
        name: "Hurley Kane",
        to: "support@rosegriffon.fr",
        subject: "Problème de connexion",
        text: "Je n'arrive pas à me connecter.",
      };

      const parsed = parseInboundWebhook(genericPayload);
      expect(parsed.from).toBe("hurley@okinawa.jp");
      expect(parsed.category).toBe("support");
      expect(parsed.subject).toBe("Problème de connexion");
    });
  });

  describe("processInboundEmail", () => {
    it("persiste et traite un message entrant", async () => {
      const emailData = {
        from: "player@inazuma.jp",
        fromName: "Player One",
        to: ["contact@rosegriffon.fr"],
        subject: "Information adhésion",
        text: "Bonjour, comment adhérer à l'association ?",
      };

      const result = await processInboundEmail(emailData, { sendAutoReply: false });

      expect(result.id).toBeDefined();
      expect(result.sender).toBe("player@inazuma.jp");
      expect(result.recipient).toBe("contact@rosegriffon.fr");
      expect(result.category).toBe("general");
      expect(result.status).toBe("unread");
    });
  });
});
