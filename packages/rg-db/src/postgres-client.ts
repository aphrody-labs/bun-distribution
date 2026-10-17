import { createAchilleaSql } from "./achillea-sql";
import { createInagleSql } from "./inagle-sql";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";
import type { Database } from "./schema";

type SqlExecutor = {
  executeQuery: (query: { sql: string; parameters: readonly unknown[] }) => Promise<{ rows: unknown[] }>;
};

type QueryError = Error & { code?: string };
type Result = { data: any; error: QueryError | null; count: number | null };
type Mutation = "insert" | "update" | "delete" | "upsert";

function identifier(value: string): string {
  const jsonPath = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)->>([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (jsonPath) return `"${jsonPath[1]}"->>'${jsonPath[2]}'`;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

function projection(value: string): string {
  if (value === "*") return "*";
  if (!/^[a-zA-Z0-9_ *,.'()\-:>]+$/.test(value)) throw new Error("Invalid SQL projection");
  return value;
}

/** Small PostgREST-shaped SQL façade used by legacy callers during migration. */
export class PostgresQueryBuilder implements PromiseLike<Result> {
  private projectionSql = "*";
  private readonly where: string[] = [];
  private readonly params: unknown[] = [];
  private readonly ordering: string[] = [];
  private maxRows: number | null = null;
  private offset = 0;
  private mode: "many" | "single" | "maybe" = "many";
  private countRequested = false;
  private mutation: Mutation | null = null;
  private payload: unknown = null;
  private conflict: string | null = null;

  constructor(
    private readonly db: SqlExecutor,
    private readonly table: string,
  ) {}

  select(fields = "*", options?: { count?: string; head?: boolean }) {
    this.projectionSql = projection(fields);
    this.countRequested = Boolean(options?.count);
    return this;
  }
  insert(values: unknown) {
    this.mutation = "insert";
    this.payload = values;
    return this;
  }
  update(values: unknown) {
    this.mutation = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.mutation = "delete";
    return this;
  }
  upsert(values: unknown, options?: { onConflict?: string }) {
    this.mutation = "upsert";
    this.payload = values;
    this.conflict = options?.onConflict ?? null;
    return this;
  }
  private value(value: unknown) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  private condition(column: string, operator: string, value: unknown) {
    const col = identifier(column);
    this.where.push(
      value === null ? `${col} IS ${operator === "=" ? "" : "NOT "}NULL` : `${col} ${operator} ${this.value(value)}`,
    );
    return this;
  }
  eq(column: string, value: unknown) {
    return this.condition(column, "=", value);
  }
  neq(column: string, value: unknown) {
    return this.condition(column, "!=", value);
  }
  gt(column: string, value: unknown) {
    return this.condition(column, ">", value);
  }
  gte(column: string, value: unknown) {
    return this.condition(column, ">=", value);
  }
  lt(column: string, value: unknown) {
    return this.condition(column, "<", value);
  }
  lte(column: string, value: unknown) {
    return this.condition(column, "<=", value);
  }
  is(column: string, operator: "null" | "true" | "false", value: unknown) {
    if (operator === "null") this.where.push(`${identifier(column)} IS ${value === null ? "NULL" : "NOT NULL"}`);
    else this.where.push(`${identifier(column)} IS ${operator === "true" ? "TRUE" : "FALSE"}`);
    return this;
  }
  ilike(column: string, value: string) {
    this.where.push(`${identifier(column)} ILIKE ${this.value(value)}`);
    return this;
  }
  textSearch(column: string, query: string, options?: { config?: string }) {
    const config = options?.config ?? "simple";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config)) throw new Error("Invalid text search config");
    this.where.push(`${identifier(column)} @@ to_tsquery(${this.value(config)}, ${this.value(query)})`);
    return this;
  }
  like(column: string, value: string) {
    this.where.push(`${identifier(column)} LIKE ${this.value(value)}`);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.where.push(
      values.length ? `${identifier(column)} IN (${values.map(value => this.value(value)).join(", ")})` : "FALSE",
    );
    return this;
  }
  not(column: string, operator: "is" | "like" | "ilike", value: unknown) {
    if (operator === "is") {
      this.where.push(`${identifier(column)} IS ${value === null ? "NOT NULL" : "NOT " + String(value).toUpperCase()}`);
      return this;
    }
    this.where.push(`${identifier(column)} NOT ${operator.toUpperCase()} ${this.value(value)}`);
    return this;
  }
  or(expression: string) {
    const parts = expression.split(",").map(part => {
      const tokens = part.split(".");
      const [column, operator, value] = tokens;
      if (!column || !operator) throw new Error(`Invalid OR filter: ${part}`);
      if (operator === "is" && value === "null") return `${identifier(column)} IS NULL`;
      if (operator === "not" && value === "null") return `${identifier(column)} IS NOT NULL`;
      if (operator === "not" && value === "is" && tokens[3] === "null") {
        return `${identifier(column)} IS NOT NULL`;
      }
      if (operator === "eq") return `${identifier(column)} = ${this.value(value ?? "")}`;
      if (operator === "like" || operator === "ilike")
        return `${identifier(column)} ${operator.toUpperCase()} ${this.value(value ?? "")}`;
      throw new Error(`Unsupported OR operator: ${operator}`);
    });
    this.where.push(`(${parts.join(" OR ")})`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordering.push(
      `${identifier(column)} ${options?.ascending === false ? "DESC" : "ASC"}${options?.nullsFirst === undefined ? "" : options.nullsFirst ? " NULLS FIRST" : " NULLS LAST"}`,
    );
    return this;
  }
  limit(value: number) {
    this.maxRows = value;
    return this;
  }
  range(from: number, to: number) {
    this.offset = from;
    this.maxRows = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    this.maxRows = 1;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    this.maxRows = 1;
    return this;
  }

  private whereSql() {
    return this.where.length ? ` WHERE ${this.where.join(" AND ")}` : "";
  }
  private pagingSql() {
    return `${this.maxRows === null ? "" : ` LIMIT ${this.maxRows}`}${this.offset ? ` OFFSET ${this.offset}` : ""}`;
  }

  private mutationSql(): string {
    const values = Array.isArray(this.payload) ? this.payload : [this.payload];
    if (!values.length || !values.every(value => value && typeof value === "object"))
      throw new Error("SQL mutation payload must contain objects");
    const rows = values as Array<Record<string, unknown>>;
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (!columns.length) throw new Error("SQL mutation payload is empty");
    const quoted = columns.map(identifier).join(", ");
    const tuples = rows.map(row => `(${columns.map(column => this.value(row[column] ?? null)).join(", ")})`).join(", ");
    if (this.mutation === "insert")
      return `INSERT INTO ${identifier(this.table)} (${quoted}) VALUES ${tuples} RETURNING ${this.projectionSql}`;
    if (this.mutation === "upsert") {
      const conflict = (this.conflict ?? "id").split(",").map(identifier).join(", ");
      const updates = columns
        .filter(column => !this.conflict?.split(",").includes(column))
        .map(column => `${identifier(column)} = EXCLUDED.${identifier(column)}`)
        .join(", ");
      return `INSERT INTO ${identifier(this.table)} (${quoted}) VALUES ${tuples} ON CONFLICT (${conflict}) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"} RETURNING ${this.projectionSql}`;
    }
    if (this.mutation === "update") {
      // `tuples` above already appended payload values after the filter
      // values. Rebuild the parameter list in SQL order: SET, then WHERE.
      const whereParams = this.params.slice(0, this.params.length - columns.length);
      this.params.length = 0;
      const assignments = columns
        .map(column => `${identifier(column)} = ${this.value(rows[0]![column] ?? null)}`)
        .join(", ");
      const offsetWhere = columns.length;
      this.params.push(...whereParams);
      const where = this.whereSql().replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + offsetWhere}`);
      return `UPDATE ${identifier(this.table)} SET ${assignments}${where} RETURNING ${this.projectionSql}`;
    }
    return `DELETE FROM ${identifier(this.table)}${this.whereSql()} RETURNING ${this.projectionSql}`;
  }

  async execute(): Promise<Result> {
    try {
      const table = identifier(this.table);
      const query = this.mutation
        ? this.mutationSql()
        : `SELECT ${this.projectionSql} FROM ${table}${this.whereSql()}${this.ordering.length ? ` ORDER BY ${this.ordering.join(", ")}` : ""}${this.pagingSql()}`;
      const result = await this.db.executeQuery({ sql: query, parameters: this.params });
      const rows = result.rows as any[];
      const countResult =
        this.countRequested && !this.mutation
          ? await this.db.executeQuery({
              sql: `SELECT COUNT(*)::int AS count FROM ${table}${this.whereSql()}`,
              parameters: this.params,
            })
          : null;
      const count = countResult ? Number((countResult.rows as any[])[0]?.count ?? 0) : null;
      if (this.mode === "single" && rows.length !== 1)
        return { data: null, error: new Error("Expected exactly one row"), count };
      return { data: this.mode === "many" ? rows : (rows[0] ?? null), error: null, count };
    } catch (cause) {
      return {
        data: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
        count: null,
      };
    }
  }
  // Query builders are intentionally awaitable for the PostgREST-compatible API.
  // eslint-disable-next-line unicorn/no-thenable
  then<TResult1 = Result, TResult2 = never>(
    ok?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    fail?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(ok, fail);
  }
}

export function createPostgresClient(connectionString?: string) {
  const rg = () => createAchilleaSql<Database>(connectionString ? { url: connectionString } : {});
  const inagle = () => createInagleSql<Database>();
  const dbFor = (table: string) => (table.startsWith("inagle_") ? inagle() : rg());
  const baseUrl = getSupabaseUrl().replace(/\/$/, "");
  const serviceKey = getSupabaseServiceRoleKey();
  const headers = () => ({
    apikey: serviceKey ?? "",
    ...(serviceKey?.split(".").length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {}),
  });
  const storage = {
    from: (bucket: string) => ({
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path
            .split("/")
            .map(segment => encodeURIComponent(segment))
            .join("/")}`,
        },
      }),
      list: async (prefix?: string, options: Record<string, unknown> = {}) => {
        try {
          const response = await fetch(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
            method: "POST",
            headers: { ...headers(), "content-type": "application/json" },
            body: JSON.stringify({ prefix: prefix ?? "", ...options }),
          });
          return response.ok
            ? { data: await response.json(), error: null }
            : { data: null, error: new Error(await response.text()) };
        } catch (cause) {
          return { data: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
        }
      },
      createSignedUrl: async (path: string, expiresIn: number) => {
        try {
          const response = await fetch(
            `${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path
              .split("/")
              .map(segment => encodeURIComponent(segment))
              .join("/")}`,
            {
              method: "POST",
              headers: { ...headers(), "content-type": "application/json" },
              body: JSON.stringify({ expiresIn }),
            },
          );
          if (!response.ok) return { data: null, error: new Error(await response.text()) };
          const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
          const pathUrl = payload.signedURL ?? payload.signedUrl;
          return {
            data: pathUrl
              ? {
                  signedUrl: pathUrl.startsWith("http") ? pathUrl : `${baseUrl}/storage/v1${pathUrl}`,
                }
              : null,
            error: pathUrl ? null : new Error("Storage returned no signed URL"),
          };
        } catch (cause) {
          return { data: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
        }
      },
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        const results = await Promise.all(
          paths.map(async path => ({
            path,
            ...(await storage.from(bucket).createSignedUrl(path, expiresIn)),
          })),
        );
        const failed = results.find(result => result.error);
        return failed
          ? { data: null, error: failed.error }
          : {
              data: results.map(({ path, data }) => ({ path, signedUrl: data?.signedUrl ?? "" })),
              error: null,
            };
      },
      upload: async (
        path: string,
        body: unknown,
        options?: { contentType?: string; cacheControl?: string; upsert?: boolean },
      ) => {
        if (!baseUrl || !serviceKey) return { data: null, error: new Error("Storage credentials are not configured") };
        try {
          const response = await fetch(
            `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path
              .split("/")
              .map(segment => encodeURIComponent(segment))
              .join("/")}`,
            {
              method: "POST",
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": options?.contentType ?? "application/octet-stream",
                ...(options?.upsert ? { "x-upsert": "true" } : {}),
              },
              body: body as any,
            },
          );
          if (!response.ok) return { data: null, error: new Error(await response.text()) };
          return { data: await response.json(), error: null };
        } catch (cause) {
          return { data: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
        }
      },
      remove: async (paths: string[]) => {
        try {
          for (const path of paths) {
            const response = await fetch(
              `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path
                .split("/")
                .map(segment => encodeURIComponent(segment))
                .join("/")}`,
              {
                method: "DELETE",
                headers: headers(),
              },
            );
            if (!response.ok) return { error: new Error(await response.text()) };
          }
          return { error: null };
        } catch (cause) {
          return { error: cause instanceof Error ? cause : new Error(String(cause)) };
        }
      },
    }),
  };
  const auth = {
    admin: {
      deleteUser: async (userId: string) => {
        try {
          await (rg() as unknown as SqlExecutor).executeQuery({
            sql: "DELETE FROM auth.users WHERE id = $1",
            parameters: [userId],
          });
          return { data: { user: null }, error: null };
        } catch (cause) {
          return {
            data: { user: null },
            error: cause instanceof Error ? cause : new Error(String(cause)),
          };
        }
      },
    },
  };
  return {
    from: (table: string): any =>
      new PostgresQueryBuilder(
        { executeQuery: query => (dbFor(table) as unknown as SqlExecutor).executeQuery(query) },
        table,
      ),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const fn = identifier(name);
      const keys: string[] = Object.keys(args);
      const result = await (dbFor(name) as unknown as SqlExecutor).executeQuery({
        sql: `SELECT * FROM ${fn}(${keys.map((key: string) => `"${key.replace(/"/g, '""')}" => $${keys.indexOf(key) + 1}`).join(", ")})`,
        parameters: keys.map(key => args[key]),
      });
      return { data: result.rows, error: null };
    },
    storage,
    auth,
    close: async () => {},
  };
}
