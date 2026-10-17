import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { resolveAchilleaSession } from "../../auth/session";
import { WalletModel } from "./model";
import { WalletService } from "./service";

async function sessionOrUnauthorized(headers: { authorization?: string; cookie?: string }) {
  return resolveAchilleaSession(headers);
}

export const walletController = new Elysia({ prefix: "/wallet" })
  .use(dbPlugin)
  .get(
    "/me",
    async ({ db, headers }) => {
      const session = await sessionOrUnauthorized(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const wallet = await WalletService.getOrCreate(db, session.id);
      return { balance: Number(wallet.balance), currency: wallet.currency };
    },
    { response: { 200: WalletModel.balance, 401: WalletModel.unauthorized } },
  )
  .get(
    "/me/history",
    async ({ db, headers, query }) => {
      const session = await sessionOrUnauthorized(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)));
      const offset = Math.max(0, Math.floor(query.offset ?? 0));
      return { transactions: await WalletService.history(db, session.id, limit, offset) };
    },
    {
      query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }),
      response: { 200: WalletModel.history, 401: WalletModel.unauthorized },
    },
  );
