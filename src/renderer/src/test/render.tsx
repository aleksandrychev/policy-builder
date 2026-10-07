import type { ReactElement } from 'react';
import { Provider } from 'react-redux';

import { render } from '@testing-library/react';

import { AppThemeProvider } from '../ThemeProvider';
import { createAppStore } from '../store';

type Api = NonNullable<Window['api']>;

/** Renders `ui` inside the app's providers, with an isolated store unless one is given. */
export function renderWithProviders(ui: ReactElement, { store = createAppStore() } = {}) {
  return {
    store,
    ...render(
      <Provider store={store}>
        <AppThemeProvider>{ui}</AppThemeProvider>
      </Provider>
    )
  };
}

/**
 * Installs a fake `window.api`: every method is a vi.fn (resolving undefined, listeners
 * returning an unsubscribe) unless `overrides` gives it. Remove it with `uninstallApi`.
 */
export function installApi(overrides: Partial<Api> = {}): Api {
  const api = new Proxy({ ...overrides } as Record<string, unknown>, {
    get(target, key: string | symbol) {
      // Not a thenable: awaiting the api must not call a fake `then`.
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (!(key in target)) target[key] = key.startsWith('on') ? vi.fn(() => () => {}) : vi.fn(async () => undefined);
      return target[key];
    }
  }) as unknown as Api;
  window.api = api;
  return api;
}

export function uninstallApi() {
  delete window.api;
}
