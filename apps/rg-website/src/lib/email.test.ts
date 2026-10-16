import { describe, expect, it } from "bun:test";
import { sendContactFormEmail, sendEmail, sendMediationRequestEmail, sendTournamentNotificationEmail } from "./email";

describe("Gestion d'Envoi d'Email (Email Service)", () => {
  it("envoie un email générique avec succès (mode simulé/connecté)", async () => {
    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test unitaire email",
      html: "<p>Contenu test</p>",
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  it("génère et envoie l'email de formulaire de contact", async () => {
    const result = await sendContactFormEmail({
      title: "Proposition de partenariat",
      subject: "Collaboration",
      description: "Bonjour, nous souhaiterions collaborer.",
      senderEmail: "partenaire@exemple.fr",
      senderName: "Directeur Partenariats",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  it("génère et envoie l'email confidentiel à la cellule de médiation", async () => {
    const result = await sendMediationRequestEmail({
      subject: "Demande de contact confidentiel",
      message: "Bonjour, j'aimerais échanger avec un médiateur.",
      senderEmail: "membre@rosegriffon.fr",
      senderName: "Membre RG",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  it("génère et envoie les notifications de tournoi Achilléa", async () => {
    const result = await sendTournamentNotificationEmail({
      recipientEmail: "joueur@rosegriffon.fr",
      playerName: "JudeSharp",
      tournamentName: "Astral League Season 1",
      type: "registration_confirmed",
      details: "Votre inscription est validée dans la poule B.",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });
});
