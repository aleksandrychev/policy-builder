import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia, which useColorScheme relies on.
// Default to light mode in tests.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    }) as unknown as MediaQueryList;
}

// React Flow (the canvas) measures nodes with ResizeObserver and reads
// zoom via DOMMatrixReadOnly — neither exists in jsdom. Inert stand-ins are
// enough: tests assert on rendered content, not on measured layout.
class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}
class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale ? Number(scale) : 1;
  }
}
const browserGlobals = globalThis as unknown as Record<string, unknown>;
browserGlobals.ResizeObserver ??= ResizeObserverStub;
browserGlobals.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;
