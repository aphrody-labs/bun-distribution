"use server";

import { sendContactFormEmail } from "@/lib/email";
import { createLogger } from "@/lib/logger";

import type { ContactFormValues } from "./schema";

const logger = createLogger("contact-email");

export async function sendContactEmail(formData: ContactFormValues) {
  try {
    logger.info("Envoi d'un email de contact", {
      hasFile: !!formData.file,
      subject: formData.subject,
    });

    let attachments:
      | {
          filename: string;
          content: Buffer;
          contentType: string;
        }[]
      | undefined;

    // Traiter la pièce jointe si présente
    if (
      formData.file &&
      formData.file instanceof File &&
      typeof formData.file === "object" &&
      "arrayBuffer" in formData.file &&
      "name" in formData.file &&
      "type" in formData.file
    ) {
      try {
        const fileBuffer = await formData.file.arrayBuffer();
        attachments = [
          {
            content: Buffer.from(fileBuffer),
            contentType: formData.file.type,
            filename: formData.file.name,
          },
        ];
        logger.debug("Pièce jointe ajoutée", {
          filename: formData.file.name,
          size: fileBuffer.byteLength,
        });
      } catch (error) {
        logger.error("Erreur lors du traitement de la pièce jointe", error);
      }
    }

    const result = await sendContactFormEmail({
      title: formData.title,
      subject: formData.subject,
      description: formData.description,
      attachments,
    });

    logger.info("Email de contact traité avec succès", { messageId: result.messageId });
    return { messageId: result.messageId, success: true };
  } catch (error) {
    logger.error("Erreur lors de l'envoi de l'email de contact", error);
    return {
      error: error instanceof Error ? error.message : "Erreur inconnue",
      success: false,
    };
  }
}
