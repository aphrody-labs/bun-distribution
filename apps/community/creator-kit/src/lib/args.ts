import { parseArgs } from "node:util";

export type OptionSpec = Record<
  string,
  {
    type: "string" | "boolean";
    short?: string;
    multiple?: boolean;
    default?: string | boolean | string[];
  }
>;

export interface Parsed<T extends OptionSpec> {
  values: {
    [K in keyof T]?: T[K]["type"] extends "boolean"
      ? boolean
      : T[K]["multiple"] extends true
        ? string[]
        : string;
  };
  positionals: string[];
}

/** Thin wrapper over node:util parseArgs, strict, with positionals. */
export function parse<T extends OptionSpec>(argv: string[], options: T): Parsed<T> {
  const { values, positionals } = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  });
  return { values: values as Parsed<T>["values"], positionals };
}

export class UsageError extends Error {}
