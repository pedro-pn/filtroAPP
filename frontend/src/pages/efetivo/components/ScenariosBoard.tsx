import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  applyPlanningScenario,
  comparePlanningScenario,
  createPlanningScenario,
  discardPlanningScenario,
  listPlanningJobRoles,
  listPlanningScenarios,
  savePlanningScenarioHire,
  type MissionScheduleStatus
} from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { MissionsBoard } from './MissionsBoard';
import { ScenarioComparison } from './ScenarioComparison';
import { ScenarioFormModal } from './ScenarioFormModal';

const statusLabel = {
  DRAFT: 'Rascunho',
  APPLIED: 'Aplicado',
  DISCARDED: 'Descartado',
  SUPERSEDED: 'Superado'
} as const;

export function ScenariosBoard({
  date,
  jobRoleId,
  selectedScenarioId,
  canManage,
  onScenarioSelect
}: {
  date: string;
  jobRoleId?: string;
  selectedScenarioId?: string;
  canManage: boolean;
  onScenarioSelect: (id?: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'apply' | 'discard' | null
  >(null);
  const [missionSearch, setMissionSearch] = useState('');
  const [missionStatus, setMissionStatus] = useState<
    MissionScheduleStatus | undefined
  >();
  const [hireRole, setHireRole] = useState('');
  const [hireQuantity, setHireQuantity] = useState(1);
  const [hireDate, setHireDate] = useState(date);
  const scenarios = useQuery({
    queryKey: ['efetivo-planning-scenarios'],
    queryFn: listPlanningScenarios
  });
  const roles = useQuery({
    queryKey: ['efetivo-planning-job-roles'],
    queryFn: listPlanningJobRoles
  });
  const selected = scenarios.data?.find(
    (item) => item.id === selectedScenarioId
  );
  const comparison = useQuery({
    queryKey: [
      'efetivo-scenario-comparison',
      selectedScenarioId,
      date,
      jobRoleId || 'all'
    ],
    queryFn: () =>
      comparePlanningScenario(selectedScenarioId!, date, jobRoleId),
    enabled: Boolean(selectedScenarioId)
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['efetivo-planning-scenarios']
      }),
      queryClient.invalidateQueries({
        queryKey: ['efetivo-scenario-comparison']
      }),
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-overview'] })
    ]);
  };
  const create = useMutation({
    mutationFn: createPlanningScenario,
    onSuccess: async (scenario) => {
      await refresh();
      onScenarioSelect(scenario.id);
      setCreateOpen(false);
      toast('Cenário criado.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const apply = useMutation({
    mutationFn: () => applyPlanningScenario(selectedScenarioId!),
    onSuccess: async (result) => {
      await refresh();
      setConfirmAction(null);
      toast(
        result.idempotentRetry
          ? 'Este cenário já havia sido aplicado.'
          : 'Cenário aplicado integralmente.',
        'success'
      );
    },
    onError: (error: Error) => {
      setConfirmAction(null);
      refresh();
      toast(error.message, 'error');
    }
  });
  const discard = useMutation({
    mutationFn: () => discardPlanningScenario(selectedScenarioId!),
    onSuccess: async () => {
      await refresh();
      setConfirmAction(null);
      toast('Cenário descartado sem alterar o oficial.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const hire = useMutation({
    mutationFn: () =>
      savePlanningScenarioHire(selectedScenarioId!, {
        jobRoleId: hireRole,
        quantity: hireQuantity,
        availableFrom: hireDate
      }),
    onSuccess: async () => {
      await refresh();
      toast('Contratação hipotética salva.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  return (
    <div className="efetivo-board" data-efetivo-scenarios>
      <section className="page-card efetivo-section-heading">
        <div>
          <h2>Simulações</h2>
          <p>
            Compare alternativas sem alterar o oficial até “Validar e aplicar”.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)}>Novo cenário</Button>
        ) : null}
      </section>
      {scenarios.isLoading ? (
        <section className="page-card placeholder-copy">
          Carregando cenários…
        </section>
      ) : (
        <div className="efetivo-scenario-grid">
          {(scenarios.data || []).map((scenario) => (
            <button
              type="button"
              className={`page-card efetivo-scenario-card ${scenario.id === selectedScenarioId ? 'selected' : ''}`}
              key={scenario.id}
              onClick={() => onScenarioSelect(scenario.id)}
            >
              <span
                className={`efetivo-status status-${scenario.status.toLocaleLowerCase('pt-BR')}`}
              >
                {statusLabel[scenario.status]}
              </span>
              <strong>{scenario.name}</strong>
              <small>
                {scenario.objective || 'Sem objetivo informado'} ·{' '}
                {scenario._count?.missions || 0} missões ·{' '}
                {scenario._count?.plannedHires || 0} contratações hipotéticas
              </small>
              <em>Criado em {displayDateOnly(scenario.createdAt.slice(0, 10))}</em>
            </button>
          ))}
        </div>
      )}
      {selected ? (
        <>
          <section className="page-card efetivo-scenario-actions">
            <div>
              <strong>{selected.name}</strong>
              <p>
                Base oficial revisão {selected.baseOfficialRevision} · criado em{' '}
                {displayDateOnly(selected.createdAt.slice(0, 10))}
              </p>
            </div>
            {canManage && selected.status === 'DRAFT' ? (
              <div className="efetivo-action-row">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmAction('discard')}
                >
                  Descartar
                </Button>
                <Button
                  onClick={() => setConfirmAction('apply')}
                  disabled={comparison.data?.isStale}
                >
                  Validar e aplicar
                </Button>
              </div>
            ) : null}
          </section>
          {selected.status === 'DRAFT' && canManage ? (
            <section className="page-card efetivo-hire-form">
              <div className="field-group">
                <label htmlFor="scenario-hire-role">Função</label>
                <select
                  id="scenario-hire-role"
                  value={hireRole}
                  onChange={(event) => setHireRole(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {(roles.data || [])
                    .filter((item) => item.isOperational)
                    .map((role) => (
                      <option value={role.id} key={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="scenario-hire-quantity">Quantidade</label>
                <input
                  id="scenario-hire-quantity"
                  type="number"
                  min="1"
                  value={hireQuantity}
                  onChange={(event) =>
                    setHireQuantity(Number(event.target.value))
                  }
                />
              </div>
              <div className="field-group">
                <label htmlFor="scenario-hire-date">Disponível em</label>
                <input
                  id="scenario-hire-date"
                  type="date"
                  value={hireDate}
                  onChange={(event) => setHireDate(event.target.value)}
                />
              </div>
              <Button
                disabled={!hireRole || !hireDate || hire.isPending}
                onClick={() => hire.mutate()}
              >
                Adicionar contratação
              </Button>
            </section>
          ) : null}
          {comparison.isLoading ? (
            <section className="page-card placeholder-copy">
              Comparando capacidade…
            </section>
          ) : comparison.data ? (
            <ScenarioComparison {...comparison.data} />
          ) : null}
          {selected.status === 'DRAFT' ? (
            <MissionsBoard
              canManage={canManage}
              planId={selected.id}
              status={missionStatus}
              search={missionSearch}
              onSearchChange={setMissionSearch}
              onStatusChange={setMissionStatus}
              onPlanningMutated={refresh}
            />
          ) : null}
        </>
      ) : (
        <section className="page-card placeholder-copy">
          Selecione um cenário para comparar e editar.
        </section>
      )}
      <ScenarioFormModal
        open={createOpen}
        saving={create.isPending}
        roles={roles.data || []}
        defaultAvailableFrom={date}
        onClose={() => setCreateOpen(false)}
        onSubmit={(payload) => create.mutate(payload)}
      />
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction === 'apply'
            ? 'Aplicar cenário ao oficial?'
            : 'Descartar cenário?'
        }
        description={
          confirmAction === 'apply'
            ? 'Todas as regras serão revalidadas e a troca ocorrerá em uma única transação.'
            : 'Nenhum dado oficial será alterado.'
        }
        highlight={selected?.name}
        confirmLabel={
          confirmAction === 'apply'
            ? apply.isPending
              ? 'Aplicando…'
              : 'Validar e aplicar'
            : discard.isPending
              ? 'Descartando…'
              : 'Descartar'
        }
        onConfirm={() => {
          if (confirmAction === 'apply') apply.mutate();
          else if (confirmAction === 'discard') discard.mutate();
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
