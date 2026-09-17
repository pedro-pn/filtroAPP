import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DIMENSIONING_TYPES,
  OIL_TYPES,
  SYSTEM_MATERIALS,
  servicesForDimensioning,
  type DimensioningType
} from '../../../../../../shared/comercial/dist/dimensioning.js';
import { CabecalhoRetratil } from '../../components/CabecalhoRetratil';
import {
  COMMON_INCH_DIAMETERS,
  commonInchDiameterLabel,
  inchDiameterToNumber
} from '../../../../constants/tubeDiameters';
import { number, numberValue } from '../formato';
import { novoCircuito, novoSistemaDimensionado } from '../dimensionamento';
import type { Levantamento } from '../useLevantamento';
import {
  comprimentoEmMetros,
  comprimentoParaExibicao,
  diametroEmMilimetros,
  diametroParaExibicao,
  type UnidadeDeComprimento,
  type UnidadeDeDiametro
} from '../unidadesDeTubo';

type AnyRecord = Record<string, unknown>;
const registros = (value: unknown): AnyRecord[] =>
  Array.isArray(value) ? value : [];

export function CircuitosBloco({
  levantamento
}: {
  levantamento: Levantamento;
}) {
  const { draft, result, setDraft, updateCollection, erroDe } = levantamento;
  const circuitos = registros(draft.volumeSystems);
  const calculados = registros(result.volumeResults);
  const [fechados, setFechados] = useState<Set<string>>(() => new Set());

  function acrescentarCircuito() {
    setDraft((atual) => ({
      ...atual,
      volumeSystems: [...registros(atual.volumeSystems), novoCircuito()],
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
          <h2>Dimensionamento dos circuitos</h2>
          <p>
            Adicione os equipamentos e selecione os serviços de cada sistema. O
            dimensionamento alimenta os insumos e o escopo da proposta.
          </p>
        </div>
      </div>
      <div className="com-fases">
        {circuitos.map((circuito, indice) => {
          const circuitoId = String(circuito.id);
          const path = `volumeSystems[${indice}]`;
          const calculado =
            calculados.find((item) => item.id === circuitoId) || {};
          const temErro = Boolean(
            erroDe(`${path}.name`) ||
            erroDe(`${path}.items`) ||
            DIMENSIONING_TYPES.some((type) =>
              registros(circuito[type.collection]).some((_, index) =>
                [
                  'description',
                  'serviceIds',
                  'oilType',
                  'material',
                  'internalDiameterMm'
                ].some((field) =>
                  erroDe(`${path}.${type.collection}[${index}].${field}`)
                )
              )
            )
          );
          const aberto = !fechados.has(circuitoId) || temErro;
          return (
            <article
              key={circuitoId}
              className="com-fase-card com-circuito-card"
            >
              <header className="com-fase-card-topo com-cabecalho-retratil">
                <CabecalhoRetratil
                  titulo={String(circuito.name || `Circuito ${indice + 1}`)}
                  descricao="Equipamento do cliente"
                  indice={indice + 1}
                  resumo={
                    <span className="com-volume-badge">
                      {number(numberValue(calculado.totalVolumeLiters))} L
                    </span>
                  }
                  aberto={aberto}
                  conteudoId={`${circuitoId}-corpo`}
                  onAlternar={() =>
                    setFechados((atuais) => {
                      const novos = new Set(atuais);
                      if (novos.has(circuitoId)) novos.delete(circuitoId);
                      else novos.add(circuitoId);
                      return novos;
                    })
                  }
                />
              </header>
              {aberto && (
                <div id={`${circuitoId}-corpo`} className="com-circuito-corpo">
                  <div className="com-form-grid">
                    <Campo
                      label="Nome do circuito"
                      error={erroDe(`${path}.name`)}
                    >
                      <input
                        aria-label="Nome do circuito"
                        aria-invalid={
                          Boolean(erroDe(`${path}.name`)) || undefined
                        }
                        placeholder="Digite o nome do equipamento do cliente"
                        value={String(circuito.name || '')}
                        onChange={(event) =>
                          updateCollection('volumeSystems', circuitoId, {
                            name: event.target.value
                          })
                        }
                      />
                    </Campo>
                    <Campo label="Ciclos">
                      <input
                        type="number"
                        aria-label="Ciclos"
                        min={1}
                        step={1}
                        value={Number(circuito.cycles) || ''}
                        onChange={(event) =>
                          updateCollection('volumeSystems', circuitoId, {
                            cycles: Number(event.target.value) || 1
                          })
                        }
                      />
                      <small className="field-hint">
                        Multiplica o volume do circuito
                      </small>
                    </Campo>
                  </div>
                  <SistemasDoCircuito
                    circuito={circuito}
                    path={path}
                    levantamento={levantamento}
                  />
                  <button
                    type="button"
                    className="com-btn com-btn-perigo com-circuito-remover"
                    disabled={circuitos.length <= 1}
                    onClick={() =>
                      setDraft((atual) => ({
                        ...atual,
                        volumeSystems: registros(atual.volumeSystems).filter(
                          (item) => item.id !== circuitoId
                        ),
                        circuitServices: registros(
                          atual.circuitServices
                        ).filter((item) => item.systemId !== circuitoId)
                      }))
                    }
                  >
                    Remover circuito
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="com-btn-add com-circuito-adicionar"
        onClick={acrescentarCircuito}
      >
        + Adicionar circuito
      </button>
    </section>
  );
}

function Campo({
  label,
  error,
  children
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field-group${error ? ' com-campo-invalido' : ''}`}>
      <span className="com-dimension-label">{label}</span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function EscolherTipo({
  escolher,
  fechar
}: {
  escolher: (tipo: DimensioningType) => void;
  fechar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogo.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={dialogo}
      className="com-dimension-dialog"
      aria-labelledby="com-tipo-equipamento-titulo"
      onCancel={(event) => {
        event.preventDefault();
        fechar();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) fechar();
      }}
    >
      <h3 id="com-tipo-equipamento-titulo">Tipo de equipamento</h3>
      <p>Qual tipo deseja adicionar a este circuito?</p>
      <div className="com-dimension-options">
        {DIMENSIONING_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className="com-btn"
            onClick={() => escolher(type.id)}
          >
            {type.id === 'oil' ? 'Óleo' : type.title}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="com-btn com-btn-fantasma"
        onClick={fechar}
      >
        Cancelar
      </button>
    </dialog>
  );
}

function SistemasDoCircuito({
  circuito,
  path,
  levantamento
}: {
  circuito: AnyRecord;
  path: string;
  levantamento: Levantamento;
}) {
  const { setDraft, updateNested, removeNested, erroDe } = levantamento;
  const circuitoId = String(circuito.id);
  const [dialogo, setDialogo] = useState(false);
  const [tipoSelecionado, setTipoSelecionado] =
    useState<DimensioningType>('pipes');
  const tipos = DIMENSIONING_TYPES.filter(
    (type) => registros(circuito[type.collection]).length > 0
  );
  const tipoComErro = tipos.find((type) =>
    registros(circuito[type.collection]).some((_, index) =>
      ['description', 'serviceIds', 'oilType', 'material', 'internalDiameterMm'].some(
        (field) => erroDe(`${path}.${type.collection}[${index}].${field}`)
      )
    )
  );
  const tipo = tipos.find((type) => type.id === tipoSelecionado) || tipos[0];
  const tipoInvalido = tipoComErro?.id;
  useEffect(() => {
    if (!tipoInvalido) return;
    const frame = requestAnimationFrame(() => setTipoSelecionado(tipoInvalido));
    return () => cancelAnimationFrame(frame);
  }, [tipoInvalido]);

  function adicionar(tipoId: DimensioningType, somenteSeVazio = false) {
    const config = DIMENSIONING_TYPES.find((type) => type.id === tipoId)!;
    setDraft((atual) => ({
      ...atual,
      volumeSystems: registros(atual.volumeSystems).map((system) => {
        if (system.id !== circuitoId) return system;
        const items = registros(system[config.collection]);
        return {
          ...system,
          servicesByItem: true,
          [config.collection]:
            somenteSeVazio && items.length
              ? items
              : [...items, novoSistemaDimensionado(tipoId)]
        };
      }),
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noInputs: false
      }
    }));
    setTipoSelecionado(tipoId);
    setDialogo(false);
  }

  return (
    <section className="com-fase-painel com-dimensionamento">
      <div className="com-secao-titulo">
        <strong>Sistemas e serviços</strong>
        <button
          type="button"
          className="com-btn-add"
          aria-invalid={Boolean(erroDe(`${path}.items`)) || undefined}
          onClick={() => setDialogo(true)}
        >
          + Adicionar serviços
        </button>
      </div>
      {erroDe(`${path}.items`) && (
        <p className="field-error">{erroDe(`${path}.items`)}</p>
      )}
      {!tipo && (
        <p className="com-vazio">
          Adicione serviços para escolher tubulações, reservatórios, óleo ou
          equipamentos avulsos.
        </p>
      )}
      {!!tipos.length && (
        <div
          role="tablist"
          aria-label="Tipos de equipamento"
          className="com-dimension-tabs"
        >
          {tipos.map((item, index) => (
            <button
              key={item.id}
              id={`${circuitoId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={tipo?.id === item.id}
              tabIndex={tipo?.id === item.id ? 0 : -1}
              aria-controls={`${circuitoId}-sistemas`}
              className="com-btn"
              onClick={() => setTipoSelecionado(item.id)}
              onKeyDown={(event) => {
                if (
                  !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                    event.key
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tipos.length - 1
                      : (index +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          tipos.length) %
                        tipos.length;
                setTipoSelecionado(tipos[next].id);
                document
                  .getElementById(`${circuitoId}-tab-${tipos[next].id}`)
                  ?.focus();
              }}
            >
              {item.title} ({registros(circuito[item.collection]).length})
            </button>
          ))}
        </div>
      )}
      {tipo && (
        <div
          id={`${circuitoId}-sistemas`}
          role="tabpanel"
          aria-labelledby={`${circuitoId}-tab-${tipo.id}`}
        >
          {registros(circuito[tipo.collection]).map((item, index) => (
            <Sistema
              key={String(item.id)}
              item={item}
              tipo={tipo.id}
              path={`${path}.${tipo.collection}[${index}]`}
              erroDe={erroDe}
              editar={(patch) =>
                updateNested(
                  'volumeSystems',
                  circuitoId,
                  tipo.collection,
                  String(item.id),
                  patch
                )
              }
              remover={() =>
                removeNested(
                  'volumeSystems',
                  circuitoId,
                  tipo.collection,
                  String(item.id)
                )
              }
            />
          ))}
          <button
            type="button"
            className="com-btn-add"
            onClick={() => adicionar(tipo.id)}
          >
            + Adicionar sistema
          </button>
        </div>
      )}
      {dialogo && (
        <EscolherTipo
          escolher={(type) => adicionar(type, true)}
          fechar={() => setDialogo(false)}
        />
      )}
    </section>
  );
}

function Sistema({
  item,
  tipo,
  path,
  erroDe,
  editar,
  remover
}: {
  item: AnyRecord;
  tipo: DimensioningType;
  path: string;
  erroDe: Levantamento['erroDe'];
  editar: (patch: AnyRecord) => void;
  remover: () => void;
}) {
  const servicos = Array.isArray(item.serviceIds)
    ? item.serviceIds.map(String)
    : [];
  const catalogo = servicesForDimensioning(tipo);
  const erro = (field: string) => erroDe(`${path}.${field}`);
  const numero = (field: string) => (event: { target: { value: string } }) =>
    editar({ [field]: Number(event.target.value) || 0 });
  return (
    <article
      className="com-dimension-item"
      aria-label={String(item.description || 'Sistema sem nome')}
    >
      <div className={`com-dimension-fields com-dimension-fields--${tipo}`}>
        <Campo label="Nome do sistema" error={erro('description')}>
          <input
            aria-label="Nome do sistema"
            placeholder="Digite o nome do sistema"
            aria-invalid={Boolean(erro('description')) || undefined}
            value={String(item.description || '')}
            onChange={(event) => editar({ description: event.target.value })}
          />
        </Campo>
        {tipo !== 'oil' && (
          <Campo label="Material" error={erro('material')}>
            <select
              aria-label="Material"
              aria-invalid={Boolean(erro('material')) || undefined}
              value={String(item.material || 'other')}
              onChange={(event) => editar({ material: event.target.value })}
            >
              {SYSTEM_MATERIALS.map((material) => (
                <option key={material.value} value={material.value}>
                  {material.label}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {tipo === 'oil' ? (
          <>
            <Campo label="Tipo de óleo" error={erro('oilType')}>
              <select
                aria-label="Tipo de óleo"
                aria-invalid={Boolean(erro('oilType')) || undefined}
                value={String(item.oilType || '')}
                onChange={(event) => editar({ oilType: event.target.value })}
              >
                <option value="">Selecione...</option>
                {OIL_TYPES.map((oil) => (
                  <option key={oil}>{oil}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Marca/viscosidade">
              <input
                aria-label="Marca/viscosidade"
                value={String(item.oilBrandViscosity || '')}
                onChange={(event) =>
                  editar({ oilBrandViscosity: event.target.value })
                }
              />
            </Campo>
          </>
        ) : (
          <Campo label="Quantidade">
            <input
              type="number"
              aria-label="Quantidade"
              min={0}
              step={1}
              value={Number(item.quantity) || ''}
              onChange={numero('quantity')}
            />
          </Campo>
        )}
        {tipo === 'pipes' ? (
          <MedidasDoTubo
            item={item}
            editar={editar}
            erroDiametro={erro('internalDiameterMm')}
          />
        ) : (
          <Campo label="Volume (L)">
            <input
              type="number"
              aria-label="Volume em litros"
              min={0}
              step={0.01}
              value={Number(item.volumeLiters) || ''}
              onChange={numero('volumeLiters')}
            />
          </Campo>
        )}
      </div>
      {item.included === false && (
        <p className="field-hint">
          Este item estava excluído do cálculo no rascunho anterior.{' '}
          <button
            type="button"
            className="com-btn"
            onClick={() => editar({ included: true })}
          >
            Restaurar no cálculo
          </button>
        </p>
      )}
      <fieldset
        className={`com-dimension-services${erro('serviceIds') ? ' com-campo-invalido' : ''}`}
      >
        <legend>Serviços deste sistema</legend>
        <div className="com-dimension-service-list">
          {servicos.map((serviceId, index) => (
            <div key={index} className="com-dimension-service-row">
              <select
                aria-label={`Serviço ${index + 1} do sistema`}
                value={serviceId}
                aria-invalid={Boolean(erro('serviceIds')) || undefined}
                onChange={(event) =>
                  editar({
                    serviceIds: servicos.map((id, position) =>
                      position === index ? event.target.value : id
                    )
                  })
                }
              >
                <option value="">Selecione o serviço...</option>
                {serviceId &&
                  !catalogo.some((service) => service.id === serviceId) && (
                    <option value={serviceId}>
                      Serviço incompatível — selecione outro
                    </option>
                  )}
                {catalogo.map((service) => (
                  <option
                    key={service.id}
                    value={service.id}
                    disabled={
                      service.id !== serviceId && servicos.includes(service.id)
                    }
                  >
                    {service.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="com-remover"
                aria-label={`Remover serviço ${index + 1}`}
                onClick={() =>
                  editar({
                    serviceIds: servicos.filter(
                      (_, position) => position !== index
                    )
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="com-btn-add"
          aria-invalid={
            Boolean(erro('serviceIds') && !servicos.length) || undefined
          }
          disabled={servicos.length >= catalogo.length}
          onClick={() => editar({ serviceIds: [...servicos, ''] })}
        >
          + Adicionar serviço ao sistema
        </button>
        {erro('serviceIds') && (
          <small className="field-error">{erro('serviceIds')}</small>
        )}
      </fieldset>
      <button
        type="button"
        className="com-btn com-btn-perigo"
        onClick={remover}
      >
        Remover sistema
      </button>
    </article>
  );
}

function MedidasDoTubo({
  item,
  editar,
  erroDiametro
}: {
  item: AnyRecord;
  editar: (patch: AnyRecord) => void;
  erroDiametro?: string;
}) {
  const lengthUnit = String(item.lengthUnit || 'm') as UnidadeDeComprimento;
  const diameterUnit = String(
    item.diameterUnit ||
      (numberValue(item.internalDiameterMm) > 0 ? 'mm' : 'in')
  ) as UnidadeDeDiametro;
  const diameterLabel = commonInchDiameterLabel(
    diametroParaExibicao(Number(item.internalDiameterMm) || 0, 'in')
  );
  return (
    <>
      <Campo label="Comprimento">
        <div className="com-medida-com-unidade">
          <input
            type="number"
            aria-label="Comprimento"
            min={0}
            step={lengthUnit === 'm' ? 0.01 : 1}
            value={
              comprimentoParaExibicao(Number(item.lengthM) || 0, lengthUnit) ||
              ''
            }
            onChange={(event) =>
              editar({
                lengthM: comprimentoEmMetros(
                  Number(event.target.value) || 0,
                  lengthUnit
                )
              })
            }
          />
          <select
            aria-label="Unidade do comprimento"
            value={lengthUnit}
            onChange={(event) => editar({ lengthUnit: event.target.value })}
          >
            <option value="m">m</option>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
          </select>
        </div>
      </Campo>
      <Campo label="Ø interno" error={erroDiametro}>
        <div className="com-medida-com-unidade">
          {diameterUnit === 'in' ? (
            <select
              className="com-medida-valor"
              aria-label="Diâmetro interno em polegadas"
              aria-invalid={Boolean(erroDiametro) || undefined}
              value={diameterLabel}
              onChange={(event) =>
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
              {COMMON_INCH_DIAMETERS.map((diameter) => (
                <option key={diameter}>{diameter}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              aria-label="Diâmetro interno em milímetros"
              aria-invalid={Boolean(erroDiametro) || undefined}
              min={0}
              step={0.1}
              value={Number(item.internalDiameterMm) || ''}
              onChange={(event) =>
                editar({ internalDiameterMm: Number(event.target.value) || 0 })
              }
            />
          )}
          <select
            aria-label="Unidade do diâmetro"
            value={diameterUnit}
            onChange={(event) =>
              editar({
                diameterUnit: event.target.value,
                ...(event.target.value === 'in' && !diameterLabel
                  ? { internalDiameterMm: 0 }
                  : {})
              })
            }
          >
            <option value="in">pol.</option>
            <option value="mm">mm</option>
          </select>
        </div>
      </Campo>
      <Campo label="Preenchimento (%)">
        <input
          type="number"
          aria-label="Percentual de preenchimento"
          min={0}
          max={100}
          step={1}
          value={Number(item.fillPercent) || ''}
          onChange={(event) =>
            editar({ fillPercent: Number(event.target.value) || 0 })
          }
        />
      </Campo>
    </>
  );
}
