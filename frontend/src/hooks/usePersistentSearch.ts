import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

function readPersistentSearch(key: string, initialValue = ''): string {
  if (initialValue) return initialValue;
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writePersistentSearch(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // sessionStorage indisponível (modo privado/restrito): segue só em memória.
  }
}

/**
 * Estado de texto de busca persistido em `sessionStorage`, restaurado ao voltar — inclusive
 * depois de abrir um card e voltar, ou de alternar abas. Use uma `storageKey` que inclua a aba
 * para manter uma busca **independente por aba**: ao retornar, restaura exatamente a busca daquela
 * aba. `initialValue` permite migrar um termo recebido por link antigo e tem prioridade
 * sobre a sessão. Compatível com `useState('')`: o setter aceita um valor ou uma função de atualização.
 */
export function usePersistentSearch(storageKey: string, initialValue = ''): [string, Dispatch<SetStateAction<string>>] {
  const [state, setState] = useState(() => ({ key: storageKey, value: readPersistentSearch(storageKey, initialValue) }));
  // Restore before children render, so no request uses another tab's search term.
  let value = state.value;
  if (state.key !== storageKey) {
    value = readPersistentSearch(storageKey, initialValue);
    setState({ key: storageKey, value });
  }
  const setValue: Dispatch<SetStateAction<string>> = useCallback(next => {
    setState(current => ({
      key: storageKey,
      value: typeof next === 'function'
        ? next(current.key === storageKey ? current.value : readPersistentSearch(storageKey))
        : next
    }));
  }, [storageKey]);

  useEffect(() => {
    writePersistentSearch(storageKey, value);
  }, [storageKey, value]);

  return [value, setValue];
}
