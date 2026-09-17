import type { ChemicalVolumeResult } from '../../../../../../shared/comercial/dist/chemical-cleaning.js';
import { SYSTEM_MATERIALS } from '../../../../../../shared/comercial/dist/dimensioning.js';
import { number } from '../formato';

export function VolumeQuimicoResumo({
  volumes = []
}: {
  volumes?: ChemicalVolumeResult[];
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
        para cima). O volume inclui a tubulação, o reservatório da bomba e suas
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
                  {volume.groups.map((group) => (
                    <tr key={`${group.material}:${group.pumpId}`}>
                      <td>
                        {
                          SYSTEM_MATERIALS.find(
                            (material) => material.value === group.material
                          )?.label
                        }
                      </td>
                      <td>{number(group.reservoirLitersPerSystem)} L</td>
                      <td>{number(group.lengthM)} m</td>
                      <td>{group.systemCount}</td>
                      <td>{number(group.pipeVolumeLiters)}</td>
                      <td>{number(group.reservoirVolumeLiters)}</td>
                      <td>{number(group.hoseVolumeLiters)}</td>
                      <td>{number(group.totalVolumeLiters)}</td>
                    </tr>
                  ))}
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
