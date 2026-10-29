import { AsyncLocalStorage } from 'node:async_hooks';

// O contexto assíncrono não afeta requisições LIVE concorrentes.
export const apiWriteContext = new AsyncLocalStorage();
export const isApiWriteSimulation = () => apiWriteContext.getStore()?.simulated === true;
