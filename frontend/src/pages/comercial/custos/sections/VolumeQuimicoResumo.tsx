import { useState } from 'react';
import {
  CHEMICAL_PUMPS,
  type ChemicalPumpGroup,
  type ChemicalVolumeResult
} from '../../../../../../shared/comercial/dist/chemical-cleaning.js';
import type { ChemicalPumpChoice } from '../../../../../../shared/comercial/dist/cost-model.js';
import { SYSTEM_MATERIALS } from '../../../../../../shared/comercial/dist/dimensioning.js';
import { number } from '../formato';

/**
 * `bombas === undefined` devolve o circuito ao modo automático; uma lista (mesmo
 * vazia) liga o modo manual, em que só valem as bombas escolhidas.
 */
export type AlterarBombasQuimicas = (
  circuitoId: string,
  bombas: ChemicalPumpChoice[] | undefined
) => void;

const MATERIAIS_DE_BOMBA = SYSTEM_MATERIALS.filter(
  material => material.value !== 'other'
);

const rotuloDoMaterial = (valor: string) =>
  SYSTEM_MATERIALS.find(material => material.value === valor)?.label ?? valor;

/** Faixa de diâmetro em que o modo automático escolhe cada bomba. */
function faixaDaBomba(id: string) {
  if (id === '120') return 'tubos até 3″';
  if (id === '240') return 'tubos de 3″ a 8″';
  return 'tubos acima de 8″';
}

const novoId = () =>
  `bomba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const comoEscolha = (grupo: ChemicalPumpGroup): ChemicalPumpChoice => ({
  id: grupo.id ?? novoId(),
  material: grupo.material,
  pumpId: grupo.pumpId as ChemicalPumpChoice['pumpId'],
  quantity: grupo.systemCount
});

/**
 * Campo de texto local: apagar o número para digitar outro não pode mexer no
 * cálculo no meio da digitação. Só inteiros ≥ 1 são gravados.
 */
function QuantidadeInput({
  valor,
  rotulo,
  onChange
}: {
  valor: number;
  rotulo: string;
  onChange: (quantidade: number) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={999}
      step={1}
      aria-label={rotulo}
      value={texto ?? valor}
      onChange={event => {
        setTexto(event.target.value);
        const quantidade = Math.round(Number(event.target.value));
        if (event.target.value !== '' && quantidade >= 1) {
          onChange(Math.min(quantidade, 999));
        }
      }}
      onBlur={() => setTexto(null)}
    />
  );
}

function descricaoDasBombas(grupos: ChemicalPumpGroup[]) {
  if (!grupos.length) return 'nenhuma bomba';
  return grupos
    .map(
      grupo =>
        `${grupo.systemCount} × bomba ${number(grupo.reservoirLitersPerSystem)} L (${rotuloDoMaterial(grupo.material).toLowerCase()})`
    )
    .join(' + ');
}

export function VolumeQuimicoResumo({
  volumes = [],
  onAlterarBombas
}: {
  volumes?: ChemicalVolumeResult[];
  onAlterarBombas?: AlterarBombasQuimicas;
}) {
  if (!volumes.length) return null;
  const total = volumes.reduce(
    (sum, volume) => sum + volume.totalVolumeLiters,
    0
  );
  return (
    <details className="com-volume-quimico">
      <summary>
        Volume para dosagem química: {number(total)} L — memória de cálculo LEC
      </summary>
      <p>
        Apenas sistemas com limpeza química. Por padrão, em cada circuito as
        tubulações são agrupadas por material e bomba, em sistemas de até 50 m
        (arredondados para cima). Se preferir, escolha as bombas de cada circuito
        manualmente. O volume inclui a tubulação, o reservatório da bomba e suas
        mangueiras.
      </p>
      {volumes.map(volume => {
        const manual = volume.mode === 'manual';
        const editar = (bombas: ChemicalPumpChoice[]) =>
          onAlterarBombas?.(volume.id, bombas);
        const escolhas = volume.groups.map(comoEscolha);
        const nome = volume.name || 'Circuito sem nome';
        return (
          <section key={volume.id} aria-label={`Volume químico de ${nome}`}>
            <h3>{nome}</h3>

            {onAlterarBombas && (
              <p className="com-volume-quimico-modo">
                <strong>
                  Bombas: {manual ? 'escolhidas manualmente' : 'automático (LEC)'}
                </strong>{' '}
                {manual ? (
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    onClick={() => onAlterarBombas(volume.id, undefined)}
                  >
                    Voltar ao automático
                  </button>
                ) : (
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    onClick={() => onAlterarBombas(volume.id, escolhas)}
                  >
                    Escolher bombas manualmente
                  </button>
                )}
              </p>
            )}

            {manual && (
              <p className="com-nota">
                Tubulação considerada: {number(volume.pipeLengthM)} m ={' '}
                {number(volume.pipeVolumeLiters)} L. Sugestão automática:{' '}
                {descricaoDasBombas(volume.autoGroups ?? [])}.
              </p>
            )}

            {manual ? (
              <div className="com-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Bomba</th>
                      <th>Quantidade</th>
                      <th>Reservatórios (L)</th>
                      <th>Mangueiras (L)</th>
                      <th>Total (L)</th>
                      <th>
                        <span className="com-sr">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {volume.groups.map((grupo, indice) => {
                      const rotulo = `${nome} — bomba ${indice + 1}`;
                      const trocar = (patch: Partial<ChemicalPumpChoice>) =>
                        editar(
                          escolhas.map((item, posicao) =>
                            posicao === indice ? { ...item, ...patch } : item
                          )
                        );
                      return (
                        <tr key={grupo.id ?? indice}>
                          <td>
                            <select
                              aria-label={`Material da ${rotulo}`}
                              value={grupo.material}
                              onChange={event =>
                                trocar({
                                  material: event.target
                                    .value as ChemicalPumpChoice['material']
                                })
                              }
                            >
                              {MATERIAIS_DE_BOMBA.map(material => (
                                <option
                                  key={material.value}
                                  value={material.value}
                                >
                                  {material.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label={`Tipo da ${rotulo}`}
                              value={grupo.pumpId}
                              onChange={event =>
                                trocar({
                                  pumpId: event.target
                                    .value as ChemicalPumpChoice['pumpId']
                                })
                              }
                            >
                              {CHEMICAL_PUMPS.map(bomba => (
                                <option key={bomba.id} value={bomba.id}>
                                  {bomba.reservoirLiters} L —{' '}
                                  {faixaDaBomba(bomba.id)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <QuantidadeInput
                              valor={grupo.systemCount}
                              rotulo={`Quantidade da ${rotulo}`}
                              onChange={quantidade => trocar({ quantity: quantidade })}
                            />
                          </td>
                          <td>{number(grupo.reservoirVolumeLiters)}</td>
                          <td>{number(grupo.hoseVolumeLiters)}</td>
                          <td>{number(grupo.totalVolumeLiters)}</td>
                          <td>
                            <button
                              type="button"
                              className="com-remover"
                              aria-label={`Remover ${rotulo}`}
                              onClick={() =>
                                editar(
                                  escolhas.filter(
                                    (_item, posicao) => posicao !== indice
                                  )
                                )
                              }
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
              volume.groups.length > 0 && (
                <div className="com-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Bomba / reservatório</th>
                        <th>Comprimento</th>
                        <th>Sistemas ≤ 50 m</th>
                        <th>Tubulação (L)</th>
                        <th>Reservatórios das bombas (L)</th>
                        <th>Mangueiras (L)</th>
                        <th>Total por ciclo (L)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volume.groups.map(grupo => (
                        <tr key={`${grupo.material}:${grupo.pumpId}`}>
                          <td>{rotuloDoMaterial(grupo.material)}</td>
                          <td>{number(grupo.reservoirLitersPerSystem)} L</td>
                          <td>{number(grupo.lengthM)} m</td>
                          <td>{grupo.systemCount}</td>
                          <td>{number(grupo.pipeVolumeLiters)}</td>
                          <td>{number(grupo.reservoirVolumeLiters)}</td>
                          <td>{number(grupo.hoseVolumeLiters)}</td>
                          <td>{number(grupo.totalVolumeLiters)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {manual && onAlterarBombas && (
              <button
                type="button"
                className="com-btn-add"
                onClick={() =>
                  editar([
                    ...escolhas,
                    {
                      id: novoId(),
                      material: volume.autoGroups?.[0]?.material ?? 'carbon_steel',
                      pumpId:
                        (volume.autoGroups?.[0]?.pumpId as
                          | ChemicalPumpChoice['pumpId']
                          | undefined) ?? '240',
                      quantity: 1
                    }
                  ])
                }
              >
                + Adicionar bomba
              </button>
            )}
            {manual && volume.groups.length === 0 && (
              <p className="com-nota-aviso">
                Nenhuma bomba escolhida: o volume considera apenas a tubulação
                e os outros sistemas.
              </p>
            )}

            <p>
              Outros sistemas com limpeza química:{' '}
              {number(volume.otherVolumeLiters)} L.
            </p>
            <p>
              <strong>
                {number(volume.physicalVolumeLiters)} L ×{' '}
                {number(volume.cycles)} ciclo(s)
                {' = '}
                {number(volume.totalVolumeLiters)} L para dosagem.
              </strong>
            </p>
          </section>
        );
      })}
      <small>
        O volume da tubulação usa π = 3,14, conforme a LEC v1.3. O volume
        geométrico do circuito permanece separado.
      </small>
    </details>
  );
}
