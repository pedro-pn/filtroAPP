import type { CostSection } from './footerChain';
import { secaoDoCaminho } from './secaoDoCaminho';
import type { Levantamento } from './useLevantamento';

type Registro = Record<string, unknown>;

function origemDaPendencia(caminho: string, draft: Registro): string {
  const indices = caminho.match(
    /^laborContexts\[(\d+)\](?:\.assignments\[(\d+)\])?/
  );
  if (!indices) return '';
  const fases = (draft.laborContexts || []) as Registro[];
  const indice = Number(indices[1]);
  const fase = fases[indice];
  const alocacao = ((fase?.assignments || []) as Registro[])[
    Number(indices[2])
  ];
  return [
    `Fase ${indice + 1}${fase?.name ? ` — ${fase.name}` : ''}`,
    alocacao?.role
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Toda recusa tem uma explicação visível, mesmo quando é de um grupo de campos. */
export function PendenciasDaSecao({
  levantamento,
  secao
}: {
  levantamento: Levantamento;
  secao: CostSection;
}) {
  if (!levantamento.errosVisiveis) return null;
  const pendencias = [...levantamento.errosPorCampo].filter(
    ([caminho]) => secaoDoCaminho(caminho) === secao
  );
  if (!pendencias.length) return null;

  return (
    <section
      className="com-painel com-campo-invalido"
      role="alert"
      aria-label="Pendências desta etapa"
      data-custo-pendencias
      tabIndex={-1}
    >
      <strong>O que falta corrigir nesta etapa</strong>
      <ul>
        {pendencias.map(([caminho, mensagem]) => {
          const origem = origemDaPendencia(caminho, levantamento.draft);
          return (
            <li key={caminho}>
              {origem && <strong>{origem}: </strong>}
              {mensagem}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
