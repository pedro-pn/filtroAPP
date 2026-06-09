import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';

interface InfiniteScrollSentinelProps {
  /** Há mais itens para carregar. */
  hasMore: boolean;
  /** Carregamento em andamento (evita disparos duplicados). */
  isLoading: boolean;
  /** Dispara o carregamento da próxima leva. */
  onLoadMore: () => void;
  /** Distância antes da sentinela entrar na tela para já começar a carregar. */
  rootMargin?: string;
  className?: string;
}

/**
 * Sentinela de scroll infinito reutilizável. Renderize-a junto ao botão "Carregar mais"
 * (que pode ser mantido como fallback): ao se aproximar da viewport, chama `onLoadMore`.
 * Use uma instância por lista/aba — cada uma observa seu próprio elemento.
 */
export function InfiniteScrollSentinel({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin,
  className
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useInfiniteScrollSentinel({ hasMore, isLoading, onLoadMore, rootMargin });
  return <div ref={sentinelRef} aria-hidden="true" className={className} />;
}
