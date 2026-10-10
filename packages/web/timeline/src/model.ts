// SPDX-License-Identifier: Apache-2.0
export const SOURCE = "https://dragonballfr.com/wiki/timeline";
export const MEDIA_API = "https://dragonballfr.com/api/timeline";
export const AGE_API = "https://dragonballfr.com/api/public/wiki/timeline_events";

export interface TimelineSource {
  source: string;
  mediaApi: string;
  ageApi: string;
}
export const DRAGON_BALL_SOURCE: TimelineSource = {
  source: SOURCE,
  mediaApi: MEDIA_API,
  ageApi: AGE_API,
};

export interface Entry {
  key: string;
  kind: "episode" | "movie" | "manga" | "age";
  id: number;
  rank: number | null;
  title: string;
  titleJa: string | null;
  series: string | null;
  era: string;
  eraLabel: string | null;
  number: number | null;
  date: string | null;
  href: string;
  api: string;
  ageYear: number | null;
  ageMonth: number | null;
  ageDay: number | null;
  orderIdx: number | null;
  description: string | null;
  charactersInvolved: string[];
  sourceRef: string | null;
  canon: boolean | null;
}
export interface Snapshot {
  schemaVersion: 1;
  source: string;
  fetchedAt: string;
  generation: string;
  mediaTotal: number;
  ageTotal: number;
  entries: Entry[];
}
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid source object");
  return value as Row;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("invalid source integer");
  return value;
}
function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid source string");
  return value;
}
function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}
function publicUrl(value: unknown, source: string): string {
  const url = new URL(string(value), source);
  if (url.origin !== new URL(source).origin || url.username || url.password)
    throw new Error("unexpected source URL");
  return url.href;
}
export function normalize(
  mediaValue: unknown,
  ageValues: unknown[],
  fetchedAt = new Date().toISOString(),
  source: TimelineSource = DRAGON_BALL_SOURCE,
): Snapshot {
  const media = row(mediaValue);
  if (media.source !== source.source || !Array.isArray(media.entries))
    throw new Error("unexpected timeline source");
  const mediaTotal = integer(media.timelineTotal);
  if (mediaTotal < 1 || integer(media.total) !== mediaTotal || media.entries.length !== mediaTotal)
    throw new Error("incomplete media timeline");
  const entries: Entry[] = media.entries.map((value, index) => {
    const r = row(value);
    const kind = string(r.kind);
    if (!["episode", "movie", "manga"].includes(kind) || integer(r.rank) !== index + 1)
      throw new Error("invalid editorial rank/kind");
    const id = integer(r.id);
    if (id < 1 || !string(r.title).trim()) throw new Error("invalid media identity");
    const date = nullableString(r.date);
    if (
      date !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new Error("invalid release date");
    return {
      key: `${kind}:${id}`,
      kind: kind as Entry["kind"],
      id,
      rank: integer(r.rank),
      title: string(r.title),
      titleJa: nullableString(r.titleJa),
      series: string(r.series),
      era: string(r.era),
      eraLabel: string(r.eraLabel),
      number: nullableInteger(r.number),
      date,
      href: publicUrl(r.href, source.source),
      api: publicUrl(r.api, source.source),
      ageYear: null,
      ageMonth: null,
      ageDay: null,
      orderIdx: null,
      description: null,
      charactersInvolved: [],
      sourceRef: null,
      canon: null,
    };
  });
  for (const value of ageValues) {
    const r = row(value);
    const id = integer(r.id);
    if (id < 1 || !string(r.title).trim() || !Array.isArray(r.charactersInvolved))
      throw new Error("invalid age identity");
    if (![true, false, 0, 1, "0", "1"].includes(r.canon as string))
      throw new Error("invalid canonicity");
    const year = integer(r.ageYear);
    entries.push({
      key: `age:${id}`,
      kind: "age",
      id,
      rank: null,
      title: string(r.title),
      titleJa: nullableString(r.titleJa),
      series: null,
      era: string(r.era),
      eraLabel: null,
      number: null,
      date: null,
      href: `${source.source}#age-${year}`,
      api: `${source.ageApi}/${id}`,
      ageYear: year,
      ageMonth: nullableInteger(r.ageMonth),
      ageDay: nullableInteger(r.ageDay),
      orderIdx: integer(r.orderIdx),
      description: nullableString(r.description),
      charactersInvolved: r.charactersInvolved.map(string),
      sourceRef: nullableString(r.sourceRef),
      canon: [true, 1, "1"].includes(r.canon as string),
    });
  }
  if (!ageValues.length || new Set(entries.map((e) => e.key)).size !== entries.length)
    throw new Error("empty or duplicate timeline");
  // The media array stays in its curated order. Ages have their own chronology.
  entries.splice(
    mediaTotal,
    ageValues.length,
    ...entries
      .slice(mediaTotal)
      .toSorted((a, b) => a.ageYear! - b.ageYear! || a.orderIdx! - b.orderIdx! || a.id - b.id),
  );
  const generation = new Bun.CryptoHasher("sha256").update(JSON.stringify(entries)).digest("hex");
  return {
    schemaVersion: 1,
    source: source.source,
    fetchedAt,
    generation,
    mediaTotal,
    ageTotal: ageValues.length,
    entries,
  };
}

export async function collect(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
  source: TimelineSource = DRAGON_BALL_SOURCE,
): Promise<Snapshot> {
  const read = async (url: string) => {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
      throw new Error(`source unavailable: ${response.status}`);
    return row(await response.json());
  };
  const media = await read(source.mediaApi);
  const ages: unknown[] = [];
  let expected: number | undefined;
  for (let offset = 0; offset < 10_000; offset += 100) {
    // eslint-disable-next-line no-await-in-loop -- The previous total/offset is required before fetching the next page.
    const page = await read(`${source.ageApi}?limit=100&offset=${offset}`);
    const total = integer(page.total);
    if (expected !== undefined && expected !== total)
      throw new Error("source changed during pagination");
    expected = total;
    if (!Array.isArray(page.items) || integer(page.offset) !== offset)
      throw new Error("invalid age pagination");
    ages.push(...page.items);
    if (ages.length === total) return normalize(media, ages, undefined, source);
    if (!page.items.length || ages.length > total) throw new Error("incomplete age timeline");
  }
  throw new Error("age pagination exceeds budget");
}

export function passage(e: Entry, source = SOURCE): string {
  const body =
    e.kind === "age"
      ? `Âge ${e.ageYear}${e.ageMonth === null ? "" : `, mois ${e.ageMonth}`}${e.ageDay === null ? "" : `, jour ${e.ageDay}`}. ${e.description ?? ""}\nSource éditoriale : ${e.sourceRef ?? "non renseignée"}.`
      : `Rang éditorial : ${e.rank}. Nature : ${e.kind}. Série : ${e.series}. Ère : ${e.eraLabel}. Numéro : ${e.number ?? "non renseigné"}. Diffusion/sortie : ${e.date ?? "non renseignée"}.`;
  return `# ${e.title}\n\n${body}\nTitre japonais : ${e.titleJa ?? "non renseigné"}.\nSource : ${source}\nFiche : ${e.href}\nAPI : ${e.api}\n`;
}
export interface TrainingOptions {
  subject?: string;
  originSourceId?: string;
  content?: (entry: Entry) => string;
}
export function trainingRows(snapshot: Snapshot, options: TrainingOptions = {}) {
  return snapshot.entries.map((e) => {
    const split =
      parseInt(new Bun.CryptoHasher("sha256").update(e.key).digest("hex").slice(0, 8), 16) % 10 ===
      0
        ? "eval"
        : "train";
    return {
      split,
      sourceId: `${options.originSourceId ?? "shenron:timeline"}:${e.key}`,
      generation: snapshot.generation,
      source: e.href,
      messages: [
        {
          role: "user",
          content:
            e.kind === "age"
              ? `Pour l’entrée ${e.kind} ${e.id}, que dit la chronologie de ${options.subject ?? "Dragon Ball"} au sujet de « ${e.title} » ?`
              : `Pour l’entrée ${e.kind} ${e.id}, où se situe « ${e.title} » (${e.series}, ${e.kind} ${e.id}) dans la frise officielle de ${options.subject ?? "Dragon Ball"} ?`,
        },
        { role: "assistant", content: options.content?.(e) ?? passage(e, snapshot.source) },
      ],
    };
  });
}
