export interface Command {
  name: string;
  summary: string;
  /** Returns the process exit code. Throws UsageError for bad arguments. */
  run(argv: string[]): Promise<number>;
}
