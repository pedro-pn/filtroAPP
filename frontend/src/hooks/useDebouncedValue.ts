import { useEffect, useState } from 'react';

/**
 * Retorna uma versão atrasada de `value`, atualizada só depois de `delayMs` sem mudanças.
 * Útil para campos de busca que alimentam filtros de query: evita uma requisição por
 * tecla (e o reset de paginação que vem junto). O input continua respondendo na hora;
 * apenas o valor enviado ao servidor é adiado.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
