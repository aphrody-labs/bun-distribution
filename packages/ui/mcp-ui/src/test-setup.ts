import { JSDOM } from 'jsdom';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

if (typeof (globalThis as any).window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement;
  globalThis.MessageEvent = dom.window.MessageEvent;
}

if (typeof (vi as any) !== 'undefined' && !(vi as any).mocked) {
  (vi as any).mocked = (item: any) => item;
}

// Polyfill for requestAnimationFrame
if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'undefined') {
  window.requestAnimationFrame = (callback) => {
    return setTimeout(callback, 0) as unknown as number;
  };
}

if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'undefined') {
  window.cancelAnimationFrame = (id) => {
    clearTimeout(id);
  };
}
