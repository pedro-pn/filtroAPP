import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getUnallocatedDays,
  resolveUnallocatedDays,
  type UnallocatedBlock
} from '../../api/acompanhamentoPonto';
import { Button } from '../ui/Button';
import { useToast } from '../ui/ToastContext';
import { allocationReasonLabel, fmtDayDate, fmtHours } from './allocationReasons';

interface ProjectOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  historical?: boolean;
}

const MAX_VISIBLE_BLOCKS = 150;

function blockKey(block: UnallocatedBlock): string {
  return `${block.collaboratorId}:${block.days[0]?.date ?? ''}`;
}

function blockPeriod(block: UnallocatedBlock): string {
  const first = block.days[0]?.date;
  const last = block.days[block.days.length - 1]?.date;
  if (!first) return '—';
  return first === last ? fmtDayDate(first) : `${fmtDayDate(first)} a ${fmtDayDate(last)}`;
}

/*
 * Candidatos do bloco: projetos citados pela etiqueta, RDO, Efetivo ou pela própria decisão. Isso é
 * especialmente importante nas sobreposições do Efetivo, em que pode não existir etiqueta nem RDO
 * no dia para alimentar os dois primeiros grupos.
 */
function blockCandidates(block: UnallocatedBlock): Array<{ projectId: string; label: string; origin: string }> {
  const byProject = new Map<string, { projectId: string; label: string; origins: Set<string> }>();
  const add = (ref: { projectId: string; code: string | null }, origin: string, onlyWhenMissing = false) => {
    const existing = byProject.get(ref.projectId);
    if (onlyWhenMissing && existing) return;
    const entry = existing
      ?? { projectId: ref.projectId, label: ref.code ?? ref.projectId, origins: new Set<string>() };
    entry.origins.add(origin);
    byProject.set(ref.projectId, entry);
  };
  for (const day of block.days) {
    for (const ref of day.tagProjects) add(ref, 'etiqueta');
    for (const ref of day.rdoProjects) add(ref, 'RDO');
    for (const ref of day.effectiveProjects ?? []) add(ref, 'Efetivo');
    for (const ref of day.candidateProjects ?? []) add(ref, 'candidato', true);
  }
  return [...byProject.values()]
    .map(entry => ({ projectId: entry.projectId, label: entry.label, origin: [...entry.origins].join(' + ') }))
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
}

function projectOptionLabel(project: ProjectOption): string {
  const suffix = project.historical ? ' (histórico)' : project.isActive ? '' : ' (inativo)';
  return `${project.code} — ${project.name}${suffix}`;
}

// O backend aceita 200 dias por requisição; blocos longos vão em lotes.
function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function UnallocatedDaysPanel({ projects, enabled }: { projects: ProjectOption[]; enabled: boolean }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['ponto-dias-sem-alocacao', de, ate],
    queryFn: () => getUnallocatedDays({ de: de || undefined, ate: ate || undefined }),
    enabled
  });

  const resolveMutation = useMutation({
    mutationFn: async (items: Array<{ collaboratorId: string; date: string; projectIds: string[] }>) => {
      let updated = 0;
      for (const batch of chunk(items, 200)) {
        const result = await resolveUnallocatedDays({ items: batch });
        updated += result.updated;
      }
      return updated;
    },
    onSuccess: updated => {
      showToast(`${updated} dia(s) alocado(s).`, 'success');
      queryClient.invalidateQueries({ queryKey: ['ponto-dias-sem-alocacao'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-pendencias-contagem'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-auditoria-alocacao'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      showToast(error?.response?.data?.error || 'Não foi possível alocar os dias.', 'error');
    }
  });

  if (!enabled) return null;

  const blocks = data?.actionable ?? [];
  const totalDays = data?.counts.actionableDays ?? 0;
  const totalHours = data?.counts.actionableHours ?? 0;
  // O histórico inteiro chega a milhares de dias. Renderizar tudo de uma vez trava o navegador
  // sem ajudar ninguém: quem vai resolver trabalha por período.
  const visibleBlocks = blocks.slice(0, MAX_VISIBLE_BLOCKS);
  const hiddenBlocks = blocks.length - visibleBlocks.length;

  return (
    <div className="det-section ponto-pending-section">
      <div className="sec ponto-subtitle">
        Dias sem alocação ({totalDays})
      </div>
      <p className="placeholder-copy ponto-section-copy">
        Dias com horas no Ponto Mais que possuem RDO ou alocação no Efetivo, mas ficaram sem projeto
        por conflito, sobreposição ou divergência de período. Uma marcação isolada, sem qualquer
        RDO do colaborador e sem Efetivo, permanece apenas na auditoria e não gera pendência. Enquanto
        ficarem aqui, as horas contam como ociosidade e não entram no custo de nenhuma missão.
      </p>

      <div className="ponto-filter-row">
        <div className="field-group">
          <label htmlFor="ponto-unalloc-de">De</label>
          <input id="ponto-unalloc-de" type="date" value={de} onChange={event => setDe(event.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor="ponto-unalloc-ate">Até</label>
          <input id="ponto-unalloc-ate" type="date" value={ate} onChange={event => setAte(event.target.value)} />
        </div>
        {totalDays > 0 ? (
          <span className="placeholder-copy">{fmtHours(totalHours)} em {blocks.length} bloco(s)</span>
        ) : null}
      </div>

      {isLoading ? <p className="placeholder-copy">Carregando…</p> : null}
      {!isLoading && blocks.length === 0 ? (
        <p className="placeholder-copy">Nenhum dia pendente de alocação no período.</p>
      ) : null}

      {hiddenBlocks > 0 ? (
        <p className="placeholder-copy">
          Mostrando os {MAX_VISIBLE_BLOCKS} blocos mais antigos de {blocks.length}. Use o filtro de
          período para trabalhar por partes.
        </p>
      ) : null}

      {visibleBlocks.map(block => {
        const key = blockKey(block);
        const selected = selection[key] ?? '';
        const isOpen = Boolean(expanded[key]);
        const candidates = blockCandidates(block);
        const busy = resolveMutation.isPending;
        return (
          <div key={key} className="field-row ponto-link-row ponto-day-allocation-row">
            <div className="ponto-link-copy">
              <strong>{block.name} · {blockPeriod(block)}</strong>
              <span>
                {block.days.length} dia(s) · {fmtHours(block.hours)} · {allocationReasonLabel(block.reason)}
              </span>
              {candidates.length ? (
                <span className="ponto-candidates">
                  Candidatos:
                  {candidates.map(candidate => (
                    <button
                      key={candidate.projectId}
                      type="button"
                      className={`ponto-candidate${selected === candidate.projectId ? ' active' : ''}`}
                      onClick={() => setSelection(previous => ({ ...previous, [key]: candidate.projectId }))}
                    >
                      {candidate.label} <em>({candidate.origin})</em>
                    </button>
                  ))}
                </span>
              ) : null}
              <button
                type="button"
                className="ponto-inline-link"
                onClick={() => setExpanded(previous => ({ ...previous, [key]: !isOpen }))}
              >
                {isOpen ? 'Ocultar dias' : 'Ver dias'}
              </button>
              {isOpen ? (
                <ul className="ponto-day-list">
                  {block.days.map(day => (
                    <li key={day.date}>
                      {fmtDayDate(day.date)} · {fmtHours(day.totalHours)}
                      {day.tags.length ? ` · ${day.tags.join(' | ')}` : ' · sem etiqueta'}
                      {selected ? (
                        <Button
                          variant="mini"
                          disabled={busy}
                          onClick={() => resolveMutation.mutate([{
                            collaboratorId: block.collaboratorId,
                            date: day.date,
                            projectIds: [selected]
                          }])}
                        >
                          Só este dia
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="field-group">
              <label htmlFor={`ponto-unalloc-${encodeURIComponent(key)}`}>Alocar em</label>
              <select
                id={`ponto-unalloc-${encodeURIComponent(key)}`}
                value={selected}
                onChange={event => setSelection(previous => ({ ...previous, [key]: event.target.value }))}
              >
                <option value="">Selecione a missão…</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{projectOptionLabel(project)}</option>
                ))}
              </select>
            </div>
            <Button
              variant="mini"
              disabled={!selected || busy}
              onClick={() => resolveMutation.mutate(block.days.map(day => ({
                collaboratorId: block.collaboratorId,
                date: day.date,
                projectIds: [selected]
              })))}
            >
              Alocar {block.days.length} dia(s)
            </Button>
          </div>
        );
      })}
    </div>
  );
}
