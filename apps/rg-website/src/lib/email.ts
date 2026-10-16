import nodemailer from "nodemailer";

import { absoluteUrl } from "@/lib/site-url";

interface OrderConfirmationData {
  orderId: string;
  customerEmail: string;
  customerName?: string;
  totalAmount: number;
  items: {
    productName: string;
    variantName: string;
    quantity: number;
    price: number;
  }[];
  shippingAddress?: {
    address_line1?: string;
    address_line2?: string;
    city?: string;
    postal_code?: string;
    country?: string;
  };
}

// Créer le transporteur SMTP
const transporter = nodemailer.createTransport({
  auth: {
    pass: process.env.SMTP_PASSWORD,
    user: process.env.SMTP_USER || "contact@aphrody.com",
  },
  host: process.env.SMTP_HOST || "ssl0.ovh.net",
  port: parseInt(process.env.SMTP_PORT || "465", 10),
  secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465" || !process.env.SMTP_PORT, // true pour 465 (OVH), false pour 587
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: {
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
  }[];
}

export interface SendEmailResult {
  messageId: string;
  success: boolean;
  mocked?: boolean;
}

/**
 * Envoi générique, réutilisé par Better Auth (vérification d'adresse,
 * confirmation de suppression de compte). Les envois transactionnels de la
 * boutique ci-dessous gardent leur propre gabarit.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
  cc,
  bcc,
  attachments,
}: SendEmailOptions): Promise<SendEmailResult> {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.MOCK_EMAIL === "true" ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    return {
      messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      mocked: true,
      success: true,
    };
  }
  try {
    const defaultFrom =
      process.env.SMTP_FROM ||
      process.env.MAIL_FROM ||
      (process.env.NEXT_PUBLIC_APP_NAME === "Rose Griffon"
        ? '"Rose Griffon" <contact@rosegriffon.fr>'
        : '"Aphrody" <contact@aphrody.com>');
    const defaultReplyTo = replyTo || process.env.SMTP_REPLY_TO || process.env.MAIL_REPLY_TO || "contact@aphrody.com";
    const info = await transporter.sendMail({
      from: from || defaultFrom,
      html,
      subject,
      // Repli texte brut : certains clients refusent un message sans partie texte.
      text:
        text ??
        html
          .replaceAll(/<[^>]*>/g, " ")
          .replaceAll(/\s+/g, " ")
          .trim(),
      to,
      replyTo: defaultReplyTo,
      cc,
      bcc,
      attachments,
    });
    return {
      messageId: info.messageId,
      success: true,
    };
  } catch (error) {
    console.error("[email] envoi impossible", error);
    throw error;
  }
}

/**
 * Envoyer un email de confirmation de commande
 */
export async function sendOrderConfirmationEmail(data: OrderConfirmationData) {
  try {
    const itemsHtml = data.items
      .map(
        item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">${item.productName}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">${item.variantName}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right;">${item.price.toFixed(2)}€</td>
        <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right;">${(item.price * item.quantity).toFixed(2)}€</td>
      </tr>
    `,
      )
      .join("");

    const addressHtml = data.shippingAddress
      ? `
      <p style="margin: 8px 0;">
        <strong>Adresse de livraison:</strong><br/>
        ${data.shippingAddress.address_line1 || ""}<br/>
        ${data.shippingAddress.address_line2 ? `${data.shippingAddress.address_line2}<br/>` : ""}
        ${data.shippingAddress.postal_code || ""} ${data.shippingAddress.city || ""}<br/>
        ${data.shippingAddress.country || ""}
      </p>
    `
      : "";

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .footer { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }
            .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🐉 Commande confirmée !</h1>
            </div>
            <div class="content">
              <p>Bonjour ${data.customerName || "client"},</p>
              
              <p>Merci pour votre commande ! Nous avons bien reçu votre paiement. Voici un résumé de votre commande :</p>
              
              <p><strong>Numéro de commande:</strong> ${data.orderId}</p>
              
              <table>
                <thead>
                  <tr style="background: #f0f0f0;">
                    <th style="padding: 12px; text-align: left;">Produit</th>
                    <th style="padding: 12px; text-align: left;">Variante</th>
                    <th style="padding: 12px; text-align: center;">Quantité</th>
                    <th style="padding: 12px; text-align: right;">Prix unitaire</th>
                    <th style="padding: 12px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
              
              <div style="text-align: right; font-size: 18px; font-weight: bold; margin-top: 20px; padding-top: 20px; border-top: 2px solid #667eea;">
                <span>Montant total : ${data.totalAmount.toFixed(2)}€</span>
              </div>
              
              ${addressHtml}
              
              <p style="background: #e3f2fd; padding: 12px; border-left: 4px solid #667eea; border-radius: 4px; margin-top: 20px;">
                <strong>📦 Prochaines étapes:</strong><br/>
                Votre commande est en cours de traitement. Vous recevrez un email de confirmation d'expédition avec un numéro de suivi dans les 24-48 heures.
              </p>
              
              <p style="margin-top: 20px;">
                Si vous avez des questions, n'hésitez pas à nous contacter à <a href="mailto:contact@rose-griffon.com">contact@rose-griffon.com</a>
              </p>
              
              <p style="margin-top: 20px;">
                Merci de votre soutien ! 💜<br/>
                L'équipe Rose Griffon
              </p>
            </div>
            
            <div class="footer">
              <p>© 2025 Rose Griffon. Tous droits réservés.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SMTP_USER,
      html: htmlContent,
      subject: `🐉 Confirmation de commande #${data.orderId}`,
      to: data.customerEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    // Email envoyé avec succès
    return { messageId: info.messageId, success: true };
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email:", error);
    throw error;
  }
}

/**
 * Envoyer un email d'avis d'expédition
 */
export async function sendShippingNotificationEmail(customerEmail: string, orderId: string, trackingNumber?: string) {
  try {
    const trackingHtml = trackingNumber ? `<p><strong>Numéro de suivi:</strong> ${trackingNumber}</p>` : "";

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📦 Votre commande est en route !</h1>
            </div>
            <div class="content">
              <p>Bonjour,</p>
              
              <p>Votre commande <strong>#${orderId}</strong> a été expédiée !</p>
              
              ${trackingHtml}
              
              <p>Vous pouvez suivre votre colis sur le site du transporteur. Vous devriez le recevoir dans 5 à 7 jours ouvrables.</p>
              
              <p>Merci encore pour votre soutien ! 💜<br/>
              L'équipe Rose Griffon</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SMTP_USER,
      html: htmlContent,
      subject: `📦 Votre commande #${orderId} a été expédiée`,
      to: customerEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    return { messageId: info.messageId, success: true };
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email d'expédition:", error);
    throw error;
  }
}

/**
 * Envoyer un email de confirmation de livraison
 */
export async function sendDeliveryConfirmationEmail(customerEmail: string, orderId: string) {
  try {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #34d399 0%, #10b981 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Colis reçu !</h1>
            </div>
            <div class="content">
              <p>Bonjour,</p>
              
              <p>Super ! Votre commande <strong>#${orderId}</strong> a été livrée avec succès.</p>
              
              <p>Nous espérons que vous apprécierez votre achat. N'hésitez pas à nous contacter si vous avez des questions.</p>
              
              <p>Merci de votre confiance ! 💜<br/>
              L'équipe Rose Griffon</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SMTP_USER,
      html: htmlContent,
      subject: `✅ Votre commande #${orderId} a été livrée`,
      to: customerEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    return { messageId: info.messageId, success: true };
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email de livraison:", error);
    throw error;
  }
}

/**
 * Envoyer un email d'annulation de commande
 */
export async function sendOrderCancellationEmail(customerEmail: string, orderId: string, reason?: string) {
  try {
    const reasonHtml = reason ? `<p><strong>Raison:</strong> ${reason}</p>` : "";

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f87171 0%, #ef4444 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Commande annulée</h1>
            </div>
            <div class="content">
              <p>Bonjour,</p>
              
              <p>Votre commande <strong>#${orderId}</strong> a été annulée.</p>
              
              ${reasonHtml}
              
              <p>Si vous aviez déjà effectué un paiement, celui-ci sera remboursé sur votre compte bancaire dans 5 à 10 jours ouvrables.</p>
              
              <p>N'hésitez pas à nous contacter si vous avez des questions.<br/>
              L'équipe Rose Griffon</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SMTP_USER,
      html: htmlContent,
      subject: `❌ Votre commande #${orderId} a été annulée`,
      to: customerEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    return { messageId: info.messageId, success: true };
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email d'annulation:", error);
    throw error;
  }
}

/**
 * Envoyer un message depuis le formulaire de contact officiel
 */
export async function sendContactFormEmail(data: {
  title: string;
  subject: string;
  description: string;
  senderEmail?: string;
  senderName?: string;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[];
}): Promise<SendEmailResult> {
  const recipient = process.env.SMTP_TO_CONTACT || process.env.SMTP_USER || "contact@rosegriffon.fr";

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="padding:28px;background:#a14b3f;color:#ffffff">
        <h1 style="margin:0;font-size:20px;font-weight:700">Nouveau message de contact</h1>
        <p style="margin:6px 0 0;font-size:14px;opacity:0.9">Sujet : ${data.subject}</p>
      </td></tr>
      <tr><td style="padding:28px">
        <h2 style="margin:0 0 16px;font-size:18px;color:#1a1a1a">${data.title}</h2>
        ${data.senderEmail ? `<p style="margin:0 0 12px;font-size:14px;color:#666">De : <strong>${data.senderName ? `${data.senderName} (${data.senderEmail})` : data.senderEmail}</strong></p>` : ""}
        <div style="padding:16px;background:#f9f9f9;border-left:4px solid #a14b3f;border-radius:4px;font-size:15px;line-height:1.6;white-space:pre-wrap">
${data.description}
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f0f0f0;font-size:12px;color:#888" align="center">
        Association Rose Griffon · Formulaire web officiel
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return await sendEmail({
    to: recipient,
    replyTo: data.senderEmail,
    subject: `[Contact RG] ${data.subject} — ${data.title}`,
    html,
    text: `Titre: ${data.title}\nSujet: ${data.subject}\nDe: ${data.senderEmail || "anonyme"}\n\n${data.description}`,
    attachments: data.attachments,
  });
}

/**
 * Envoyer un message confidentiel à la cellule de médiation
 */
export async function sendMediationRequestEmail(data: {
  subject: string;
  message: string;
  senderEmail?: string;
  senderName?: string;
}): Promise<SendEmailResult> {
  const recipient = process.env.RG_MEDIATION_EMAIL?.trim() || "contact@rosegriffon.fr";

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border-top:4px solid #d97706">
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#92400e">Cellule de médiation — Saisine confidentielle</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#666">Objet : ${data.subject}</p>
        ${data.senderEmail ? `<p style="margin:0 0 16px;font-size:14px;color:#444">Contact : <strong>${data.senderName ? `${data.senderName} (${data.senderEmail})` : data.senderEmail}</strong></p>` : `<p style="margin:0 0 16px;font-size:14px;color:#888"><em>Saisine anonyme</em></p>`}
        <div style="padding:18px;background:#fffbeb;border:1px solid #fef3c7;border-radius:8px;font-size:15px;line-height:1.6;white-space:pre-wrap;color:#1f2937">
${data.message}
        </div>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">
          Ce message est strictement confidentiel et destiné uniquement aux membres de la cellule de médiation Rose Griffon.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return await sendEmail({
    to: recipient,
    replyTo: data.senderEmail,
    subject: `[Médiation Confidentielle] ${data.subject}`,
    html,
    text: `Médiation Confidentielle\nObjet: ${data.subject}\nDe: ${data.senderEmail || "anonyme"}\n\n${data.message}`,
  });
}

/**
 * Envoyer un email de notification tournoi / e-sport Achilléa
 */
export async function sendTournamentNotificationEmail(data: {
  recipientEmail: string;
  playerName: string;
  tournamentName: string;
  type: "registration_confirmed" | "match_ready" | "dispute_alert" | "podium";
  details?: string;
  tournamentUrl?: string;
}): Promise<SendEmailResult> {
  const titles: Record<string, string> = {
    registration_confirmed: "Inscription confirmée !",
    match_ready: "Votre prochain match est prêt",
    dispute_alert: "Signalement ouvert sur votre match",
    podium: "Félicitations pour votre podium !",
  };

  const title = titles[data.type] || "Information tournoi";
  const url = data.tournamentUrl || absoluteUrl("/achillea/tournaments");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:500px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="padding:28px;background:#1e1b4b;color:#ffffff" align="center">
        <h1 style="margin:0;font-size:22px;font-weight:700">⚔️ Achilléa E-sport</h1>
        <p style="margin:6px 0 0;font-size:15px;color:#a5b4fc">${data.tournamentName}</p>
      </td></tr>
      <tr><td style="padding:28px">
        <h2 style="margin:0 0 12px;font-size:18px">${title}</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#4a4a4a">
          Bonjour <strong>${data.playerName}</strong>,<br/><br/>
          ${data.details || `Des informations sont disponibles pour votre participation au tournoi ${data.tournamentName}.`}
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${url}" style="display:inline-block;padding:12px 28px;background:#4338ca;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px">
            Accéder au tournoi
          </a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#888" align="center">
        Achilléa · Ligue compétitive Inazuma Eleven
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return await sendEmail({
    to: data.recipientEmail,
    subject: `⚔️ [Achilléa] ${title} — ${data.tournamentName}`,
    html,
  });
}
