import { act, screen } from '@testing-library/react';

import { installApi, renderWithProviders, uninstallApi } from '../../test/render';
import { CustomTextProblems } from './CustomTextProblems';

describe('CustomTextProblems', () => {
  afterEach(() => {
    uninstallApi();
    vi.useRealTimers();
  });

  it('checks the text once typing pauses, and lists what the linter found by field and line', async () => {
    vi.useFakeTimers();
    const lintCustom = vi.fn(async () => ({ b: [{ field: 'promises' as const, line: 2, column: 5, message: 'Syntax error' }] }));
    installApi({ lintCustom });
    renderWithProviders(<CustomTextProblems id="b" namespace="site" promises={'files:\n  ;'} definitions="" />);
    expect(lintCustom).not.toHaveBeenCalled();

    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(lintCustom).toHaveBeenCalledWith([{ id: 'b', namespace: 'site', promises: 'files:\n  ;', definitions: '' }]);
    expect(screen.getByText('Promises, line 2: Syntax error')).toBeInTheDocument();
  });

  it('shows nothing for empty promises, or without the desktop app', async () => {
    vi.useFakeTimers();
    const lintCustom = vi.fn(async () => ({}));
    installApi({ lintCustom });
    const { container } = renderWithProviders(<CustomTextProblems id="b" namespace="site" promises="" definitions="" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(lintCustom).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
