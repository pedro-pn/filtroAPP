import { MoneyInput } from '../../components/Field';
import { HOTEL_SITE_COMMUTE_EXPENSE_CODE } from '../../../../../../shared/comercial/dist/cost-model.js';
import { money, numberValue } from '../formato';
import type { Levantamento } from '../useLevantamento';

/**
 * Despesas contextuais de uma fase — hospedagem, alimentação, combustível.
 *
 * Porte de `context.expenses` (`app/custos/page.tsx:918-948`).
 *
 * **Esta tabela fecha um buraco que o app tinha até agora**: a seção acusava
 * "o combustível do deslocamento hotel ↔ obra é obrigatório nas fases em
 * viagem" e não havia onde resolver. O usuário via a pendência, ia até a
 * seção e não achava o campo — que é a pior forma de guiar alguém.
 *
 * A base de cálculo é o que torna a despesa proporcional ao que a fase é:
 * "por pessoa-dia trabalhado" cresce com a equipe e com a duração, "fixo"
 * não. Errar a base produz custo plausível e errado.
 */

type AnyRecord = Record<string, unknown>;

const BASES = [
  { value: 'fixed', label: 'Fixo / evento' },
  { value: 'per_person', label: 'Por pessoa' },
  { value: 'per_person_day', label: 'Por pessoa-dia trabalhado' },
  { value: 'per_person_calendar_day', label: 'Por pessoa × dia corrido' },
  { value: 'per_person_workday', label: 'Por pessoa × dia útil' },
  { value: 'per_person_month', label: 'Por pessoa-mês' },
  { value: 'per_vehicle_calendar_day', label: 'Por veículo × dia corrido' },
  { value: 'per_vehicle_workday', label: 'Por veículo × dia útil' },
  { value: 'per_context_day', label: 'Por dia da fase' },
  { value: 'per_context_month', label: 'Por mês da fase' },
  { value: 'percent_labor', label: '% da mão de obra' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function novaDespesa(): AnyRecord {
  return {
    id: `despesa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Nova despesa',
    basis: 'fixed',
    quantity: 1,
    unitValue: 0,
    included: true
  };
}

export function encontrarDespesaCalculada(
  calculadas: AnyRecord[],
  despesa: AnyRecord
): AnyRecord {
  const id = String(despesa.id || '');
  const code = String(despesa.code || '');
  return (
    calculadas.find(calculada =>
      (id && String(calculada.id || '') === id) ||
      (code && String(calculada.code || '') === code)
    ) || {}
  );
}

export function DespesasFase({
  fase,
  levantamento,
  caminho = 'laborContexts[0]'
}: {
  fase: AnyRecord;
  levantamento: Levantamento;
  caminho?: string;
}) {
  const { updateNested, removeNested, addNested, resultadoDaFase, erroDe } = levantamento;
  const erroDespesas = erroDe(`${caminho}.expenses`);
  const faseId = String(fase.id);
  const resumo = resultadoDaFase(faseId);
  const despesas = registros(fase.expenses);
  const calculadas = registros(resumo.expenses);
  const emViagem = fase.workCondition === 'travel';

  function editar(id: string, patch: AnyRecord) {
    updateNested('laborContexts', faseId, 'expenses', id, patch);
  }

  return (
    <section className="com-fase-painel">
      <header>
        <strong>Despesas da fase</strong>
        <small>
          Hospedagem, alimentação, combustível e o que mais a fase consumir. A base define
          como a despesa cresce.
        </small>
      </header>
      {erroDespesas && <p id={`${faseId}-despesas-erro`} className="field-error">{erroDespesas}</p>}

      {despesas.length > 0 ? (
        <div className="com-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Despesa</th>
                <th scope="col">Base de cálculo</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Valor unitário</th>
                <th scope="col">Incluir</th>
                <th scope="col">Total</th>
                <th scope="col">
                  <span className="com-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {despesas.map(despesa => {
                const id = String(despesa.id);
                const calculada = encontrarDespesaCalculada(calculadas, despesa);

                /**
                 * O combustível hotel ↔ obra é gerido pela própria fase: a
                 * quantidade sai da distância e dos dias, e a base é fixa.
                 * Deixar editável abriria caminho para o número da tela
                 * divergir do que o motor calcula.
                 */
                const combustivelDoTrajeto = despesa.code === HOTEL_SITE_COMMUTE_EXPENSE_CODE;

                return (
                  <tr key={id} className={combustivelDoTrajeto ? 'com-linha-fixa' : undefined}>
                    <td>
                      <input
                        aria-label="Nome da despesa"
                        value={String(despesa.name || '')}
                        disabled={combustivelDoTrajeto}
                        onChange={event => editar(id, { name: event.target.value })}
                      />
                    </td>

                    <td>
                      {combustivelDoTrajeto ? (
                        <span className="com-nota">Calculado pela fase</span>
                      ) : (
                        <select
                          aria-label="Base de cálculo"
                          value={String(despesa.basis || 'fixed')}
                          onChange={event => editar(id, { basis: event.target.value })}
                        >
                          {BASES.map(base => (
                            <option key={base.value} value={base.value}>
                              {base.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td>
                      <input
                        type="number"
                        aria-label="Quantidade"
                        value={Number(despesa.quantity) || ''}
                        min={0}
                        step={0.01}
                        disabled={combustivelDoTrajeto}
                        onChange={event =>
                          editar(id, {
                            quantity: event.target.value === '' ? 0 : Number(event.target.value)
                          })
                        }
                      />
                    </td>

                    <td>
                      <MoneyInput
                        aria-label="Valor unitário"
                        invalid={Boolean(combustivelDoTrajeto && erroDespesas)}
                        className={combustivelDoTrajeto && erroDespesas ? 'com-campo-invalido' : undefined}
                        aria-describedby={combustivelDoTrajeto && erroDespesas ? `${faseId}-despesas-erro` : undefined}
                        value={(despesa.unitValue as number) ?? ''}
                        /* O VALOR do combustível continua editável: o preço
                           varia, a fórmula não. */
                        onChange={valor =>
                          editar(id, {
                            unitValue: valor
                          })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="checkbox"
                        aria-label="Incluir no levantamento"
                        checked={combustivelDoTrajeto || despesa.included !== false}
                        /* Em fase de viagem esta despesa é obrigatória — a
                           pendência da seção cobra exatamente isso. */
                        disabled={combustivelDoTrajeto && emViagem}
                        onChange={event => editar(id, { included: event.target.checked })}
                      />
                    </td>

                    <td className="com-calculado">
                      {despesa.included === false ? '—' : money(numberValue(calculada.total))}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="com-remover"
                        aria-label={`Remover ${String(despesa.name || 'despesa')}`}
                        disabled={combustivelDoTrajeto && emViagem}
                        title={
                          combustivelDoTrajeto && emViagem
                            ? 'Despesa obrigatória para fases em viagem'
                            : 'Remover despesa'
                        }
                        onClick={() => removeNested('laborContexts', faseId, 'expenses', id)}
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
        <div className="com-vazio">Nenhuma despesa contextual nesta fase.</div>
      )}

      <button
        type="button"
        className="com-btn-add"
        onClick={() => addNested('laborContexts', faseId, 'expenses', novaDespesa())}
      >
        + Adicionar despesa da fase
      </button>
    </section>
  );
}
