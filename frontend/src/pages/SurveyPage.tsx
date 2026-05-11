import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getPublicSurvey, submitPublicSurvey, type SurveyResponsePayload } from '../api/surveys';
import { useToast } from '../components/ui/Toast';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const surveyLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_VERDE.png`;

const scaleFields = [
  ['serviceQuality', 'Qualidade dos serviços prestados'],
  ['communication', 'Comunicação da equipe durante o projeto'],
  ['deadlines', 'Cumprimento de prazos'],
  ['documentation', 'Qualidade da documentação entregue']
] as const;

type SurveyNumericField = 'nps' | 'serviceQuality' | 'communication' | 'deadlines' | 'documentation';
type SurveyFormState = Omit<SurveyResponsePayload, SurveyNumericField> & Record<SurveyNumericField, number | ''>;

function numberOptions(start: number, end: number) {
  const values = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

export function SurveyPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [form, setForm] = useState<SurveyFormState>({
    nps: '',
    serviceQuality: '',
    communication: '',
    deadlines: '',
    documentation: '',
    improvement: '',
    highlight: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const surveyQuery = useQuery({
    queryKey: ['public-survey', token],
    queryFn: () => getPublicSurvey(token),
    enabled: !!token
  });

  const submitMutation = useMutation({
    mutationFn: (payload: SurveyResponsePayload) => submitPublicSurvey(token, payload),
    onSuccess: () => {
      setSubmitted(true);
      showToast('Pesquisa enviada. Obrigado pela resposta.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível enviar a pesquisa.', 'error')
  });

  const status = submitted ? 'RESPONDED' : surveyQuery.data?.status;
  const title = useMemo(() => {
    if (status === 'RESPONDED') return 'Pesquisa respondida';
    if (status === 'EXPIRED') return 'Pesquisa expirada';
    if (status === 'INVALID') return 'Pesquisa indisponível';
    return 'Pesquisa de satisfação';
  }, [status]);

  function setField<K extends keyof SurveyFormState>(field: K, value: SurveyFormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const numericFields: SurveyNumericField[] = ['nps', 'serviceQuality', 'communication', 'deadlines', 'documentation'];
    if (numericFields.some(field => form[field] === '')) {
      showToast('Preencha todas as notas antes de enviar.', 'error');
      return;
    }
    submitMutation.mutate({
      nps: Number(form.nps),
      serviceQuality: Number(form.serviceQuality),
      communication: Number(form.communication),
      deadlines: Number(form.deadlines),
      documentation: Number(form.documentation),
      improvement: form.improvement || '',
      highlight: form.highlight || ''
    });
  }

  return (
    <main className="survey-page-shell">
      <header className="survey-header">
        <img src={surveyLogoUrl} alt="Filtrovali" />
      </header>
      <section className="auth-card survey-card">
        <div className="section-title">{title}</div>
        {surveyQuery.isLoading ? <p className="placeholder-copy">Carregando pesquisa...</p> : null}
        {status === 'RESPONDED' ? (
          <>
            <p className="placeholder-copy">Obrigado. Sua resposta foi registrada.</p>
            <button className="secondary-button" type="button" onClick={() => navigate('/')}>Voltar</button>
          </>
        ) : null}
        {status === 'EXPIRED' ? <p className="placeholder-copy">Este link expirou.</p> : null}
        {status === 'INVALID' ? <p className="placeholder-copy">Não foi possível localizar uma pesquisa ativa para este link.</p> : null}
        {status === 'ACTIVE' && surveyQuery.data?.survey ? (
          <form className="admin-form" onSubmit={handleSubmit}>
            <div className="det-section">
              <div className="det-row"><span className="det-label">Cliente</span><span className="det-val">{surveyQuery.data.survey.project.clientName}</span></div>
              <div className="det-row"><span className="det-label">Projeto</span><span className="det-val">{surveyQuery.data.survey.project.code} - {surveyQuery.data.survey.project.name}</span></div>
            </div>
            <div className="field-group">
              <label htmlFor="survey-nps">Probabilidade de recomendar a Filtrovali</label>
              <select id="survey-nps" value={form.nps} onChange={event => setField('nps', event.target.value === '' ? '' : Number(event.target.value))} required>
                <option value="">Selecionar...</option>
                {numberOptions(0, 10).map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            {scaleFields.map(([field, label]) => (
              <div className="field-group" key={field}>
                <label htmlFor={`survey-${field}`}>{label}</label>
                <select id={`survey-${field}`} value={form[field]} onChange={event => setField(field, event.target.value === '' ? '' : Number(event.target.value))} required>
                  <option value="">Selecionar...</option>
                  {numberOptions(1, 5).map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
            ))}
            <div className="field-group">
              <label htmlFor="survey-improvement">O que podemos melhorar?</label>
              <textarea id="survey-improvement" value={form.improvement || ''} onChange={event => setField('improvement', event.target.value)} />
            </div>
            <div className="field-group">
              <label htmlFor="survey-highlight">Algo que gostaria de destacar?</label>
              <textarea id="survey-highlight" value={form.highlight || ''} onChange={event => setField('highlight', event.target.value)} />
            </div>
            <div className="survey-actions">
              <button className="primary-button survey-submit-button" type="submit" disabled={submitMutation.isPending}>Enviar resposta</button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
