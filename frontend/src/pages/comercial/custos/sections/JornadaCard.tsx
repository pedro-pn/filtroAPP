import { Field, NumberField, SelectField } from '../../components/Field';
import { money, number, numberValue } from '../formato';
import {
  atualizarDiaDaJornada,
  jornadaDaAlocacao,
  resumoDaJornada,
  type DiaDaJornada,
  type JornadaDaEquipe,
  type TipoDeDiaDaJornada
} from '../jornadas';

type AnyRecord = Record<string, unknown>;

const ALVOS = [
  { value: 'role', label: 'Todo o cargo desta linha' },
  { value: 'collaborator', label: 'Um colaborador específico' }
];

const TURNOS = [
  { value: 'day', label: 'Diurno' },
  { value: 'night', label: 'Noturno' }
];

const ROTULOS: Record<TipoDeDiaDaJornada, string> = {
  weekday: 'Dias úteis',
  saturday: 'Sábados',
  sunday_holiday: 'Domingos e feriados'
};

export function JornadaCard({
  alocacao,
  fase,
  calculado,
  erroSe,
  erroDe = () => undefined,
  onEditar,
  onAplicarATodaEquipe
}: {
  alocacao: AnyRecord;
  fase: AnyRecord;
  calculado: AnyRecord;
  erroSe: (condicao: boolean, mensagem: string) => string | undefined;
  erroDe?: (campo: string) => string | undefined;
  onEditar: (patch: AnyRecord) => void;
  onAplicarATodaEquipe: (jornada: JornadaDaEquipe, turno: string) => void;
}) {
  const jornada = jornadaDaAlocacao(alocacao, fase);
  const resumo = resumoDaJornada(jornada);
  const alvoIndividual = jornada.targetType === 'collaborator';
  const nomeDoAlvo = alvoIndividual
    ? jornada.collaboratorName || 'Colaborador não identificado'
    : String(alocacao.role || 'Cargo');

  function salvarJornada(proxima: JornadaDaEquipe) {
    onEditar({ workSchedule: proxima });
  }

  function editarDia(
    dayType: TipoDeDiaDaJornada,
    patch: Partial<DiaDaJornada>
  ) {
    salvarJornada(atualizarDiaDaJornada(jornada, dayType, patch));
  }

  return (
    <details className="com-jornada-card">
      <summary>
        <span>
          <strong>{nomeDoAlvo}</strong>
          <small>{jornada.name}</small>
        </span>
        <span className="com-jornada-resumo">
          {number(resumo.dias)} dias · {number(resumo.horasNormais)} h normais ·{' '}
          {number(resumo.horasExtras)} h extras
        </span>
        <span className="com-jornada-resultado">
          {number(numberValue(calculado.laborHours))} HH ·{' '}
          {money(numberValue(calculado.total))}
        </span>
      </summary>

      <div className="com-jornada-corpo">
        <div className="com-form-grid">
          <Field
            label="Nome do cenário"
            value={jornada.name}
            placeholder="Ex.: Gerência 12 h"
            onChange={(value) => salvarJornada({ ...jornada, name: value })}
          />

          <SelectField
            label="Aplicar a"
            required
            value={jornada.targetType}
            options={ALVOS}
            onChange={(value) => {
              const individual = value === 'collaborator';
              onEditar({
                ...(individual ? { quantity: 1 } : {}),
                workSchedule: {
                  ...jornada,
                  targetType: individual ? 'collaborator' : 'role',
                  ...(individual
                    ? { collaboratorName: jornada.collaboratorName || '' }
                    : { collaboratorName: undefined })
                }
              });
            }}
          />

          {alvoIndividual && (
            <Field
              label="Colaborador"
              required
              value={jornada.collaboratorName || ''}
              placeholder="Nome do colaborador"
              error={
                erroDe('collaboratorName') ||
                erroSe(
                  !String(jornada.collaboratorName || '').trim(),
                  'Campo obrigatório'
                )
              }
              onChange={(value) =>
                salvarJornada({
                  ...jornada,
                  targetType: 'collaborator',
                  collaboratorName: value
                })
              }
            />
          )}

          <SelectField
            label="Turno"
            required
            value={String(alocacao.shift || 'day')}
            options={TURNOS}
            onChange={(value) => onEditar({ shift: value })}
          />
        </div>

        <div
          className={`com-jornada-dias${erroDe('days') ? ' field-invalid-panel' : ''}`}
          aria-invalid={Boolean(erroDe('days')) || undefined}
        >
          {erroDe('days') && <p className="field-error">{erroDe('days')}</p>}
          {jornada.days.map((dia) => {
            const diasSalvos = ((alocacao.workSchedule as AnyRecord)?.days ||
              []) as AnyRecord[];
            const indice = diasSalvos.findIndex(
              (item) => item.dayType === dia.dayType
            );
            const erro = (campo: string) => erroDe(`days[${indice}].${campo}`);
            return (
              <section key={dia.dayType} className="com-jornada-dia">
                <strong>{ROTULOS[dia.dayType]}</strong>
                <div className="com-form-grid">
                  <NumberField
                    label="Dias trabalhados"
                    error={erro('days')}
                    value={dia.days}
                    min={0}
                    step={1}
                    onChange={(value) =>
                      editarDia(dia.dayType, { days: value })
                    }
                  />
                  <NumberField
                    label="Horas normais / dia"
                    error={erro('normalHoursPerDay')}
                    value={dia.normalHoursPerDay}
                    min={0}
                    max={24}
                    step={0.5}
                    onChange={(value) =>
                      editarDia(dia.dayType, { normalHoursPerDay: value })
                    }
                  />
                  <NumberField
                    label="Horas extras / dia"
                    error={erro('extraHoursPerDay')}
                    value={dia.extraHoursPerDay}
                    min={0}
                    max={24}
                    step={0.5}
                    onChange={(value) =>
                      editarDia(dia.dayType, { extraHoursPerDay: value })
                    }
                  />
                  <NumberField
                    label="Percentual da HE (%)"
                    required={dia.extraHoursPerDay > 0}
                    value={dia.overtimePercent}
                    min={0}
                    max={300}
                    step={1}
                    error={
                      erro('overtimePercent') ||
                      erroSe(
                        dia.extraHoursPerDay > 0 && dia.overtimePercent <= 0,
                        'Informe o percentual da hora extra'
                      )
                    }
                    onChange={(value) =>
                      editarDia(dia.dayType, { overtimePercent: value })
                    }
                  />
                </div>
              </section>
            );
          })}
        </div>

        <div className="com-jornada-acoes">
          <small>
            Ao aplicar para toda a equipe, apenas dias, horas, percentuais e
            turno são copiados. Os cargos e nomes permanecem separados.
          </small>
          <button
            type="button"
            className="com-btn com-btn-fantasma"
            onClick={() =>
              onAplicarATodaEquipe(jornada, String(alocacao.shift || 'day'))
            }
          >
            Aplicar este horário para toda a equipe
          </button>
        </div>
      </div>
    </details>
  );
}
