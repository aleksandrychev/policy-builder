import { useState } from 'react';

import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { CompiledPolicyState } from '../project/useCompiledPolicy';
import { installApi, renderWithProviders, uninstallApi } from '../test/render';
import { GeneratedPolicyView } from './GeneratedPolicyView';

const MAIN = 'bundle agent main\n{\n  reports:\n      "hello";\n}\n';
const OTHER = 'bundle agent other\n{\n}\n';

const compiled = (overrides: Partial<CompiledPolicyState> = {}): CompiledPolicyState => ({
  error: null,
  pathOf: { f1: './main.cf', f2: './other.cf' },
  pending: false,
  result: { files: { './main.cf': MAIN, './other.cf': OTHER }, sourceMap: {} },
  ...overrides
});

function view(state: CompiledPolicyState, currentFileId: string | null = 'f1') {
  return <GeneratedPolicyView compiled={state} currentFileId={currentFileId} onFollow={vi.fn()} onSelect={vi.fn()} selectedId={null} />;
}

// The file tree picks the file: a button stands in for it.
function Picker() {
  const [fileId, setFileId] = useState('f1');
  return (
    <>
      <button onClick={() => setFileId('f2')}>other file</button>
      {view(compiled(), fileId)}
    </>
  );
}

const editorText = () => document.querySelector('.cm-content')?.textContent ?? '';

describe('GeneratedPolicyView', () => {
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  beforeEach(() => {
    installApi();
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  afterEach(uninstallApi);

  it('asks for a file when none is open', () => {
    renderWithProviders(view(compiled(), null));
    expect(screen.getByText('Select a policy file in the explorer.')).toBeInTheDocument();
  });

  it('needs the desktop app', () => {
    uninstallApi();
    renderWithProviders(view(compiled()));
    expect(screen.getByText('The generated policy needs the desktop app.')).toBeInTheDocument();
  });

  it('shows the compiled file with the up-to-date badge', () => {
    renderWithProviders(view(compiled()));
    expect(editorText()).toContain('bundle agent main');
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('shows Updating while compiling', () => {
    renderWithProviders(view(compiled({ pending: true })));
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
  });

  it('shows a compile error and marks the policy out of date', () => {
    renderWithProviders(view(compiled({ error: 'Compile failed: boom' })));
    expect(screen.getByText('Compile failed: boom')).toBeInTheDocument();
    expect(screen.getByText('Out of date')).toBeInTheDocument();
  });

  it('shows a placeholder before the first compile', () => {
    renderWithProviders(view(compiled({ pending: true, result: null })));
    expect(screen.getByText('Generating the policy…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('copies the file', async () => {
    renderWithProviders(view(compiled()));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(MAIN);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says when copying failed', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    renderWithProviders(view(compiled()));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows another file when it is chosen', async () => {
    renderWithProviders(<Picker />);
    fireEvent.click(screen.getByRole('button', { name: 'other file' }));
    await waitFor(() => expect(editorText()).toContain('bundle agent other'));
    expect(editorText()).not.toContain('bundle agent main');
  });
});
