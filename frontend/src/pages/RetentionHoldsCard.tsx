import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  getRetentionHolds,
  setRetentionHold,
  type RetentionHoldItem,
  type RetentionHoldKind
} from '../api/operations';
import { AppIcon } from '../components/icons/AppIcon';
import { Alert, Button, Card, Field, Input, Select } from '../components/ui/ds';
import { operationalDateTime as dateTime } from './operationalStatusPresentation';

const KIND_OPTIONS = [
  { value: 'project', label: 'Projeto' },
  { value: 'collaborator', label: 'Colaborador' }
] as const;

const QUERY_KEY = ['operations', 'retention-holds'];

function HoldList({
  title,
  kind,
  items,
  onRemove,
  removing
}: {
  title: string;
  kind: RetentionHoldKind;
  items: RetentionHoldItem[];
  onRemove: (kind: RetentionHoldKind, code: string) => void;
  removing: boolean;
}) {
  return (
    <div className="ops-page__holds-group">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="ops-page__holds">
          {items.map(item => (
            <li key={item.id}>
              <div>
                <strong>{item.code}</strong> — {item.name}
                <span className="ops-page__note">
                  {item.reason || 'Sem motivo'} · desde {dateTime(item.setAt)}
                </span>
              </div>
              <Button size="sm" variant="ghost" disabled={removing} onClick={() => onRemove(kind, item.code)}>
                Remover exceção
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ops-page__note">Nenhuma exceção.</p>
      )}
    </div>
  );
}

// Exceções (legal hold) da retenção LGPD: o job nunca anonimiza o colaborador
// nem remove fotos/anexos do projeto marcado aqui.
export function RetentionHoldsCard() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<RetentionHoldKind>('project');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: getRetentionHolds });
  const save = useMutation({
    mutationFn: setRetentionHold,
    onSuccess: async (_item, variables) => {
      if (variables.hold) {
        setCode('');
        setReason('');
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ kind, code: code.trim(), hold: true, reason: reason.trim() });
  };

  return (
    <Card
      className="ops-page__panel"
      title={
        <div className="ops-page__panel-title">
          <AppIcon icon={Scale} />
          <h3>Exceções da retenção LGPD</h3>
        </div>
      }
    >
      <p className="ops-page__note">
        Projetos e colaboradores marcados aqui ficam fora da rotina de retenção (por exemplo, processo trabalhista ou
        exigência contratual). Use o código do projeto ou do colaborador.
      </p>
      <form className="ops-page__holds-form" onSubmit={submit}>
        <Field label="Tipo">
          <Select
            value={kind}
            options={KIND_OPTIONS}
            onChange={event => setKind(event.target.value as RetentionHoldKind)}
          />
        </Field>
        <Field label="Código" required>
          <Input value={code} onChange={event => setCode(event.target.value)} maxLength={120} required />
        </Field>
        <Field label="Motivo" required>
          <Input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required minLength={3} />
        </Field>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!code.trim() || reason.trim().length < 3}>
          Marcar exceção
        </Button>
      </form>
      {save.isError ? <Alert tone="danger">{save.error.message}</Alert> : null}
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {isLoading ? <p className="ops-page__note">Carregando exceções…</p> : null}
      {data ? (
        <div className="ops-page__grid">
          <HoldList
            title="Projetos"
            kind="project"
            items={data.projects}
            removing={save.isPending}
            onRemove={(itemKind, itemCode) => save.mutate({ kind: itemKind, code: itemCode, hold: false })}
          />
          <HoldList
            title="Colaboradores"
            kind="collaborator"
            items={data.collaborators}
            removing={save.isPending}
            onRemove={(itemKind, itemCode) => save.mutate({ kind: itemKind, code: itemCode, hold: false })}
          />
        </div>
      ) : null}
    </Card>
  );
}
