import { t } from "elysia";

const sanction = t.Object({
  id: t.String(),
  userId: t.String(),
  guildId: t.String(),
  type: t.String(),
  reason: t.Nullable(t.String()),
  durationSec: t.Nullable(t.Number()),
  issuedBy: t.String(),
  issuedByType: t.String(),
  expiresAt: t.Nullable(t.String()),
  revokedAt: t.Nullable(t.String()),
  revokedBy: t.Nullable(t.String()),
  revokeReason: t.Nullable(t.String()),
  evidence: t.Nullable(t.Array(t.Record(t.String(), t.Any()))),
  createdAt: t.String(),
});

export const SanctionModel = {
  sanction,
  list: t.Object({
    data: t.Array(sanction),
    total: t.Number(),
    meta: t.Object({ page: t.Number(), pageSize: t.Number(), pageCount: t.Number() }),
  }),
  unauthorized: t.Object({ message: t.Literal("Authentication required") }),
};
