// SPDX-License-Identifier: MIT OR Apache-2.0
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'bun:test' {
  interface Matchers<T> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<any, any> {}
}
