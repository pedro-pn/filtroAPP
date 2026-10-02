import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import '@fontsource-variable/inter/wght.css';

import { ThemeProvider } from '../theme/ThemeProvider';
import { initializeTheme } from '../theme/theme';
import '../styles/tailwind.css';
import '../styles/variables.css';
import '../styles/foundation.css';
import '../styles/utilities.css';
import { ShellDesignSystemPage } from './ShellDesignSystemPage';
import './shell-design-system.css';

initializeTheme();

ReactDOM.createRoot(
  document.getElementById('shell-design-system-root')!
).render(
  <React.StrictMode>
    <ThemeProvider>
      <MemoryRouter initialEntries={['/modulos']}>
        <ShellDesignSystemPage />
      </MemoryRouter>
    </ThemeProvider>
  </React.StrictMode>
);
