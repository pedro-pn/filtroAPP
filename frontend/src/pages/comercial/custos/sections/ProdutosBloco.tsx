import { MoneyInput } from '../../components/Field';
import { normalizeCostEstimatePayload, technicalServiceRequiresChemicalProducts } from '../../../../../../shared/comercial/dist/cost-model.js';
import { money, number, numberValue } from '../formato';
import type { Levantamento } from '../useLevantamento';

/**
 * Produtos dimensionados por volume — o último bloco de Materiais e insumos.
 *
 * Porte de `draft.products` (`app/custos/page.tsx:1200-1233`).
 *
 * Este bloco é onde o volume dos circuitos vira **quantidade de produto a
 * comprar**. A regra de dosagem escolhe como: percentual do volume, litros por
 * metro cúbico, quilos por metro cúbico, ou quantidade manual.
 *
 * Duas coisas que o cálculo faz e não são óbvias na tela:
 *
 * 1. **A densidade converte litro em quilo.** Produto vendido em kg e dosado
 *    em % do volume precisa dela; sem densidade certa a compra sai errada na
 *    mesma proporção.
 *
 * 2. **A embalagem arredonda para cima.** Precisar de 21 kg com embalagem de
 *    20 kg significa comprar duas — a diferença entre necessidade e compra é
 *    justamente o que a última coluna mostra.
 */

type AnyRecord = Record<string, unknown>;

const REGRAS = [
  { value: 'percent_volume', label: '% do volume' },
  { value: 'liters_per_m3', label: 'L por m³' },
  { value: 'kg_per_m3', label: 'kg por m³' },
  { value: 'manual', label: 'Quantidade manual' }
];

const UNIDADES = [
  { value: 'kg', label: 'kg' },
  { value: 'L', label: 'L' },
  { value: 'un', label: 'un.' },
  { value: 'm³', label: 'm³' }
];

const BASES_PRECO = [
  { value: 'unit', label: 'Unidade' },
  { value: 'package', label: 'Embalagem' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function novoProduto(circuitoId?: string): AnyRecord {
  return {
    id: `produto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    systemId: circuitoId,
    productName: 'Novo produto',
    unit: 'kg',
    // Sem circuito não há volume para dosar, então o padrão é manual.
    doseMode: circuitoId ? 'percent_volume' : 'manual',
    dose: 0,
    densityKgPerL: 1,
    wastePercent: 0,
    packageSize: 1,
    priceBasis: 'unit',
    unitCost: 0,
    manualQuantity: 0,
    included: true
  };
}

export function ProdutosBloco({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft, updateCollection } = levantamento;

  const todosOsCircuitos = registros(draft.volumeSystems).filter(
    circuito => circuito.enabled !== false
  );
  const normalizado = normalizeCostEstimatePayload(draft);
  const servicosConfigurados = Array.isArray(normalizado.circuitServices);
  const circuitosComLimpeza = new Set(
    registros(normalizado.circuitServices)
      .filter(servico => technicalServiceRequiresChemicalProducts(servico.serviceId))
      .map(servico => String(servico.systemId || ''))
  );
  const circuitos = servicosConfigurados
    ? todosOsCircuitos.filter(circuito => circuitosComLimpeza.has(String(circuito.id)))
    : todosOsCircuitos;
  const produtoAplicavel = (produto: AnyRecord) => {
    const circuitoId = String(produto.systemId || '');
    return !servicosConfigurados
      || !circuitoId
      || circuitoId === '*'
      || circuitosComLimpeza.has(circuitoId);
  };
  const produtos = registros(draft.products).filter(produtoAplicavel);
  const produtosExcluidos = registros(draft.deletedProducts).filter(produtoAplicavel);
  const calculados = registros(result.productResults);

  function acrescentar() {
    setDraft(atual => ({
      ...atual,
      products: [...registros(atual.products), novoProduto(String(circuitos[0]?.id || ''))],
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noInputs: false
      }
    }));
  }

  function excluir(produtoId: string) {
    setDraft(atual => {
      const ativos = registros(atual.products);
      const removido = ativos.find(item => String(item.id) === produtoId);
      if (!removido) return atual;

      return {
        ...atual,
        products: ativos.filter(item => String(item.id) !== produtoId),
        deletedProducts: [
          ...registros(atual.deletedProducts).filter(
            item => String(item.id) !== produtoId
          ),
          removido
        ]
      };
    });
  }

  function restaurarExcluidos() {
    setDraft(atual => {
      const ativos = registros(atual.products);
      const idsAtivos = new Set(ativos.map(item => String(item.id)));
      const excluidos = registros(atual.deletedProducts);
      const restaurados = excluidos.filter(
        item => produtoAplicavel(item) && !idsAtivos.has(String(item.id))
      );
      if (!restaurados.length) return atual;
      const idsRestaurados = new Set(restaurados.map(item => String(item.id)));

      return {
        ...atual,
        products: [...ativos, ...restaurados],
        deletedProducts: excluidos.filter(
          item => !idsRestaurados.has(String(item.id))
        ),
        scopeConfirmations: {
          ...((atual.scopeConfirmations as AnyRecord) || {}),
          noInputs: false
        }
      };
    });
  }

  return (
    <section className="com-painel">
      <div className="com-secao-titulo">
        <div>
          <h2>Produtos químicos</h2>
          <p>
            A dosagem considera somente o volume dos sistemas com limpeza química em cada
            circuito. A embalagem arredonda a compra para cima. Se a mesma dosagem valer para todos,
            selecione todos os circuitos e cadastre o produto uma única vez.
          </p>
        </div>
        <div className="com-secao-acoes">
          {produtosExcluidos.length > 0 && (
            <button
              type="button"
              className="com-btn com-btn-fantasma"
              aria-label="Restaurar linhas excluídas"
              onClick={restaurarExcluidos}
            >
              Restaurar excluídos ({produtosExcluidos.length})
            </button>
          )}
          <button type="button" className="com-btn-add" onClick={acrescentar}>
            + Adicionar produto
          </button>
        </div>
      </div>

      {produtos.length > 0 ? (
        <div className="com-table-wrap com-table-wrap-produtos-volume">
          <table className="com-tabela-produtos-volume">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Circuito</th>
                <th scope="col">Regra</th>
                <th scope="col">Dosagem</th>
                <th scope="col">Un.</th>
                <th scope="col">Densidade kg/L</th>
                <th scope="col">Perda</th>
                <th scope="col">Embalagem</th>
                <th scope="col">Preço por</th>
                <th scope="col">Preço base</th>
                <th scope="col">Incluir</th>
                <th scope="col">Necessidade / compra</th>
                <th scope="col">
                  <span className="com-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {produtos.map(item => {
                const id = String(item.id);
                const calculado = calculados.find(c => c.id === id) || {};
                const editar = (patch: AnyRecord) => updateCollection('products', id, patch);
                const numero = (campo: string) => (event: { target: { value: string } }) =>
                  editar({
                    [campo]: event.target.value === '' ? 0 : Number(event.target.value)
                  });

                const manual = item.doseMode === 'manual';

                return (
                  <tr key={id}>
                    <td>
                      <input
                        aria-label="Nome do produto"
                        value={String(item.productName || '')}
                        onChange={event => editar({ productName: event.target.value })}
                      />
                    </td>

                    <td>
                      <select
                        aria-label="Circuito"
                        value={String(item.systemId || '')}
                        onChange={event => {
                          const circuitoId = event.target.value;
                          // Tirar o circuito obriga a dosagem manual: sem
                          // volume não há sobre o que dosar.
                          editar(
                            circuitoId
                              ? { systemId: circuitoId }
                              : { systemId: '', doseMode: 'manual' }
                          );
                        }}
                      >
                        <option value="">Manual / sem circuito</option>
                        <option value="*">
                          {servicosConfigurados
                            ? 'Todos com limpeza química'
                            : 'Todos os circuitos'}
                        </option>
                        {circuitos.map(circuito => (
                          <option key={String(circuito.id)} value={String(circuito.id)}>
                            {String(circuito.name || 'Circuito')}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        aria-label="Regra de dosagem"
                        value={String(item.doseMode || 'manual')}
                        disabled={!item.systemId}
                        onChange={event => editar({ doseMode: event.target.value })}
                      >
                        {REGRAS.map(regra => (
                          <option key={regra.value} value={regra.value}>
                            {regra.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      {/* Dosagem e quantidade manual são o MESMO lugar na
                          tabela, porque são a mesma pergunta feita de dois
                          jeitos: quanto de produto. */}
                      <input
                        type="number"
                        aria-label={manual ? 'Quantidade manual' : 'Dosagem'}
                        min={0}
                        step={0.0001}
                        value={Number(manual ? item.manualQuantity : item.dose) || ''}
                        onChange={numero(manual ? 'manualQuantity' : 'dose')}
                      />
                    </td>

                    <td>
                      <select
                        aria-label="Unidade"
                        value={String(item.unit || 'kg')}
                        onChange={event => editar({ unit: event.target.value })}
                      >
                        {UNIDADES.map(unidade => (
                          <option key={unidade.value} value={unidade.value}>
                            {unidade.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Densidade em kg por litro"
                        min={0}
                        step={0.001}
                        value={Number(item.densityKgPerL) || ''}
                        onChange={numero('densityKgPerL')}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Perda em porcentagem"
                        min={0}
                        step={0.1}
                        value={Number(item.wastePercent) || ''}
                        onChange={numero('wastePercent')}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Tamanho da embalagem"
                        min={0}
                        step={0.01}
                        value={Number(item.packageSize) || ''}
                        onChange={numero('packageSize')}
                      />
                    </td>

                    <td>
                      <select
                        aria-label="Preço por"
                        value={String(item.priceBasis || 'unit')}
                        onChange={event => editar({ priceBasis: event.target.value })}
                      >
                        {BASES_PRECO.map(base => (
                          <option key={base.value} value={base.value}>
                            {base.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <MoneyInput
                        aria-label="Preço base"
                        value={(item.unitCost as number) ?? ''}
                        onChange={valor => editar({ unitCost: valor })}
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
                      {item.included === false ? (
                        '—'
                      ) : (
                        <>
                          {/* Necessidade é o que o cálculo pede; compra é o que
                              a embalagem obriga. A diferença é desperdício
                              inevitável, e o orçamentista precisa ver as duas. */}
                          <span>{number(numberValue(calculado.requiredQuantity))}</span>
                          {' / '}
                          <strong>{number(numberValue(calculado.purchaseQuantity))}</strong>
                          <small className="com-nota">
                            {money(numberValue(calculado.total))}
                          </small>
                        </>
                      )}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover ${String(item.productName || 'produto')}`}
                        onClick={() => excluir(id)}
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
        <div className="com-vazio">Nenhum produto dimensionado.</div>
      )}
    </section>
  );
}
