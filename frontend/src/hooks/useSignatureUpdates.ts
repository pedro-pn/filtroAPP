import { useCallback, useState } from 'react';

type ViewedSignatures = Record<string, number>;

export function signatureUpdatesStorageKey(userId: string) {
  return `filtrovali:assinaturas:viewed:v1:${userId}`;
}

export function readViewedSignatures(key: string): ViewedSignatures {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, count]) => typeof count === 'number' && Number.isInteger(count) && count >= 0));
  } catch {
    return {};
  }
}

export function hasUnseenSignatures(document: { id: string; signedCount: number }, viewed: ViewedSignatures) {
  return document.signedCount > (viewed[document.id] || 0);
}

export function useSignatureUpdates(userId: string) {
  const key = signatureUpdatesStorageKey(userId);
  const [state, setState] = useState(() => ({ key, viewed: readViewedSignatures(key) }));
  let viewed = state.viewed;
  if (state.key !== key) {
    viewed = readViewedSignatures(key);
    setState({ key, viewed });
  }

  const markViewed = useCallback((id: string, signedCount: number) => {
    if (!userId || !signedCount) return;
    setState(current => {
      const previous = current.key === key ? current.viewed : readViewedSignatures(key);
      if ((previous[id] || 0) >= signedCount) return current;
      const next = { ...previous, [id]: signedCount };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Segue em memória quando o armazenamento não está disponível. */ }
      return { key, viewed: next };
    });
  }, [key, userId]);

  return { viewed, markViewed };
}
