// SPDX-License-Identifier: Apache-2.0
// Password accounts and sessions for an app's API, on Bun only: `Bun.password` (argon2id) for the hashes, a
// `bun:sqlite` database (see `m3Db`) for users and sessions, an HttpOnly session cookie through `request.cookies`
// (`Bun.CookieMap`), and `Bun.CSRF` tokens bound to the session for every state-changing route.
//
//   const auth = m3Auth({ db: m3Db("data/app.sqlite"), secret: await ensureSecret("session-key") });
//   export default defineM3Api({ ...auth.routes, "/api/notes": auth.csrf.protect({ POST: … }) });
import type { Database } from "bun:sqlite";
import {
  m3Csrf,
  readBody,
  type M3Csrf,
  type M3Request,
  type M3Routes,
} from "./api.ts";

export interface M3AuthOptions {
  db: Database;
  /** Signing secret of the CSRF tokens (see `ensureSecret`). */
  secret: string;
  /** Session cookie (default `m3-session`). */
  cookie?: string;
  /** Session lifetime in seconds (default 7 days). */
  maxAge?: number;
  /** `Secure` cookie (default true; set false for plain-HTTP development). */
  secure?: boolean;
  /** Route prefix (default `/api/m3/auth`). */
  prefix?: string;
  /** Accept new accounts through `POST <prefix>/register` (default true). */
  register?: boolean;
}

export interface M3User {
  id: number;
  email: string;
}

export interface M3Auth {
  /** `POST register`, `POST login`, `POST logout`, `GET me` (with a fresh CSRF token) under the prefix. */
  routes: M3Routes;
  /** The signed-in user of a request, if any. */
  user(request: M3Request): M3User | undefined;
  /** CSRF tokens bound to the session: `csrf.protect(route)` guards the app's own routes. */
  csrf: M3Csrf;
}

const sha256 = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
let dummy: Promise<string> | undefined;
const dummyHash = (): Promise<string> =>
  (dummy ??= Bun.password.hash("m3-bun-dummy-password", {
    algorithm: "argon2id",
  }));
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const credentials = async (
  request: M3Request,
): Promise<{ email: string; password: string } | Response> => {
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return Response.json({ error: "unreadable body" }, { status: 400 });
  }
  const { email, password } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
  };
  if (
    typeof email !== "string" ||
    !EMAIL.test(email) ||
    typeof password !== "string" ||
    password.length < 8
  )
    return Response.json(
      { error: "an email and a password of 8 characters or more are required" },
      { status: 400 },
    );
  return { email, password };
};

export function m3Auth(options: M3AuthOptions): M3Auth {
  const {
    db,
    cookie = "m3-session",
    maxAge = 7 * 24 * 3600,
    secure = true,
    prefix = "/api/m3/auth",
  } = options;
  db.run(`CREATE TABLE IF NOT EXISTS m3_users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, created INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS m3_sessions (
    token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES m3_users(id) ON DELETE CASCADE, expires INTEGER NOT NULL)`);
  const insertUser = db.query<
    { id: number },
    { email: string; password: string; created: number }
  >(
    "INSERT INTO m3_users (email, password, created) VALUES ($email, $password, $created) RETURNING id",
  );
  const userByEmail = db.query<
    M3User & { password: string },
    { email: string }
  >("SELECT id, email, password FROM m3_users WHERE email = $email");
  const insertSession = db.query<
    unknown,
    { token: string; user: number; expires: number }
  >(
    "INSERT INTO m3_sessions (token, user, expires) VALUES ($token, $user, $expires)",
  );
  const userBySession = db.query<M3User, { token: string; now: number }>(
    "SELECT u.id, u.email FROM m3_sessions s JOIN m3_users u ON u.id = s.user WHERE s.token = $token AND s.expires > $now",
  );
  const deleteSession = db.query<unknown, { token: string }>(
    "DELETE FROM m3_sessions WHERE token = $token",
  );
  const purge = db.query<unknown, { now: number }>(
    "DELETE FROM m3_sessions WHERE expires <= $now",
  );

  const sessionOf = (request: M3Request): string | undefined => {
    const token = request.cookies.get(cookie);
    return token ? sha256(token) : undefined;
  };
  const user = (request: M3Request): M3User | undefined => {
    const session = sessionOf(request);
    return session
      ? (userBySession.get({ token: session, now: Date.now() }) ?? undefined)
      : undefined;
  };
  const csrf = m3Csrf({ secret: options.secret, sessionOf });

  const routes: M3Routes = {
    [`${prefix}/login`]: {
      POST: async (request) => {
        const input = await credentials(request);
        if (input instanceof Response) return input;
        const found = userByEmail.get({ email: input.email });
        // Verify against a dummy hash when the account is unknown, so timing does not reveal which emails exist.
        const ok = await Bun.password.verify(
          input.password,
          found?.password ?? (await dummyHash()),
        );
        if (!found || !ok)
          return Response.json(
            { error: "invalid email or password" },
            { status: 401 },
          );
        const now = Date.now();
        purge.run({ now });
        const token = Buffer.from(
          crypto.getRandomValues(new Uint8Array(32)),
        ).toString("base64url");
        insertSession.run({
          token: sha256(token),
          user: found.id,
          expires: now + maxAge * 1000,
        });
        request.cookies.set(cookie, token, {
          httpOnly: true,
          secure,
          sameSite: "strict",
          path: "/",
          maxAge,
        });
        return Response.json({
          user: { id: found.id, email: found.email },
          csrf: csrf.token(sha256(token)),
        });
      },
    },
    [`${prefix}/logout`]: csrf.protect({
      POST: (request) => {
        const session = sessionOf(request);
        if (session) deleteSession.run({ token: session });
        request.cookies.delete({ name: cookie, path: "/" });
        return new Response(null, { status: 204 });
      },
    }),
    [`${prefix}/me`]: {
      GET: (request) => {
        const current = user(request);
        if (!current)
          return Response.json({ error: "not signed in" }, { status: 401 });
        return Response.json({
          user: current,
          csrf: csrf.token(sessionOf(request)),
        });
      },
    },
  };
  if (options.register !== false)
    routes[`${prefix}/register`] = {
      POST: async (request) => {
        const input = await credentials(request);
        if (input instanceof Response) return input;
        const password = await Bun.password.hash(input.password, {
          algorithm: "argon2id",
        });
        try {
          const { id } = insertUser.get({
            email: input.email,
            password,
            created: Date.now(),
          })!;
          return Response.json(
            { user: { id, email: input.email } },
            { status: 201 },
          );
        } catch (error) {
          if (String(error).includes("UNIQUE"))
            return Response.json(
              { error: "email already registered" },
              { status: 409 },
            );
          throw error;
        }
      },
    };
  return { routes, user, csrf };
}
