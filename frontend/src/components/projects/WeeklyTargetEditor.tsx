import { WEEKLY_TARGET_METRICS, WEEKLY_TARGET_SERVICES, WEEKLY_TARGET_WORKDAYS, weeklyTargetUnit, weeklyTargetGoalMetric, type WeeklyTargetMetric, type WeeklyTargetBasis, type WeeklyTargetService, type WeeklyTargetCondition } from '../../../../shared/modules/mission-weekly-progress.js';
import { Button, Field, Input, Select } from '../ui/ds';

import { newScenario, onlyFilteringGoals, type ScenarioDraft, type TargetDraft } from './weeklyTargetDraft';

const serviceOptions = Object.entries(WEEKLY_TARGET_SERVICES).map(([value, label]) => ({ value, label }));

export function WeeklyTargetEditor({ id, draft, disabled, onChange }: {
  id: string; draft: TargetDraft; disabled: boolean; onChange: (draft: TargetDraft) => void;
}) {
  const isAttendance = draft.metric === 'COLLABORATORS';
  const update = (index: number, scenario: ScenarioDraft) => onChange({ ...draft, scenarios: draft.scenarios.map((item, i) => i === index ? scenario : item) });
  const toggleService = (index: number, serviceType: WeeklyTargetService, checked: boolean) => {
    const scenario = draft.scenarios[index];
    if (scenario.condition.kind !== 'SERVICE_SET') return;
    const serviceTypes = checked ? [...scenario.condition.serviceTypes, serviceType] : scenario.condition.serviceTypes.filter(type => type !== serviceType);
    const goals = scenario.distribution === 'GLOBAL' ? scenario.goals : serviceTypes.map(type => scenario.goals.find(goal => goal.serviceType === type) ?? { serviceType: type, value: '' });
    update(index, { ...scenario, condition: { kind: 'SERVICE_SET', serviceTypes }, goals });
  };
  return <>
    <Field id={`${id}-metric`} label="Medida da meta" required helperText={isAttendance ? 'Quantidade mínima de colaboradores presentes em cada dia de trabalho, conforme a equipe do RDO.' : draft.metric !== 'PCT_POINTS' ? 'Filtragem usa volume em litros. Nas metas por serviço, cada resultado mantém sua unidade.' : undefined}><Select value={onlyFilteringGoals(draft) ? 'L' : draft.metric} disabled={disabled} options={Object.entries(WEEKLY_TARGET_METRICS).map(([value, label]) => ({ value, label }))} onChange={event => {
      const metric = event.target.value as WeeklyTargetMetric;
      onChange({ ...draft, metric, basis: metric === 'COLLABORATORS' ? 'PER_WORKDAY' : metric === 'PCT_POINTS' || draft.basis === 'PER_WORKDAY' ? 'WEEK_TOTAL' : draft.basis, scenarios: [newScenario()] });
    }} /></Field>
    {isAttendance ? <fieldset className="mission-weekly-service-options mission-weekly-workdays" disabled={disabled}>
      <legend>Dias de trabalho desta semana</legend>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day}><input type="checkbox" checked={draft.workdays.includes(day)}
        onChange={event => onChange({ ...draft, workdays: event.target.checked ? [...draft.workdays, day] : draft.workdays.filter(value => value !== day) })} />{WEEKLY_TARGET_WORKDAYS[day]}</label>)}
      <p className="mission-weekly-progress-hint">Selecione os dias previstos no contrato. Desmarque folgas e feriados sem trabalho; inclua fins de semana quando houver trabalho.</p>
    </fieldset> : null}
    {draft.metric !== 'PCT_POINTS' && !isAttendance ? <Field id={`${id}-basis`} label="Base de cálculo" required><Select value={draft.basis} disabled={disabled} options={[
      { value: 'WEEK_TOTAL', label: 'Quantidade total na semana' },
      { value: 'PER_PRODUCTIVE_DAY', label: 'Por colaborador produtivo / dia' }
    ]} onChange={event => onChange({ ...draft, basis: event.target.value as WeeklyTargetBasis })} /></Field> : null}
    {draft.basis === 'PER_PRODUCTIVE_DAY' ? <Field id={`${id}-reference-hours`} label="Horas de um dia produtivo" required helperText="Preenchido com a jornada semanal do projeto, inclusive para metas com fins de semana. Você pode editar este valor; ele será salvo na meta. Ex.: 4 horas de serviço com referência de 8 horas = 0,5 dia.">
      <Input type="number" min={0.01} max={24} step={0.01} required value={draft.referenceDayHours} onChange={event => onChange({ ...draft, referenceDayHours: event.target.value })} />
    </Field> : null}
    <div className="mission-weekly-scenarios">
      {draft.scenarios.map((scenario, index) => <fieldset key={index} className="mission-weekly-scenario" disabled={disabled}>
        <legend>{isAttendance ? 'Meta diária de colaboradores' : `Cenário ${index + 1}`}</legend>
        {draft.metric !== 'PCT_POINTS' && !isAttendance ? <>
          <Field id={`${id}-${index}-name`} label="Nome do cenário" required><Input value={scenario.name} maxLength={100} required onChange={event => update(index, { ...scenario, name: event.target.value })} /></Field>
          <Field id={`${id}-${index}-condition`} label="Quando aplicar" required><Select value={scenario.condition.kind} options={[
            { value: 'ALWAYS', label: 'Regra geral (quando não houver cenário específico)' },
            { value: 'SERVICE_COUNT', label: 'Quantidade de tipos de serviço na semana' },
            { value: 'SERVICE_SET', label: 'Combinação exata de tipos de serviço' }
          ]} onChange={event => {
            const kind = event.target.value as WeeklyTargetCondition['kind'];
            update(index, { ...scenario, condition: kind === 'SERVICE_COUNT' ? { kind, count: 1 } : kind === 'SERVICE_SET' ? { kind, serviceTypes: [] } : { kind },
              distribution: 'GLOBAL', goals: [{ serviceType: null, value: '' }] });
          }} /></Field>
          {scenario.condition.kind === 'SERVICE_COUNT' ? <Field id={`${id}-${index}-count`} label="Quantidade de tipos de serviço" required><Input type="number" min={1} max={4} step={1} required value={scenario.condition.count} onChange={event => update(index, { ...scenario, condition: { kind: 'SERVICE_COUNT', count: Number(event.target.value) } })} /></Field> : null}
          {scenario.condition.kind === 'SERVICE_SET' ? <div className="mission-weekly-service-options" role="group" aria-label={`Tipos de serviço do cenário ${index + 1}`}>
            <span>Aplicar somente quando estes tipos forem executados:</span>
            {serviceOptions.map(option => <label key={option.value}><input type="checkbox" checked={scenario.condition.kind === 'SERVICE_SET' && scenario.condition.serviceTypes.includes(option.value as WeeklyTargetService)} onChange={event => toggleService(index, option.value as WeeklyTargetService, event.target.checked)} />{option.label}</label>)}
          </div> : null}
          {scenario.condition.kind !== 'SERVICE_COUNT' ? <Field id={`${id}-${index}-scope`} label="Distribuição da meta" required><Select value={scenario.distribution} options={[
            { value: 'GLOBAL', label: 'Total geral da semana' }, { value: 'SERVICE', label: 'Valor individual por tipo de serviço' }
          ]} onChange={event => update(index, { ...scenario, distribution: event.target.value as ScenarioDraft['distribution'], goals: event.target.value === 'GLOBAL' ? [{ serviceType: null, value: '' }]
            : (scenario.condition.kind === 'SERVICE_SET' ? scenario.condition.serviceTypes : ['LIMPEZA_QUIMICA' as const]).map(serviceType => ({ serviceType, value: '' })) })} /></Field> : null}
        </> : null}
        {scenario.goals.map((goal, goalIndex) => {
          const metric = weeklyTargetGoalMetric(draft.metric, goal, scenario.condition);
          return <div className="mission-weekly-goal" key={goalIndex}>
          {goal.serviceType && scenario.condition.kind === 'ALWAYS' ? <Field id={`${id}-${index}-${goalIndex}-service`} label="Tipo de serviço" required><Select value={goal.serviceType} options={serviceOptions} onChange={event => update(index, { ...scenario, goals: scenario.goals.map((item, i) => i === goalIndex ? { ...item, serviceType: event.target.value as WeeklyTargetService } : item) })} /></Field> : null}
          <Field id={`${id}-${index}-${goalIndex}-value`} label={isAttendance ? 'Colaboradores previstos por dia' : draft.metric === 'PCT_POINTS' ? 'Avanço previsto para a semana (p.p.)'
            : `${goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType] : 'Total geral'} (${weeklyTargetUnit(metric)}${draft.basis === 'PER_PRODUCTIVE_DAY' ? '/colaborador produtivo/dia' : ''})`} required>
            <Input type="number" min={isAttendance ? 1 : 0} max={metric === 'PCT_POINTS' ? 100 : 999999999.99} step={isAttendance || (metric === 'UN' && draft.basis === 'WEEK_TOTAL') ? 1 : 0.01} inputMode={isAttendance ? 'numeric' : 'decimal'} required value={goal.value} onChange={event => update(index, { ...scenario, goals: scenario.goals.map((item, i) => i === goalIndex ? { ...item, value: event.target.value } : item) })} />
          </Field>
          {scenario.condition.kind === 'ALWAYS' && goal.serviceType && scenario.goals.length > 1 ? <Button type="button" size="sm" variant="secondary" onClick={() => update(index, { ...scenario, goals: scenario.goals.filter((_, i) => i !== goalIndex) })}>Remover serviço</Button> : null}
        </div>;
        })}
        {scenario.condition.kind === 'ALWAYS' && scenario.goals[0]?.serviceType && scenario.goals.length < 4 ? <Button type="button" size="sm" variant="secondary" onClick={() => {
          const type = serviceOptions.find(option => !scenario.goals.some(goal => goal.serviceType === option.value))!.value as WeeklyTargetService;
          update(index, { ...scenario, goals: [...scenario.goals, { serviceType: type, value: '' }] });
        }}>Adicionar serviço</Button> : null}
        {draft.scenarios.length > 1 ? <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ ...draft, scenarios: draft.scenarios.filter((_, i) => i !== index) })}>Remover cenário {index + 1}</Button> : null}
      </fieldset>)}
      {isAttendance ? <p className="mission-weekly-progress-hint">Cada dia precisa atingir a quantidade contratada. O saldo acumulado soma excedentes e faltas. A equipe do RDO é contada uma vez por colaborador/dia, incluindo o turno noturno.</p> : null}
      {draft.metric !== 'PCT_POINTS' && !isAttendance ? <>
        <p className="mission-weekly-progress-hint">Exemplo: 300 m com 1 tipo de serviço; com limpeza química + teste de pressão, 100 m para cada. A combinação exata prevalece sobre a quantidade de tipos e a regra geral.</p>
        {draft.basis === 'PER_PRODUCTIVE_DAY' ? <p className="mission-weekly-progress-hint">Equipe e tempo produtivo vêm automaticamente dos RDOs, por serviço. Meta = taxa × soma dos dias equivalentes de cada colaborador operacional. Intervalos e stand-by limitam as horas disponíveis; se as pausas não tiverem horários, o desconto necessário é proporcional entre serviços. Deslocamentos e períodos sem serviço não entram. Horários conflitantes ou dados incompletos pedem correção no RDO.</p> : null}
        <Button type="button" size="sm" variant="secondary" disabled={disabled || draft.scenarios.length >= 20} onClick={() => onChange({ ...draft, scenarios: [...draft.scenarios, { ...newScenario(), name: 'Novo cenário', condition: { kind: 'SERVICE_SET', serviceTypes: [] } }] })}>Adicionar cenário</Button>
      </> : null}
    </div>
  </>;
}
