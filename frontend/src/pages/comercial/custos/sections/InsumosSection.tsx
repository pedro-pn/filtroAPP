import { MoneyInput } from '../../components/Field';
import {
  hasMeaningfulInputs,
  normalizeCostEstimatePayload,
  technicalServiceRequiresChemicalProducts,
  technicalServiceRequiresFilters
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { AvisoPendencia, ConfirmacaoEscopo } from '../ConfirmacaoEscopo';
import { money, number, numberValue } from '../formato';
import type { Levantamento } from '../useLevantamento';
import { CircuitosBloco } from './CircuitosBloco';
import { FiltrosTabela } from './FiltrosTabela';
import { ProdutosBloco } from './ProdutosBloco';
import { custoTotalMateriaisEInsumos } from '../totaisDasSecoes';

/**
 * Seção 3 — Materiais e insumos.
 *
 * Cobre `CUSTO-CTL-138..228` (91 controles). Porte de `InputsSection`
 * (`app/custos/page.tsx:1039-1268`).
 *
 * A seção é composta por materiais manuais, circuitos de volume, serviços por
 * circuito e pelos blocos condicionais de produtos químicos e filtros.
 *
 * Um detalhe do fluxo que vale registrar: **mexer em insumos desliga a
 * confirmação "sem insumos"**. Quem confirmou que não haveria insumos e depois
 * acrescenta um material está se contradizendo, e a referência resolve isso
 * apagando a confirmação em vez de deixar as duas afirmações coexistirem.
 */

type AnyRecord = Record<string, unknown>;

const CATEGORIAS = [
  { value: 'material', label: 'Material' },
  { value: 'input', label: 'Insumo' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function novoMaterial(): AnyRecord {
  return {
    id: `material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: 'material',
    description: '',
    unit: 'un.',
    quantity: 1,
    unitCost: 0,
    wastePercent: 0,
    freightValue: 0,
    included: true
  };
}

export function InsumosSection({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result } = levantamento;
  const circuitosAtivos = new Set(
    registros(draft.volumeSystems)
      .filter(circuito => circuito.enabled !== false)
      .map(circuito => String(circuito.id))
  );
  const normalizado = normalizeCostEstimatePayload(draft);
  const servicosConfigurados = Array.isArray(normalizado.circuitServices);
  const servicosAtivos = registros(normalizado.circuitServices).filter(servico =>
    circuitosAtivos.has(String(servico.systemId || ''))
  );
  const exibirProdutosQuimicos = !servicosConfigurados || servicosAtivos.some(servico =>
    technicalServiceRequiresChemicalProducts(servico.serviceId)
  );
  const exibirFiltros = !servicosConfigurados || servicosAtivos.some(servico =>
    technicalServiceRequiresFilters(servico.serviceId)
  );

  return (
    <>
      <MateriaisBloco levantamento={levantamento} />
      <CircuitosBloco levantamento={levantamento} />
      {exibirProdutosQuimicos && <ProdutosBloco levantamento={levantamento} />}
      {exibirFiltros && <FiltrosTabela levantamento={levantamento} />}
      <div
        className="com-total-secao"
        aria-label="Custo total da aba Materiais e insumos"
      >
        <strong>Custo total desta aba</strong>
        <span>{money(custoTotalMateriaisEInsumos(result))}</span>
      </div>
    </>
  );
}

function MateriaisBloco({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft, updateCollection, removeCollection } = levantamento;

  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  const semInsumos = confirmacoes.noInputs === true;
  const temComposicao = hasMeaningfulInputs(draft);
  const materiais = registros(draft.materials);
  const calculados = registros(result.materialResults);

  function definirSemInsumos(valor: boolean) {
    setDraft(atual => ({
      ...atual,
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noInputs: valor
      }
    }));
  }

  /**
   * Acrescenta material **e desfaz a confirmação de "sem insumos"**.
   * Deixar as duas coexistindo permitiria salvar um levantamento que afirma
   * não ter insumos e lista três.
   */
  function acrescentarMaterial() {
    setDraft(atual => ({
      ...atual,
      materials: [...registros(atual.materials), novoMaterial()],
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
          <h2>Materiais e insumos</h2>
          <p>
            Cadastre peças, consumíveis e itens manuais. No dimensionamento,
            selecione os serviços de cada sistema para liberar filtros e produtos químicos.
          </p>
        </div>
        <button type="button" className="com-btn-add" onClick={acrescentarMaterial}>
          + Adicionar item
        </button>
      </div>

      <ConfirmacaoEscopo
        confirmado={semInsumos}
        tituloPendente={
          temComposicao
            ? 'Composição de insumos identificada'
            : 'Revisão obrigatória dos insumos'
        }
        tituloConfirmado="Sem insumos confirmado"
        descricaoPendente="Se este serviço realmente não utilizar insumos, confirme explicitamente antes de finalizar."
        descricaoConfirmada="Materiais, produtos, filtros e efluente ficam fora deste levantamento."
        rotulo="Confirmo que não haverá materiais ou insumos"
        onChange={definirSemInsumos}
      />

      {!semInsumos && !temComposicao && (
        <AvisoPendencia>
          Adicione ao menos um material, circuito, produto manual ou filtro, ou confirme que
          não haverá insumos.
        </AvisoPendencia>
      )}

      {materiais.length > 0 ? (
        <div className="com-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  Descrição<span className="survey-required-marker">*</span>
                </th>
                <th scope="col">Categoria</th>
                <th scope="col">Unidade</th>
                <th scope="col">
                  Quantidade<span className="survey-required-marker">*</span>
                </th>
                <th scope="col">Custo unitário</th>
                <th scope="col">Perda</th>
                <th scope="col">Frete</th>
                <th scope="col">Incluir</th>
                <th scope="col">Subtotal</th>
                <th scope="col">
                  <span className="com-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {materiais.map(item => {
                const id = String(item.id);
                const calculado = calculados.find(c => c.id === id) || {};

                const editar = (patch: AnyRecord) => updateCollection('materials', id, patch);
                const editarNumero = (campo: string) => (event: { target: { value: string } }) =>
                  editar({
                    [campo]: event.target.value === '' ? 0 : Number(event.target.value)
                  });

                return (
                  <tr key={id}>
                    <td>
                      <input
                        aria-label="Descrição"
                        value={String(item.description || '')}
                        onChange={event => editar({ description: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Categoria"
                        value={String(item.category || 'material')}
                        onChange={event => editar({ category: event.target.value })}
                      >
                        {CATEGORIAS.map(categoria => (
                          <option key={categoria.value} value={categoria.value}>
                            {categoria.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Unidade"
                        value={String(item.unit || '')}
                        onChange={event => editar({ unit: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label="Quantidade"
                        value={Number(item.quantity) || ''}
                        min={0}
                        step={0.01}
                        onChange={editarNumero('quantity')}
                      />
                    </td>
                    <td>
                      <MoneyInput
                        aria-label="Custo unitário"
                        value={(item.unitCost as number) ?? ''}
                        onChange={valor => editar({ unitCost: valor })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label="Perda em porcentagem"
                        value={Number(item.wastePercent) || ''}
                        min={0}
                        step={0.1}
                        onChange={editarNumero('wastePercent')}
                      />
                    </td>
                    <td>
                      <MoneyInput
                        aria-label="Frete"
                        value={(item.freightValue as number) ?? ''}
                        onChange={valor => editar({ freightValue: valor })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Incluir no levantamento"
                        checked={item.included !== false}
                        onChange={event => editar({ included: event.target.checked })}
                      />
                    </td>
                    <td className="com-calculado">
                      {/* Item excluído mostra travessão, não R$ 0,00: zero
                          seria um valor, e o item não entra no cálculo. */}
                      {item.included === false ? '—' : money(numberValue(calculado.total))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover ${String(item.description || 'item')}`}
                        onClick={() => removeCollection('materials', id)}
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
      ) : (
        <div className="com-vazio">Nenhum material ou insumo cadastrado.</div>
      )}

      <div className="com-nota-regra">
        <strong>Custo de materiais neste levantamento</strong>
        <span>
          {money(numberValue(result.materialCost))} em materiais ·{' '}
          {number(materiais.filter(item => item.included !== false).length)} item(ns)
          incluído(s)
        </span>
      </div>

    </section>
  );
}
