interface ReportListSkeletonProps {
  /** Quantos "cards" de projeto exibir. */
  groups?: number;
  /** Quantas linhas de relatório por card. */
  rowsPerGroup?: number;
}

/**
 * Placeholder animado para listas de relatórios agrupadas por projeto.
 * Mantém a altura aproximada do conteúdo real para evitar salto de layout
 * (e a sensação de "piscar") enquanto a primeira página carrega.
 */
export function ReportListSkeleton({ groups = 2, rowsPerGroup = 3 }: ReportListSkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando relatórios...</span>
      {Array.from({ length: groups }).map((_, groupIndex) => (
        <div className="card report-project-group skeleton-group" key={groupIndex}>
          <div className="skeleton skeleton-line skeleton-title" />
          {Array.from({ length: rowsPerGroup }).map((__, rowIndex) => (
            <div className="skeleton skeleton-row" key={rowIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}
