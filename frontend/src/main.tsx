import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/inter/wght.css';

import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { installClientErrorTracking } from './observability/errorTracking';
import { MaintenancePage } from './pages/MaintenancePage';
import { ThemeProvider } from './theme/ThemeProvider';
import { initializeTheme } from './theme/theme';
import { createAppQueryClient, installQueryDataUpdates } from './queryClient';
import './styles/tailwind.css';
import './styles/variables.css';
import './styles/foundation.css';
import './styles/utilities.css';
import './styles/legacy.css';
import './styles/operational-reports.css';

const queryClient = createAppQueryClient();
const disposeDataUpdates = installQueryDataUpdates(queryClient);
if (import.meta.hot) import.meta.hot.dispose(disposeDataUpdates);
const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';
initializeTheme();
installClientErrorTracking();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {isMaintenanceMode ? (
        <MaintenancePage />
      ) : (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      )}
    </ThemeProvider>
  </React.StrictMode>
);
