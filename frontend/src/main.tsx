import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { MaintenancePage } from './pages/MaintenancePage';
import './styles/variables.css';
import './styles/base.css';

const queryClient = new QueryClient();
const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
