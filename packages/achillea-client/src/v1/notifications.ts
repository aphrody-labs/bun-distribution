/**
 * `/notifications` — boîte de réception du joueur et relais temps réel internes.
 *
 * Les trois routes `emit-*` / `ranked-proof` sont INTERNES : elles exigent
 * l'en-tête `x-internal-secret` (ou un appel en loopback) et ne sont pas
 * destinées à un navigateur. Elles figurent ici pour que la surface d'API soit
 * complète et utilisable depuis un service serveur à serveur.
 */

import { z } from "zod";

import type { NotificationModel } from "@rosegriffon/achillea-types/domain/notification";
import { NotificationCategory, NotificationType } from "@rosegriffon/achillea-types/enums/notification";

import { apiEnvelopeSchema, successResponseSchema } from "./common";
import { AchilleaResource, encodePathSegment, type AchilleaClientResult } from "./http";
import type { ApiEnvelope, SuccessResponse } from "./pending-contracts";

export const notificationTypeSchema = z.enum(NotificationType) satisfies z.ZodType<NotificationType>;
export const notificationCategorySchema = z.enum(NotificationCategory) satisfies z.ZodType<NotificationCategory>;

export const notificationModelSchema = z.object({
  id: z.number(),
  title: z.string(),
  message: z.string(),
  type: notificationTypeSchema,
  category: notificationCategorySchema,
  payload: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<NotificationModel>;

const notificationListEnvelopeSchema = apiEnvelopeSchema(z.array(notificationModelSchema));

/** En-tête du secret partagé entre le bot et le sous-process ranked. */
export const INTERNAL_SECRET_HEADER = "x-internal-secret" as const;

/** 7 routes. */
export class NotificationsResource extends AchilleaResource {
  /** `GET /notifications/me` — notifications non lues du compte connecté. */
  mine(): Promise<AchilleaClientResult<ApiEnvelope<NotificationModel[]>>> {
    return this.http.get("/notifications/me", notificationListEnvelopeSchema);
  }

  /** `PATCH /notifications/read/:id` — marque une notification comme lue. */
  markAsRead(id: number): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.patch(`/notifications/read/${encodePathSegment(id)}`, successResponseSchema);
  }

  /** `PATCH /notifications/unread/:id` — remet une notification en non lue. */
  markAsUnread(id: number): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.patch(`/notifications/unread/${encodePathSegment(id)}`, successResponseSchema);
  }

  /** `PATCH /notifications/read-all` — vide la boîte de réception. */
  markAllAsRead(): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.patch("/notifications/read-all", successResponseSchema);
  }

  /** `POST /notifications/emit-match-found` — relais interne d'un appariement ranked. */
  emitMatchFound(
    userIds: string[],
    payload: unknown,
    internalSecret?: string,
  ): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post(
      "/notifications/emit-match-found",
      successResponseSchema,
      { userIds, payload },
      { headers: internalHeaders(internalSecret) },
    );
  }

  /** `POST /notifications/emit-to-users` — relais interne d'un évènement arbitraire. */
  emitToUsers(
    userIds: string[],
    event: string,
    payload: unknown,
    internalSecret?: string,
  ): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post(
      "/notifications/emit-to-users",
      successResponseSchema,
      { userIds, event, payload },
      { headers: internalHeaders(internalSecret) },
    );
  }

  /** `POST /notifications/ranked-proof` — relaie une preuve de litige aux organisateurs. */
  relayRankedProof(
    payload: { lobbyId: number; userId: string; url: string },
    internalSecret?: string,
  ): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/notifications/ranked-proof", successResponseSchema, payload, {
      headers: internalHeaders(internalSecret),
    });
  }
}

function internalHeaders(secret?: string): Record<string, string> {
  return secret ? { [INTERNAL_SECRET_HEADER]: secret } : {};
}
