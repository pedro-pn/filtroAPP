import { useState } from 'react';
import {
  chemicalGroupKey,
  type ChemicalPumpGroup,
  type ChemicalVolumeResult
} from '../../../../../../shared/comercial/dist/chemical-cleaning.js';
import { SYSTEM_MATERIALS } from '../../../../../../shared/comercial/dist/dimensioning.js';
import { number } from '../formato';

/**
 * `contagem === undefined` devolve o grupo ao automático (`ceil(comprimento / 50)`).
 */
export type AlterarSistemasQuimicos = (
  circuitoId: string,
  chave: string,
  contagem: number | undefined
) => void;

/**
 * Campo de texto local: apagar o número para digitar outro não pode devolver o
 * valor ao automático no meio da digitação. Só valores inteiros ≥ 1 são gravados.
 */
function SistemasInput({
  grupo,
  rotulo,
  onChange
}: {
  grupo: ChemicalPumpGroup;
  rotulo: string;
  onChange: (contagem: number) => void;
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
      value={texto ?? grupo.systemCount}
      onChange={event => {
        setTexto(event.target.value);
        const valor = Math.round(Number(event.target.value));
        if (event.target.value !== '' && valor >= 1) onChange(Math.min(valor, 999));
      }}
      onBlur={() => setTexto(null)}
    />
  );
}

export function VolumeQuimicoResumo({
  volumes = [],
  onAlterarSistemas
}: {
  volumes?: ChemicalVolumeResult[];
  onAlterarSistemas?: AlterarSistemasQuimicos;
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
        Apenas sistemas com limpeza química. Em cada circuito, as tubulações são
        agrupadas por material e bomba, em sistemas de até 50 m (arredondados
        para cima). O número de sistemas pode ser ajustado à mão em cada linha.
        O volume inclui a tubulação, o reservatório da bomba e suas
        mangueiras.
      </p>
      {volumes.map((volume) => (
        <section
          key={volume.id}
          aria-label={`Volume químico de ${volume.name}`}
        >
          <h3>{volume.name || 'Circuito sem nome'}</h3>
          {volume.groups.length > 0 && (
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
                  {volume.groups.map((group) => {
                    const chave = chemicalGroupKey(group.material, group.pumpId);
                    const rotulo = SYSTEM_MATERIALS.find(
                      (material) => material.value === group.material
                    )?.label;
                    return (
                    <tr key={chave}>
                      <td>{rotulo}</td>
                      <td>{number(group.reservoirLitersPerSystem)} L</td>
                      <td>{number(group.lengthM)} m</td>
                      <td>
                        {onAlterarSistemas ? (
                          <>
                            <SistemasInput
                              grupo={group}
                              rotulo={`Sistemas de ${volume.name || 'circuito'} — ${rotulo}, bomba ${group.reservoirLitersPerSystem} L`}
                              onChange={contagem =>
                                onAlterarSistemas(volume.id, chave, contagem)
                              }
                            />
                            {group.customized && (
                              <small className="com-nota">
                                automático: {group.autoSystemCount}{' '}
                                <button
                                  type="button"
                                  className="com-btn com-btn-fantasma"
                                  onClick={() =>
                                    onAlterarSistemas(volume.id, chave, undefined)
                                  }
                                >
                                  Restaurar
                                </button>
                              </small>
                            )}
                          </>
                        ) : (
                          group.systemCount
                        )}
                      </td>
                      <td>{number(group.pipeVolumeLiters)}</td>
                      <td>{number(group.reservoirVolumeLiters)}</td>
                      <td>{number(group.hoseVolumeLiters)}</td>
                      <td>{number(group.totalVolumeLiters)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Outros sistemas com limpeza química:{' '}
            {number(volume.otherVolumeLiters)} L.
          </p>
          <p>
            <strong>
              {number(volume.physicalVolumeLiters)} L × {number(volume.cycles)}{' '}
              ciclo(s)
              {' = '}
              {number(volume.totalVolumeLiters)} L para dosagem.
            </strong>
          </p>
        </section>
      ))}
      <small>
        O volume da tubulação usa π = 3,14, conforme a LEC v1.3. O volume
        geométrico do circuito permanece separado.
      </small>
    </details>
  );
}
