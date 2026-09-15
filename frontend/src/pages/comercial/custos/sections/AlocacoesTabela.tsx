import { MoneyInput } from '../../components/Field';
import {
  LEC_LABOR_ROLES,
  roleSalary
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { money, number, numberValue } from '../formato';
import { aplicarJornadaATodaEquipe } from '../jornadas';
import type { Levantamento } from '../useLevantamento';
import { JornadaCard } from './JornadaCard';

/**
 * Tabela de alocações de uma fase — o coração do custo de mão de obra.
 *
 * Porte de `context.assignments.map(...)` (`app/custos/page.tsx:789-856`).
 *
 * Cada linha é um cargo alocado à fase, com quantidade de pessoas, salário
 * base, adicional e percentual de alocação. O custo sai do LEC v1.2, não de
 * conta feita aqui: o motor calcula e esta tabela mostra.
 *
 * **Trocar o cargo repõe o salário oficial do LEC.** É deliberado na
 * referência e importa: o salário é editável para casos excepcionais, mas
 * mudar de cargo sem repor deixaria o salário do cargo anterior colado no
 * novo — e o custo sairia plausível e errado, que é o pior modo de falhar
 * nesta tela.
 */

type AnyRecord = Record<string, unknown>;

const TURNOS = [
  { value: 'day', label: 'Diurno' },
  { value: 'night', label: 'Noturno' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function novaAlocacao(): AnyRecord {
  const primeiro = (LEC_LABOR_ROLES as AnyRecord[])[0];
  const cargo = String(primeiro.role);
  return {
    id: `cargo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: cargo,
    quantity: 1,
    monthlySalary: roleSalary(cargo),
    adjustment: 0,
    allocationPercent: 100,
    shift: 'day',
    nightPremiumPercent: 35
  };
}

export function AlocacoesTabela({
  fase,
  levantamento,
  caminho = 'laborContexts[0]'
}: {
  fase: AnyRecord;
  levantamento: Levantamento;
  caminho?: string;
}) {
  const {
    updateCollection,
    updateNested,
    removeNested,
    addNested,
    resultadoDaFase,
    erroSe,
    erroDe
  } = levantamento;
  const faseId = String(fase.id);
  const resumo = resultadoDaFase(faseId);
  const alocacoes = registros(fase.assignments);
  const calculados = registros(resumo.assignments);

  function editar(id: string, patch: AnyRecord) {
    updateNested('laborContexts', faseId, 'assignments', id, patch);
  }

  return (
    <section className="com-fase-painel">
      <header>
        <strong>Equipe alocada</strong>
        <small>
          Cargos e composição salarial do LEC v1.2. O salário é editável para casos
          excepcionais.
        </small>
      </header>

      {alocacoes.length > 0 ? (
        <div className="com-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  Cargo<span className="survey-required-marker">*</span>
                </th>
                <th scope="col">Turno</th>
                <th scope="col">
                  Pessoas<span className="survey-required-marker">*</span>
                </th>
                <th scope="col">Salário base</th>
                <th scope="col">Adicional</th>
                <th scope="col">
                  Alocação (%)<span className="survey-required-marker">*</span>
                </th>
                <th scope="col">HH</th>
                <th scope="col">Custo</th>
                <th scope="col">
                  <span className="com-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {alocacoes.map((alocacao, indice) => {
                const id = String(alocacao.id);
                const calculado = calculados.find(item => item.id === id) || {};
                const erroCargo = erroDe(`${caminho}.assignments[${indice}].role`);
                const erroQuantidade = erroDe(`${caminho}.assignments[${indice}].quantity`);

                return (
                  <tr key={id}>
                    <td>
                      <select
                        aria-label="Cargo"
                        aria-invalid={Boolean(erroCargo) || undefined}
                        aria-describedby={erroCargo ? `${id}-cargo-erro` : undefined}
                        className={erroCargo ? 'com-campo-invalido' : undefined}
                        value={String(alocacao.role || '')}
                        onChange={event => {
                          const cargo = event.target.value;
                          // Repõe o salário oficial ao trocar de cargo — ver
                          // o comentário no topo do arquivo.
                          editar(id, { role: cargo, monthlySalary: roleSalary(cargo) });
                        }}
                      >
                        <option value="">Selecione o cargo...</option>
                        {(LEC_LABOR_ROLES as AnyRecord[]).map(cargo => (
                          <option key={String(cargo.role)} value={String(cargo.role)}>
                            {String(cargo.role)}
                          </option>
                        ))}
                      </select>
                      {erroCargo && <small id={`${id}-cargo-erro`} className="field-error">{erroCargo}</small>}
                    </td>

                    <td>
                      <select
                        aria-label="Turno"
                        value={String(alocacao.shift || 'day')}
                        onChange={event => editar(id, { shift: event.target.value })}
                      >
                        {TURNOS.map(turno => (
                          <option key={turno.value} value={turno.value}>
                            {turno.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Quantidade de pessoas"
                        aria-invalid={Boolean(erroQuantidade) || undefined}
                        aria-describedby={erroQuantidade ? `${id}-quantidade-erro` : undefined}
                        className={erroQuantidade ? 'com-campo-invalido' : undefined}
                        value={Number(alocacao.quantity) || ''}
                        min={0}
                        onChange={event =>
                          editar(id, {
                            quantity: event.target.value === '' ? 0 : Number(event.target.value)
                          })
                        }
                      />
                      {erroQuantidade && <small id={`${id}-quantidade-erro`} className="field-error">{erroQuantidade}</small>}
                    </td>

                    <td>
                      <MoneyInput
                        aria-label="Salário base"
                        value={(alocacao.monthlySalary as number) ?? ''}
                        onChange={valor =>
                          editar(id, {
                            monthlySalary:
                              valor
                          })
                        }
                      />
                    </td>

                    <td>
                      <MoneyInput
                        aria-label="Adicional"
                        value={alocacao.adjustment}
                        onChange={valor => editar(id, { adjustment: valor })}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Percentual de alocação"
                        value={Number(alocacao.allocationPercent) || ''}
                        min={0}
                        max={100}
                        step={1}
                        onChange={event =>
                          editar(id, {
                            allocationPercent:
                              event.target.value === '' ? 0 : Number(event.target.value)
                          })
                        }
                      />
                    </td>

                    <td className="com-calculado">
                      {number(numberValue(calculado.totalHours))}
                    </td>
                    <td className="com-calculado">
                      <strong>{money(numberValue(calculado.total))}</strong>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover ${String(alocacao.role || 'alocação')}`}
                        onClick={() => removeNested('laborContexts', faseId, 'assignments', id)}
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
        <div className="com-vazio">Nenhum cargo alocado nesta fase.</div>
      )}

      {alocacoes.length > 0 && (
        <section className="com-jornadas">
          <header>
            <strong>Cenários de jornada</strong>
            <small>
              Abra um cargo para definir dias, horas normais e extras, turno e percentual
              da HE. Para jornadas individuais, use uma linha por colaborador.
            </small>
          </header>
          <div className="com-jornadas-lista">
            {alocacoes.map((alocacao, indice) => {
              const id = String(alocacao.id);
              const calculado = calculados.find(item => item.id === id) || {};
              return (
                <JornadaCard
                  key={id}
                  alocacao={alocacao}
                  fase={fase}
                  calculado={calculado}
                  erroSe={erroSe}
                  erroDe={campo => erroDe(`${caminho}.assignments[${indice}].workSchedule.${campo}`)}
                  onEditar={patch => editar(id, patch)}
                  onAplicarATodaEquipe={(jornada, turno) =>
                    updateCollection('laborContexts', faseId, {
                      assignments: aplicarJornadaATodaEquipe(alocacoes, jornada, turno)
                    })
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      <button
        type="button"
        className="com-btn-add"
        onClick={() => addNested('laborContexts', faseId, 'assignments', novaAlocacao())}
      >
        + Adicionar cargo ou colaborador
      </button>
    </section>
  );
}
