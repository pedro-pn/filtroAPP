import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getCostConfig, saveCostConfig } from '../../api/acompanhamentoCusto';
import { useToast } from '../ui/ToastContext';

interface CostConfigForm {
  epiAnnualCost: string;
  examsTrainingAnnualCost: string;
  offshoreExamsTrainingAnnualCost: string;
}

const emptyForm: CostConfigForm = {
  epiAnnualCost: '',
  examsTrainingAnnualCost: '',
  offshoreExamsTrainingAnnualCost: ''
};

function moneyValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Custos fixos anuais por colaborador — entram no custo mensal → custo/hora e HH.
export function EpiConfigCard() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data } = useQuery({ queryKey: ['cost-config'], queryFn: getCostConfig });
  const [form, setForm] = useState<CostConfigForm>(emptyForm);

  useEffect(() => {
    if (!data) return;
    setForm({
      epiAnnualCost: String(data.epiAnnualCost),
      examsTrainingAnnualCost: String(data.examsTrainingAnnualCost),
      offshoreExamsTrainingAnnualCost: String(data.offshoreExamsTrainingAnnualCost)
    });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => saveCostConfig({
      epiAnnualCost: moneyValue(form.epiAnnualCost),
      examsTrainingAnnualCost: moneyValue(form.examsTrainingAnnualCost),
      offshoreExamsTrainingAnnualCost: moneyValue(form.offshoreExamsTrainingAnnualCost)
    }),
    onSuccess: () => {
      showToast('Custos anuais por colaborador salvos.');
      queryClient.invalidateQueries({ queryKey: ['cost-config'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    },
    onError: () => showToast('Não foi possível salvar os custos anuais.')
  });

  function updateField(key: keyof CostConfigForm, value: string) {
    setForm(current => ({ ...current, [key]: value }));
  }

  return (
    <div className="page-card" style={{ marginBottom: 12 }}>
      <div className="sec">Custos anuais por colaborador</div>
      <p className="placeholder-copy" style={{ margin: '4px 0 12px' }}>
        Médias fixas anuais por colaborador, iguais para todos os cargos. EPI sempre entra no custo mensal.
        Exames + treinamentos usa o valor offshore quando o colaborador tiver registro em projeto offshore
        no mesmo ano; caso contrário, usa o valor normal.
      </p>
      <div className="admin-inline-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        <div className="field-group">
          <label htmlFor="epi-anual">EPI (R$/ano)</label>
          <input
            id="epi-anual"
            type="number"
            step="any"
            value={form.epiAnnualCost}
            onChange={e => updateField('epiAnnualCost', e.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="exames-treinamentos-anual">Exames + treinamentos (R$/ano)</label>
          <input
            id="exames-treinamentos-anual"
            type="number"
            step="any"
            value={form.examsTrainingAnnualCost}
            onChange={e => updateField('examsTrainingAnnualCost', e.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="exames-treinamentos-offshore-anual">Exames + treinamentos offshore (R$/ano)</label>
          <input
            id="exames-treinamentos-offshore-anual"
            type="number"
            step="any"
            value={form.offshoreExamsTrainingAnnualCost}
            onChange={e => updateField('offshoreExamsTrainingAnnualCost', e.target.value)}
          />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="mini-btn" type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? 'Salvando…' : 'Salvar custos anuais'}
        </button>
      </div>
    </div>
  );
}
