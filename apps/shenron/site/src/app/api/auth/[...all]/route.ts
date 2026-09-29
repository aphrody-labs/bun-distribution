import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Next 16 canary + Better Auth : on force runtime nodejs (pas edge) car
// Better Auth utilise des Node APIs (crypto, drizzle/postgres-js).
// dynamic = "force-dynamic" évite Next de cacher les responses /api/auth/*
// (sinon Vercel pourrait servir un 200 cached → session jamais visible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const { GET, POST } = toNextJsHandler(auth);
