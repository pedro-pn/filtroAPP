import { useCallback, useEffect, useRef } from 'react';

interface InfiniteScrollSentinelOptions {
  /** Há mais páginas para carregar. */
  hasMore: boolean;
  /** Já existe um carregamento em andamento (evita disparos duplicados). */
  isLoading: boolean;
  /** Dispara o carregamento da próxima página. */
  onLoadMore: () => void;
  /** Distância antes da sentinela entrar na tela para já começar a carregar. */
  rootMargin?: string;
}

/**
 * Observa um elemento "sentinela" no fim da lista e chama `onLoadMore` quando ele se
 * aproxima da viewport — transformando o botão "Carregar mais" em scroll infinito.
 * Retorna um callback ref: passe-o em `<div ref={...} />`. Por ser callback ref, o observer
 * (re)anexa de forma confiável mesmo quando a sentinela só entra no DOM após o 1º carregamento.
 * Se um carregamento termina e a sentinela continua visível, segue carregando (preenche a tela).
 * O botão pode ser mantido como fallback acessível e para navegadores sem IntersectionObserver.
 */
export function useInfiniteScrollSentinel({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = '320px'
}: InfiniteScrollSentinelOptions) {
  // Flags lidas via ref para não recriar o observer a cada render.
  const stateRef = useRef({ hasMore, isLoading, onLoadMore });
  stateRef.current = { hasMore, isLoading, onLoadMore };
  const isIntersectingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const maybeLoadMore = useCallback(() => {
    const state = stateRef.current;
    if (isIntersectingRef.current && state.hasMore && !state.isLoading) state.onLoadMore();
  }, []);

  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    isIntersectingRef.current = false;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        isIntersectingRef.current = entries.some(entry => entry.isIntersecting);
        maybeLoadMore();
      },
      { rootMargin }
    );
    observerRef.current = observer;
    observer.observe(node);
  }, [rootMargin, maybeLoadMore]);

  // Quando um carregamento termina (e ainda há mais), tenta de novo: se a sentinela
  // continua na tela porque a leva carregada não a empurrou para fora, segue carregando.
  useEffect(() => {
    if (!isLoading && hasMore) maybeLoadMore();
  }, [isLoading, hasMore, maybeLoadMore]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return setSentinel;
}
