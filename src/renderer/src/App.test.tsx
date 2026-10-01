import { Provider } from 'react-redux';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';
import { AppThemeProvider } from './ThemeProvider';
import { createAppStore } from './store';

describe('App', () => {
  it('renders the empty-state home screen within the themed shell', () => {
    render(
      <Provider store={createAppStore()}>
        <AppThemeProvider>
          <App />
        </AppThemeProvider>
      </Provider>
    );

    expect(screen.getByRole('heading', { name: /build cfengine policy visually/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open project/i })).toBeInTheDocument();
  });

  it('creates a project and switches to the project view', () => {
    render(
      <Provider store={createAppStore()}>
        <AppThemeProvider>
          <App />
        </AppThemeProvider>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'Web Server Hardening' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(screen.getByText(/project: web server hardening/i)).toBeInTheDocument();
    // Appears in both the top bar's namespace badge and the status bar.
    expect(screen.getAllByText(/bundle: web_server_hardening/i).length).toBeGreaterThan(0);
    // Not on disk (no desktop app in tests), so saving means choosing where first.
    // (By text: the closing New Project dialog still hides the page from role queries.)
    expect(screen.getByText('Save As…').closest('button')).toBeEnabled();
  });

  it('adds a block to the canvas by clicking it in the palette, then edits its properties', () => {
    render(
      <Provider store={createAppStore()}>
        <AppThemeProvider>
          <App />
        </AppThemeProvider>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'Web Server Hardening' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    // Only the palette row exists before the block is added.
    fireEvent.click(screen.getByText(/^set permissions$/i));

    // Adding it puts a card on the canvas (title + subtitle both read the
    // descriptor's name until the label is customized), on top of the
    // still-present palette row.
    const matches = screen.getAllByText(/^set permissions$/i);
    expect(matches.length).toBeGreaterThan(1);
    fireEvent.click(matches.at(-1)!);

    const ownerField = screen.getByLabelText(/owner/i);
    fireEvent.change(ownerField, { target: { value: 'www-data' } });
    expect(ownerField).toHaveValue('www-data');
  });
});
