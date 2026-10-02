import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';

import { ThemeProvider } from '../theme/ThemeProvider';
import { initializeTheme } from '../theme/theme';
import '../styles/tailwind.css';
import '../styles/variables.css';
import '../styles/foundation.css';
import '../styles/utilities.css';
import { ListingsDesignSystemPage } from './ListingsDesignSystemPage';
import './listings-design-system.css';

initializeTheme();

ReactDOM.createRoot(
  document.getElementById('listings-design-system-root')!
).render(
  <React.StrictMode>
    <ThemeProvider>
      <ListingsDesignSystemPage />
    </ThemeProvider>
  </React.StrictMode>
);
