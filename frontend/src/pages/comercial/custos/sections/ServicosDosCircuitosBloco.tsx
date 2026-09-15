import {
  technicalServiceRequiresChemicalProducts,
  technicalServiceRequiresFilters
} from '../../../../../../shared/comercial/dist/cost-model.js';
import {
  TECHNICAL_SERVICE_CATALOG
} from '../../../../../../shared/comercial/dist/technical-services.js';
import { AvisoPendencia } from '../ConfirmacaoEscopo';
import type { Levantamento } from '../useLevantamento';

type AnyRecord = Record<string, unknown>;

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function novaAssociacao(circuitoId = ''): AnyRecord {
  return {
    id: `servico-circuito-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    systemId: circuitoId,
    serviceId: ''
  };
}

function insumosExigidos(serviceId: unknown): string {
  if (technicalServiceRequiresChemicalProducts(serviceId)) return 'Produtos químicos';
  if (technicalServiceRequiresFilters(serviceId)) return 'Filtros';
  return 'Sem insumo específico';
}

/** Define uma vez, no orçamento, o serviço executado em cada circuito. */
export function ServicosDosCircuitosBloco({
  levantamento
}: {
  levantamento: Levantamento;
}) {
  const { draft, setDraft, updateCollection, removeCollection, erroDe } = levantamento;
  const circuitos = registros(draft.volumeSystems).filter(circuito => circuito.enabled !== false);
  const associacoes = registros(draft.circuitServices);
  const erroGeral = erroDe('circuitServices');

  function acrescentar() {
    setDraft(atual => ({
      ...atual,
      circuitServices: [
        ...registros(atual.circuitServices),
        novaAssociacao(String(circuitos[0]?.id || ''))
      ],
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noInputs: false
      }
    }));
  }

  return (
    <section className="com-painel">
      <div className="com-secao-titulo">
        <div>
          <h2>Serviços por circuito</h2>
          <p>
            Associe cada serviço ao circuito em que ele será executado. Essa seleção
            libera somente os insumos necessários e será levada para o escopo da proposta.
          </p>
        </div>
        <button
          type="button"
          className="com-btn-add"
          disabled={circuitos.length === 0}
          onClick={acrescentar}
        >
          + Adicionar serviço
        </button>
      </div>

      {erroGeral && <AvisoPendencia>{erroGeral}</AvisoPendencia>}

      {circuitos.length === 0 ? (
        <div className="com-vazio">
          Adicione um circuito antes de definir os serviços.
        </div>
      ) : associacoes.length === 0 ? (
        <div className="com-vazio">
          Nenhum serviço associado. Adicione ao menos um serviço para cada circuito.
        </div>
      ) : (
        <div className="com-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Circuito</th>
                <th scope="col">Serviço</th>
                <th scope="col">Insumos liberados</th>
                <th scope="col"><span className="com-sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {associacoes.map((associacao, indice) => {
                const id = String(associacao.id);
                const erroCircuito = erroDe(`circuitServices[${indice}].systemId`);
                const erroServico = erroDe(`circuitServices[${indice}].serviceId`);
                const editar = (patch: AnyRecord) =>
                  updateCollection('circuitServices', id, patch);

                return (
                  <tr key={id}>
                    <td>
                      <select
                        aria-label={`Circuito do serviço ${indice + 1}`}
                        aria-invalid={Boolean(erroCircuito) || undefined}
                        value={String(associacao.systemId || '')}
                        onChange={event => editar({ systemId: event.target.value })}
                      >
                        <option value="">Selecione o circuito...</option>
                        {circuitos.map(circuito => (
                          <option key={String(circuito.id)} value={String(circuito.id)}>
                            {String(circuito.name || 'Circuito')}
                          </option>
                        ))}
                      </select>
                      {erroCircuito && <small className="field-error">{erroCircuito}</small>}
                    </td>
                    <td>
                      <select
                        aria-label={`Serviço do circuito ${indice + 1}`}
                        aria-invalid={Boolean(erroServico) || undefined}
                        value={String(associacao.serviceId || '')}
                        onChange={event => editar({ serviceId: event.target.value })}
                      >
                        <option value="">Selecione o serviço...</option>
                        {TECHNICAL_SERVICE_CATALOG.map(servico => (
                          <option key={servico.id} value={servico.id}>
                            {servico.title}
                          </option>
                        ))}
                      </select>
                      {erroServico && <small className="field-error">{erroServico}</small>}
                    </td>
                    <td>
                      <span className="com-contagem">
                        {insumosExigidos(associacao.serviceId)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover serviço ${indice + 1}`}
                        onClick={() => removeCollection('circuitServices', id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
