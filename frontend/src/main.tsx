import React from 'react';
import ReactDOM from 'react-dom/client';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { MaintenancePage } from './pages/MaintenancePage';
import './styles/variables.css';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dados ficam "frescos" por 1 min: evita refetch a cada montagem/troca de aba.
      staleTime: 60_000,
      // Mantém em memória por 30 min após sair da tela (volta instantânea).
      gcTime: 30 * 60_000,
      // Ao voltar para a aba, revalida dados já "velhos" (> staleTime). Isso é suave por causa
      // do staleTime de 60s e garante que mudanças feitas por outra pessoa (ex.: gestor altera
      // signatários / finaliza assinatura) apareçam para o cliente sem recarregar a página.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
      // Durante um refetch (ex.: busca, troca de filtro), manter os dados anteriores
      // visíveis em vez de desmontar a lista e mostrar spinner.
      placeholderData: keepPreviousData
    }
  }
});
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
