import fc from "fast-check";
import { it as bunIt } from "./bunTest.js";

type Arbitraries = readonly fc.Arbitrary<unknown>[];
type Property<T extends Arbitraries> = (
  ...values: { [K in keyof T]: T[K] extends fc.Arbitrary<infer V> ? V : never }
) => void | Promise<void>;

const prop =
  <T extends Arbitraries>(arbitraries: T) =>
  (name: string, body: Property<T>): void => {
    bunIt(name, async () => {
      await fc.assert(
        fc.asyncProperty(
          ...(arbitraries as unknown as [fc.Arbitrary<unknown>]),
          async (...values: unknown[]) => {
            await (body as (...args: unknown[]) => unknown)(...values);
          },
        ),
      );
    });
  };

/** bun:test `it` with the fast-check `prop` runner. */
export const it = Object.assign(bunIt, { prop });
export { fc };
