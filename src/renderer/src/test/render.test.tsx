import { installApi, renderWithProviders, uninstallApi } from './render';

describe('test helpers', () => {
  afterEach(uninstallApi);

  it('fakes every api method, keeping overrides', async () => {
    const api = installApi({ shouldUseDarkColors: async () => true });
    expect(await api.shouldUseDarkColors()).toBe(true);
    expect(await api.gitStatus('/p')).toBeUndefined();
    expect(api.gitStatus).toHaveBeenCalledWith('/p');
    expect(typeof api.onTestEnvEvent(() => {})).toBe('function');
    expect(await Promise.resolve(api)).toBe(api);
  });

  it('renders inside the store and theme', () => {
    const { store, getByText } = renderWithProviders(<p>hello</p>);
    expect(getByText('hello')).toBeInTheDocument();
    expect(store.getState().files).toBeDefined();
  });
});
