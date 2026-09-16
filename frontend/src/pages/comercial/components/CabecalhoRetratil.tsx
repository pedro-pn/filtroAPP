import type { ReactNode } from 'react';

/** Cabeçalho inteiro acionável, inclusive por Enter/Espaço e pela validação. */
export function CabecalhoRetratil({
  titulo,
  descricao,
  indice,
  resumo,
  aberto,
  conteudoId,
  onAlternar
}: {
  titulo: string;
  descricao?: string;
  indice?: number;
  resumo?: ReactNode;
  aberto: boolean;
  conteudoId: string;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      className="com-cabecalho-toggle"
      aria-expanded={aberto}
      aria-controls={conteudoId}
      onClick={onAlternar}
    >
      {indice !== undefined && <span className="com-fase-indice">{indice}</span>}
      <span className="com-cabecalho-texto">
        <strong>{titulo}</strong>
        {descricao && <small>{descricao}</small>}
      </span>
      {resumo}
      <span className="com-retratil-seta" aria-hidden="true" />
    </button>
  );
}
