import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const values = new Map<string, string>()
const storage: Storage = {
  get length() {
    return values.size
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => values.delete(key),
  setItem: (key, value) => values.set(key, value),
}

// bun:test has no vi.resetModules: load a fresh copy of the module through a query-busted URL.
let load = 0
const freshI18n = () =>
  import(`${Bun.resolveSync('@aphrody/koharu-ui/lib/i18n', import.meta.dir)}?load=${++load}`) as Promise<
    typeof import('@aphrody/koharu-ui/lib/i18n')
  >

describe('interface language persistence', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('stores an explicitly selected language', async () => {
    const { default: i18n } = await freshI18n()

    await i18n.changeLanguage('ja-JP')

    expect(window.localStorage.getItem('i18nextLng')).toBe('ja-JP')
  })

  it('restores the saved language when i18n initializes', async () => {
    window.localStorage.setItem('i18nextLng', 'ja-JP')

    const { default: i18n } = await freshI18n()

    expect(i18n.resolvedLanguage).toBe('ja-JP')
    expect(window.localStorage.getItem('i18nextLng')).toBe('ja-JP')
  })
})
