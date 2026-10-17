export type Source = Readonly<Record<string, string | undefined>>;

export function mode(env: Source = process.env): string {
  return env.NODE_ENV ?? "development";
}
