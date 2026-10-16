"use client";

import { z } from "zod";

// Vérifie si le code s'exécute dans un navigateur (côté client)
const isClient = typeof window !== "undefined";

// Constante pour la taille maximale de fichier (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Schéma pour le formulaire de contact
export const contactFormSchema = z.object({
  description: z.string().min(10, {
    message: "La description doit contenir au moins 10 caractères.",
  }),
  file: isClient
    ? z
        .instanceof(File)
        .refine(
          file => {
            if (!file || file.size === 0) return true;

            const acceptedTypes = [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "image/jpeg",
              "image/png",
              "image/gif",
              "text/plain",
            ];

            return acceptedTypes.includes(file.type);
          },
          {
            message: "Format de fichier non valide. Formats acceptés: PDF, DOCX, images et TXT.",
          },
        )
        .refine(
          file => {
            if (!file || file.size === 0) return true;
            return file.size <= MAX_FILE_SIZE;
          },
          {
            message: "Le fichier doit faire moins de 5MB.",
          },
        )
        .nullable()
        .optional()
    : z.any().nullable().optional(),
  subject: z.enum(
    [
      "Information sur l'association",
      "Collaboration",
      "Don et soutien",
      "Événements à venir",
      "Adhésion",
      "Bénévolat",
      "Demande de presse",
      "Témoignage",
      "Support technique",
      "Autres",
    ],
    {
      message: "Veuillez sélectionner un sujet.",
    },
  ),
  title: z.string().min(2, {
    message: "Le titre doit contenir au moins 2 caractères.",
  }),
});

// Type du formulaire de contact
export type ContactFormValues = z.infer<typeof contactFormSchema>;
