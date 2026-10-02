// SPDX-License-Identifier: MIT OR Apache-2.0
// bun:test has no vi.hoisted; mock.module rebinds live ESM exports, so a plain call is enough.
export const hoisted = <T>(factory: () => T): T => factory()

// bun:test's vi lacks stubGlobal/unstubAllGlobals.
const stubbed = new Map<string, PropertyDescriptor | undefined>()
export function stubGlobal(name: string, value: unknown): void {
  if (!stubbed.has(name)) stubbed.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
export function unstubAllGlobals(): void {
  for (const [name, desc] of stubbed) {
    if (desc) Object.defineProperty(globalThis, name, desc)
    else delete (globalThis as Record<string, unknown>)[name]
  }
  stubbed.clear()
}
