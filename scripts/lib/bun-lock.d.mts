export interface BunLockEntry {
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string | undefined;
  readonly dev: boolean;
  readonly optional: boolean;
  readonly resolved: string;
}

/** Read bun.lock and classify every locked package as runtime or development. */
export function readBunLock(root: string): Promise<{
  readonly lock: unknown;
  readonly entries: readonly BunLockEntry[];
}>;

/** The locked version of a top-level package. */
export function lockedVersion(root: string, name: string): Promise<string>;
