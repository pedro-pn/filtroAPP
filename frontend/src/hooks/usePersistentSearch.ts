import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

function readPersistentSearch(key: string): string {
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
 * aba. Drop-in para `useState('')` (o setter é o próprio do `useState`, aceita valor ou updater).
 */
export function usePersistentSearch(storageKey: string): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => readPersistentSearch(storageKey));
  const loadedKeyRef = useRef(storageKey);

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) {
      // A chave mudou (ex.: troca de aba): carrega a busca dessa aba e NÃO persiste a anterior
      // sob a nova chave (evita "vazar" o termo de uma aba para outra).
      loadedKeyRef.current = storageKey;
      setValue(readPersistentSearch(storageKey));
      return;
    }
    writePersistentSearch(storageKey, value);
  }, [storageKey, value]);

  return [value, setValue];
}
