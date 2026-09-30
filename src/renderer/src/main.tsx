import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

// Red Hat Text is the Mission Portal typography font. Bundled via @fontsource
// so it works offline and satisfies the renderer CSP (no external font host).
import '@fontsource/red-hat-text/400.css';
import '@fontsource/red-hat-text/500.css';
import '@fontsource/red-hat-text/700.css';

import App from './App';
import { AppThemeProvider } from './ThemeProvider';
import { store } from './store';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <AppThemeProvider>
        <App />
      </AppThemeProvider>
    </Provider>
  </React.StrictMode>
);
