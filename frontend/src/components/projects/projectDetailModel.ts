import axios from 'axios';
import { z } from 'zod';
import type { Resolver } from 'react-hook-form';
import type { BudgetBreakdownSlice, DayStatus, ManualProjectCostPayload } from '../../api/acompanhamentoComercial';

export const SERVICE_LABELS: Record<string, string> = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
export const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo' };
export const UNIT_LABELS: Record<string, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };
export const QUALITY_IMPACT_LABELS: Record<string, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' };
export const QUALITY_STATUS_LABELS: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_OBSERVACAO: 'Em observação',
  EM_ACAO: 'Em ação',
  FECHADO: 'Fechado',
  DIVULGADO: 'Divulgado'
};
export const QUALITY_DISPOSITION_LABELS: Record<string, string> = {
  TRATAR: 'Tratar',
  MONITORAR: 'Monitorar',
  ARQUIVAR_DIVULGAR: 'Arquivar / Divulgar'
};
export const DAY_META: Record<DayStatus, { cls: string; label: string }> = {
  TRABALHADO: { cls: 'green', label: 'Trabalhado' },
  STANDBY: { cls: 'yellow', label: 'Trabalhado com standby' },
  PARADO: { cls: 'red', label: 'Parado (jornada cheia)' }
};

export interface ManualCostFormValues {
  description: string;
  amount: string;
  costDate: string;
  note: string;
}

export const manualCostFormDefaultValues: ManualCostFormValues = {
  description: '',
  amount: '',
  costDate: '',
  note: ''
};

export function parseBrlCurrencyInput(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return Number.NaN;
  return Number(digits) / 100;
}

export function formatBrlCurrencyInput(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const amount = (Number(digits) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `R$ ${amount}`;
}

export const manualCostFormSchema = z.object({
  description: z.string().trim().min(1, 'Informe a descrição.').max(120, 'Use até 120 caracteres.'),
  amount: z.string().trim().min(1, 'Informe o valor.').superRefine((value, ctx) => {
    const amount = parseBrlCurrencyInput(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um valor maior que zero.' });
      return;
    }
    if (amount > 999999999.99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor muito alto.' });
    }
  }),
  costDate: z.string().trim().refine(value => !value || !Number.isNaN(new Date(value).getTime()), 'Informe uma data válida.'),
  note: z.string().trim().max(500, 'Use até 500 caracteres.')
});

export function zodErrorToFormErrors(error: z.ZodError) {
  return error.issues.reduce<Record<string, { type: string; message: string }>>((acc, issue) => {
    const key = String(issue.path[0] || 'form');
    if (!acc[key]) acc[key] = { type: 'manual', message: issue.message };
    return acc;
  }, {});
}

export const manualCostFormResolver: Resolver<ManualCostFormValues> = async values => {
  const result = manualCostFormSchema.safeParse(values);
  if (result.success) return { values: result.data, errors: {} };
  return { values: {}, errors: zodErrorToFormErrors(result.error) };
};

export function manualCostFormValuesToPayload(values: ManualCostFormValues): ManualProjectCostPayload {
  return {
    description: values.description.trim(),
    amount: parseBrlCurrencyInput(values.amount),
    costDate: values.costDate.trim() || null,
    note: values.note.trim() || null
  };
}

export const brl = (n?: number | null) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
export const fmtPct = (n?: number | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const fmtHours = (n?: number | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
export const toNum = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
export function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
export function fmtShortDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
export function fmtHM(minutes?: number | null) {
  if (!minutes || minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function clampPct(value?: number | null, max = 100) {
  return Math.min(Math.max(value ?? 0, 0), max);
}

export function mutationErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    const message = error.response?.data?.error;
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

export function hasMoney(value?: string | number | null) {
  const n = toNum(value);
  return n !== null && Math.abs(n) > 0.005;
}

export function proposalContributionLabel(proposal: BudgetBreakdownSlice, fallback: string) {
  const code = proposal.codProp ? `Proposta ${proposal.codProp}` : fallback;
  const revision = proposal.nRev !== null && proposal.nRev !== undefined ? ` · Rev ${proposal.nRev}` : '';
  return `${code}${revision}`;
}
