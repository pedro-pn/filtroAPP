import { useState } from 'react';

import {
  COMMON_INCH_DIAMETERS,
  commonInchDiameterLabel,
  inchDiameterToNumber
} from '../../../../constants/tubeDiameters';
import { number, numberValue } from '../formato';
import type { Levantamento } from '../useLevantamento';
import {
  comprimentoEmMetros,
  comprimentoParaExibicao,
  diametroEmMilimetros,
  diametroParaExibicao,
  type UnidadeDeComprimento,
  type UnidadeDeDiametro
} from '../unidadesDeTubo';

/**
 * Dimensionamento dos circuitos — bloco da seção Materiais e insumos.
 *
 * Porte de `draft.volumeSystems` (`app/custos/page.tsx:1091-1199`).
 *
 * É o bloco mais profundo do levantamento: cada circuito tem **quatro
 * coleções** — trechos de tubo, mangueiras, equipamentos e volumes manuais —
 * e a soma delas, multiplicada pelos ciclos, dá o volume do circuito.
 *
 * Por que isso importa além do volume: **os produtos químicos são dosados
 * sobre este número**. Um circuito mal dimensionado não erra só o "Volume
 * calculado" da faixa — erra a quantidade de produto, que é custo real.
 *
 * O volume de tubo sai de `π × (d/2)² × comprimento × quantidade × %`, e o
 * motor sempre recebe diâmetro em milímetros e comprimento em metros. A tela
 * converte a unidade escolhida antes de atualizar o rascunho, mantendo o
 * cálculo canônico sem obrigar o orçamentista a converter medidas à mão.
 */

type AnyRecord = Record<string, unknown>;

const MATERIAIS = [
  { value: 'carbon_steel', label: 'Aço carbono' },
  { value: 'stainless_steel', label: 'Aço inox' },
  { value: 'other', label: 'Outro' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function id(prefixo: string) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const NOVO = {
  circuito: (indice: number): AnyRecord => ({
    id: id('circuito'),
    name: indice === 0 ? 'Circuito de aço carbono' : `Circuito ${indice + 1}`,
    material: indice === 0 ? 'carbon_steel' : 'other',
    pipeSegments: [NOVO.tubo()],
    hoseSegments: [],
    equipmentVolumes: [],
    manualVolumes: [],
    cycles: 1,
    enabled: true
  }),
  tubo: (): AnyRecord => ({
    id: id('tubo'),
    description: 'Linha principal',
    quantity: 1,
    lengthM: 0,
    lengthUnit: 'm',
    internalDiameterMm: 0,
    diameterUnit: 'in',
    fillPercent: 100
  }),
  mangueira: (): AnyRecord => ({
    id: id('mangueira'),
    description: 'Mangueira de interligação',
    quantity: 1,
    lengthM: 0,
    internalDiameterMm: 0,
    fillPercent: 100
  }),
  equipamento: (): AnyRecord => ({
    id: id('equipamento'),
    description: 'Máquina / reservatório 120 L',
    quantity: 1,
    volumeLiters: 120,
    included: true
  }),
  volume: (): AnyRecord => ({
    id: id('volume'),
    description: 'Reservatório / outro volume',
    quantity: 1,
    volumeLiters: 0
  })
};

/** Coleções com comprimento e diâmetro — tubos e mangueiras. */
const COM_GEOMETRIA = new Set(['pipeSegments', 'hoseSegments']);

export function CircuitosBloco({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft, updateCollection, updateNested, removeNested, addNested } =
    levantamento;

  const circuitos = registros(draft.volumeSystems);
  const calculados = registros(result.volumeResults);
  const [circuitosAbertos, setCircuitosAbertos] = useState<Set<string>>(() => new Set());

  function acrescentarCircuito() {
    const novo = NOVO.circuito(circuitos.length);
    setDraft(atual => {
      const atuais = registros(atual.volumeSystems);
      return {
        ...atual,
        volumeSystems: [...atuais, novo],
        scopeConfirmations: {
          ...((atual.scopeConfirmations as AnyRecord) || {}),
          noInputs: false
        }
      };
    });
    setCircuitosAbertos(atuais => new Set(atuais).add(String(novo.id)));
  }

  function alternarCircuito(circuitoId: string) {
    setCircuitosAbertos(atuais => {
      const proximos = new Set(atuais);
      if (proximos.has(circuitoId)) proximos.delete(circuitoId);
      else proximos.add(circuitoId);
      return proximos;
    });
  }

  return (
    <section className="com-painel">
      <div className="com-secao-titulo">
        <div>
          <h2>Dimensionamento dos circuitos</h2>
          <p>
            O volume de cada circuito alimenta a dosagem dos produtos químicos.
            Escolha a unidade de comprimento e informe o diâmetro em polegadas ou
            milímetros.
          </p>
        </div>
        <button type="button" className="com-btn-add" onClick={acrescentarCircuito}>
          + Adicionar circuito
        </button>
      </div>

      {circuitos.length === 0 ? (
        <div className="com-vazio">Nenhum circuito dimensionado.</div>
      ) : (
        <div className="com-fases">
          {circuitos.map((circuito, indice) => {
            const circuitoId = String(circuito.id);
            const calculado =
              calculados.find(c => c.systemId === circuitoId || c.id === circuitoId) || {};
            const volume = numberValue(
              calculado.totalVolumeLiters ?? calculado.volumeLiters ?? calculado.total
            );
            const aberto = circuitosAbertos.has(circuitoId);

            const editar = (patch: AnyRecord) =>
              updateCollection('volumeSystems', circuitoId, patch);

            return (
              <article key={circuitoId} className="com-fase-card com-circuito-card">
                <header className="com-fase-card-topo com-circuito-resumo">
                  <button
                    type="button"
                    className="com-circuito-toggle"
                    aria-expanded={aberto}
                    aria-controls={`${circuitoId}-corpo`}
                    onClick={() => alternarCircuito(circuitoId)}
                  >
                    <span className="com-fase-indice">{indice + 1}</span>
                    <span>
                      <small>Circuito</small>
                      <strong>{String(circuito.name || `Circuito ${indice + 1}`)}</strong>
                    </span>
                    <span className="com-volume-badge">{number(volume)} L</span>
                    <span className="com-circuito-seta" aria-hidden="true">
                      {aberto ? '▴' : '▾'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    onClick={() => alternarCircuito(circuitoId)}
                  >
                    {aberto ? 'Minimizar' : 'Abrir para preencher'}
                  </button>
                </header>

                {aberto && (
                <div id={`${circuitoId}-corpo`} className="com-circuito-corpo">
                <header className="com-fase-card-topo">
                  <div className="com-fase-identidade">
                    <span className="com-fase-indice">{indice + 1}</span>
                    <label>
                      <small>Nome do circuito</small>
                      <input
                        aria-label="Nome do circuito"
                        value={String(circuito.name || '')}
                        onChange={event => editar({ name: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="com-fase-acoes">
                    <span className="com-volume-badge">
                      {number(volume)} L
                    </span>
                    <button
                      type="button"
                      className="com-btn com-btn-perigo"
                      disabled={circuitos.length <= 1}
                      onClick={() => {
                        setDraft(atual => ({
                          ...atual,
                          volumeSystems: registros(atual.volumeSystems).filter(
                            item => String(item.id) !== circuitoId
                          ),
                          circuitServices: Array.isArray(atual.circuitServices)
                            ? registros(atual.circuitServices).filter(
                                item => String(item.systemId) !== circuitoId
                              )
                            : atual.circuitServices
                        }));
                        setCircuitosAbertos(atuais => {
                          const proximos = new Set(atuais);
                          proximos.delete(circuitoId);
                          return proximos;
                        });
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </header>

                <div className="com-form-grid">
                  <div className="field-group">
                    <label htmlFor={`${circuitoId}-material`}>Material</label>
                    <select
                      id={`${circuitoId}-material`}
                      value={String(circuito.material || 'other')}
                      onChange={event => editar({ material: event.target.value })}
                    >
                      {MATERIAIS.map(material => (
                        <option key={material.value} value={material.value}>
                          {material.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label htmlFor={`${circuitoId}-ciclos`}>Ciclos</label>
                    <input
                      id={`${circuitoId}-ciclos`}
                      type="number"
                      min={1}
                      step={1}
                      value={Number(circuito.cycles) || ''}
                      onChange={event =>
                        editar({
                          cycles: event.target.value === '' ? 1 : Number(event.target.value)
                        })
                      }
                    />
                    {/* O ciclo multiplica o volume: duas passagens de limpeza
                        consomem duas vezes o produto. */}
                    <small className="field-hint">Multiplica o volume do circuito</small>
                  </div>
                </div>

                <SubTabela
                  titulo="Trechos de tubo"
                  colecao="pipeSegments"
                  itens={registros(circuito.pipeSegments)}
                  circuitoId={circuitoId}
                  onEditar={updateNested}
                  onRemover={removeNested}
                  onAdicionar={() =>
                    addNested('volumeSystems', circuitoId, 'pipeSegments', NOVO.tubo())
                  }
                />

                <SubTabela
                  titulo="Mangueiras"
                  colecao="hoseSegments"
                  itens={registros(circuito.hoseSegments)}
                  circuitoId={circuitoId}
                  onEditar={updateNested}
                  onRemover={removeNested}
                  onAdicionar={() =>
                    addNested('volumeSystems', circuitoId, 'hoseSegments', NOVO.mangueira())
                  }
                />

                <SubTabela
                  titulo="Equipamentos e reservatórios"
                  colecao="equipmentVolumes"
                  itens={registros(circuito.equipmentVolumes)}
                  circuitoId={circuitoId}
                  onEditar={updateNested}
                  onRemover={removeNested}
                  onAdicionar={() =>
                    addNested(
                      'volumeSystems',
                      circuitoId,
                      'equipmentVolumes',
                      NOVO.equipamento()
                    )
                  }
                />

                <SubTabela
                  titulo="Volumes manuais"
                  colecao="manualVolumes"
                  itens={registros(circuito.manualVolumes)}
                  circuitoId={circuitoId}
                  onEditar={updateNested}
                  onRemover={removeNested}
                  onAdicionar={() =>
                    addNested('volumeSystems', circuitoId, 'manualVolumes', NOVO.volume())
                  }
                />
                </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Tabela de uma das quatro coleções do circuito.
 *
 * As quatro têm forma parecida mas colunas diferentes: tubo e mangueira pedem
 * geometria; equipamento e volume manual pedem litros direto. Um componente só
 * com a diferença explícita é mais honesto que quatro quase-iguais.
 */
function SubTabela({
  titulo,
  colecao,
  itens,
  circuitoId,
  onEditar,
  onRemover,
  onAdicionar
}: {
  titulo: string;
  colecao: string;
  itens: AnyRecord[];
  circuitoId: string;
  onEditar: (c: string, p: string, a: string, i: string, patch: AnyRecord) => void;
  onRemover: (c: string, p: string, a: string, i: string) => void;
  onAdicionar: () => void;
}) {
  const comGeometria = COM_GEOMETRIA.has(colecao);
  const trechoDeTubo = colecao === 'pipeSegments';
  const comInclusao = colecao === 'equipmentVolumes';

  return (
    <section className="com-fase-painel">
      <header>
        <strong>{titulo}</strong>
      </header>

      {itens.length > 0 ? (
        <div className="com-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  {trechoDeTubo ? 'Nome do sistema' : 'Descrição'}
                </th>
                <th scope="col">Qtd.</th>
                {comGeometria ? (
                  <>
                    <th scope="col">
                      {trechoDeTubo ? 'Comprimento' : 'Comprimento (m)'}
                    </th>
                    <th scope="col">
                      {trechoDeTubo ? 'Ø interno' : 'Ø interno (mm)'}
                    </th>
                    <th scope="col">Preenchimento (%)</th>
                  </>
                ) : (
                  <th scope="col">Volume (L)</th>
                )}
                {comInclusao && <th scope="col">Incluir</th>}
                <th scope="col">
                  <span className="com-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.map(item => {
                const itemId = String(item.id);
                const unidadeDeComprimento = String(
                  item.lengthUnit || 'm'
                ) as UnidadeDeComprimento;
                const unidadeDeDiametro = String(
                  item.diameterUnit
                    || (numberValue(item.internalDiameterMm) > 0 ? 'mm' : 'in')
                ) as UnidadeDeDiametro;
                const diametroEmPolegadas = diametroParaExibicao(
                  Number(item.internalDiameterMm) || 0,
                  'in'
                );
                const rotuloDoDiametroEmPolegadas = commonInchDiameterLabel(
                  diametroEmPolegadas
                );
                const editar = (patch: AnyRecord) =>
                  onEditar('volumeSystems', circuitoId, colecao, itemId, patch);
                const numero = (campo: string) => (event: { target: { value: string } }) =>
                  editar({
                    [campo]: event.target.value === '' ? 0 : Number(event.target.value)
                  });

                return (
                  <tr key={itemId}>
                    <td>
                      <input
                        aria-label={trechoDeTubo ? 'Nome do sistema' : 'Descrição'}
                        value={String(item.description || '')}
                        onChange={event => editar({ description: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label="Quantidade"
                        min={0}
                        step={1}
                        value={Number(item.quantity) || ''}
                        onChange={numero('quantity')}
                      />
                    </td>

                    {comGeometria ? (
                      <>
                        <td>
                          {trechoDeTubo ? (
                            <div className="com-medida-com-unidade">
                              <input
                                type="number"
                                aria-label="Comprimento"
                                min={0}
                                step={unidadeDeComprimento === 'm' ? 0.01 : 1}
                                value={
                                  comprimentoParaExibicao(
                                    Number(item.lengthM) || 0,
                                    unidadeDeComprimento
                                  ) || ''
                                }
                                onChange={event =>
                                  editar({
                                    lengthM: comprimentoEmMetros(
                                      event.target.value === '' ? 0 : Number(event.target.value),
                                      unidadeDeComprimento
                                    )
                                  })
                                }
                              />
                              <select
                                aria-label="Unidade do comprimento"
                                value={unidadeDeComprimento}
                                onChange={event =>
                                  editar({ lengthUnit: event.target.value })
                                }
                              >
                                <option value="m">m</option>
                                <option value="cm">cm</option>
                                <option value="mm">mm</option>
                              </select>
                            </div>
                          ) : (
                            <input
                              type="number"
                              aria-label="Comprimento em metros"
                              min={0}
                              step={0.01}
                              value={Number(item.lengthM) || ''}
                              onChange={numero('lengthM')}
                            />
                          )}
                        </td>
                        <td>
                          {trechoDeTubo ? (
                            <div className="com-medida-com-unidade">
                              {unidadeDeDiametro === 'in' ? (
                                <select
                                  className="com-medida-valor"
                                  aria-label="Diâmetro interno em polegadas"
                                  value={rotuloDoDiametroEmPolegadas}
                                  onChange={event =>
                                    editar({
                                      internalDiameterMm: event.target.value
                                        ? diametroEmMilimetros(
                                            inchDiameterToNumber(event.target.value),
                                            'in'
                                          )
                                        : 0
                                    })
                                  }
                                >
                                  <option value="">Selecionar...</option>
                                  {COMMON_INCH_DIAMETERS.map(diametro => (
                                    <option key={diametro} value={diametro}>
                                      {diametro}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="number"
                                  aria-label="Diâmetro interno em milímetros"
                                  min={0}
                                  step={0.1}
                                  value={
                                    diametroParaExibicao(
                                      Number(item.internalDiameterMm) || 0,
                                      'mm'
                                    ) || ''
                                  }
                                  onChange={event =>
                                    editar({
                                      internalDiameterMm: diametroEmMilimetros(
                                        event.target.value === '' ? 0 : Number(event.target.value),
                                        'mm'
                                      )
                                    })
                                  }
                                />
                              )}
                              <select
                                aria-label="Unidade do diâmetro"
                                value={unidadeDeDiametro}
                                onChange={event => {
                                  const novaUnidade = event.target.value as UnidadeDeDiametro;
                                  editar({
                                    diameterUnit: novaUnidade,
                                    ...(novaUnidade === 'in'
                                      && !rotuloDoDiametroEmPolegadas
                                      ? { internalDiameterMm: 0 }
                                      : {})
                                  });
                                }}
                              >
                                <option value="in">pol.</option>
                                <option value="mm">mm</option>
                              </select>
                            </div>
                          ) : (
                            <input
                              type="number"
                              aria-label="Diâmetro interno em milímetros"
                              min={0}
                              step={0.1}
                              value={Number(item.internalDiameterMm) || ''}
                              onChange={numero('internalDiameterMm')}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            aria-label="Percentual de preenchimento"
                            min={0}
                            max={100}
                            step={1}
                            value={Number(item.fillPercent) || ''}
                            onChange={numero('fillPercent')}
                          />
                        </td>
                      </>
                    ) : (
                      <td>
                        <input
                          type="number"
                          aria-label="Volume em litros"
                          min={0}
                          step={0.01}
                          value={Number(item.volumeLiters) || ''}
                          onChange={numero('volumeLiters')}
                        />
                      </td>
                    )}

                    {comInclusao && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Incluir no volume"
                          checked={item.included !== false}
                          onChange={event => editar({ included: event.target.checked })}
                        />
                      </td>
                    )}

                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover ${String(item.description || 'item')}`}
                        onClick={() => onRemover('volumeSystems', circuitoId, colecao, itemId)}
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
        <div className="com-vazio">Nenhum item.</div>
      )}

      <button type="button" className="com-btn-add" onClick={onAdicionar}>
        + Adicionar
      </button>
    </section>
  );
}
