import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getPublicSurvey, submitPublicSurvey, type SurveyQuestion, type SurveyResponsePayload } from '../api/surveys';
import { useToast } from '../components/ui/Toast';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const surveyLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_VERDE.png`;

type SurveyFormState = Record<string, string | number>;

function numberOptions(start: number, end: number) {
  const values = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

function questionLabel(question: SurveyQuestion) {
  return (
    <>
      {question.label}
      {question.required ? (
        <span className="survey-required-marker">
          <span aria-hidden="true">*</span> (obrigatório)
        </span>
      ) : null}
    </>
  );
}

export function SurveyPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [form, setForm] = useState<SurveyFormState>({});
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

  function setField(field: string, value: string | number) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const questions = surveyQuery.data?.survey?.questions || [];
    const missing = questions.find(question => question.required && (form[question.id] === undefined || form[question.id] === ''));
    if (missing) {
      showToast(`Preencha: ${missing.label}`, 'error');
      return;
    }
    submitMutation.mutate({ answers: form });
  }

  function renderQuestion(question: SurveyQuestion) {
    const value = form[question.id] ?? '';
    if (question.type === 'TEXT') {
      return (
        <div className="field-group" key={question.id}>
          <label htmlFor={`survey-${question.id}`}>{questionLabel(question)}</label>
          <textarea id={`survey-${question.id}`} value={String(value)} onChange={event => setField(question.id, event.target.value)} required={question.required} />
        </div>
      );
    }

    const options: Array<string | number> = question.type === 'NPS'
      ? numberOptions(0, 10)
      : question.type === 'SCALE'
        ? numberOptions(1, 5)
        : question.options;

    if (question.type === 'NPS' || question.type === 'SCALE') {
      return (
        <fieldset className="field-group survey-scale-field" key={question.id}>
          <legend>{questionLabel(question)}</legend>
          <div className="survey-scale-row">
            {options.map(option => (
              <label className={`survey-scale-option ${String(value) === String(option) ? 'selected' : ''}`} key={option}>
                <input
                  type="radio"
                  name={`survey-${question.id}`}
                  value={option}
                  checked={String(value) === String(option)}
                  required={question.required}
                  onChange={() => setField(question.id, Number(option))}
                />
                <span className="survey-scale-dot">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    return (
      <div className="field-group" key={question.id}>
        <label htmlFor={`survey-${question.id}`}>{questionLabel(question)}</label>
        <select
          id={`survey-${question.id}`}
          value={value}
          onChange={event => {
            const selected = event.target.value;
            setField(question.id, question.type === 'NPS' || question.type === 'SCALE' ? Number(selected) : selected);
          }}
          required={question.required}
        >
          <option value="">Selecionar...</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    );
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
            {surveyQuery.data.survey.questions.map(question => renderQuestion(question))}
            <div className="survey-actions">
              <button className="primary-button survey-submit-button" type="submit" disabled={submitMutation.isPending}>Enviar resposta</button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
