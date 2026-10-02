import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getPublicSurvey, submitPublicSurvey, type PublicSurveyPayload, type SurveyQuestion, type SurveyResponsePayload } from '../api/surveys';
import { PrivacyNotice } from '../components/privacy/PrivacyNotice';
import { Alert, Button, Field, Select, Textarea } from '../components/ui/ds';
import { useToast } from '../components/ui/ToastContext';
import { SURVEY_NOTICE_VERSION } from '../constants/privacy';
import { PublicFlowShell } from './PublicFlowShell';

type SurveyFormState = Record<string, string | number>;

const previewSurvey: PublicSurveyPayload = {
  status: 'ACTIVE',
  survey: {
    id: 'visual-preview',
    expiresAt: '2030-12-31T00:00:00.000Z',
    questions: [
      { id: 'nps', label: 'Quanto você recomendaria nossos serviços?', type: 'NPS', options: [], required: true, order: 0 },
      { id: 'quality', label: 'Como você avalia a qualidade do atendimento?', type: 'SCALE', options: [], required: true, order: 1 },
      { id: 'highlight', label: 'Qual aspecto mais se destacou?', type: 'SELECT', options: ['Atendimento', 'Prazo', 'Qualidade técnica', 'Comunicação'], required: true, order: 2 },
      { id: 'comments', label: 'Conte como foi sua experiência', type: 'TEXT', options: [], required: false, order: 3 }
    ],
    project: { code: '5917', name: 'Ilha Solteira', clientName: 'Cliente de demonstração' }
  }
};

function questionLabel(question: SurveyQuestion) {
  return <>{question.label}{question.required ? <span aria-hidden="true"> *</span> : null}</>;
}

export function SurveyPage() {
  const { token = '' } = useParams();
  const location = useLocation();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('visualizar') === '1';
  const showToast = useToast();
  const [form, setForm] = useState<SurveyFormState>({});
  const [submitted, setSubmitted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [validationError, setValidationError] = useState('');

  const surveyQuery = useQuery({ queryKey: ['public-survey', token], queryFn: () => getPublicSurvey(token), enabled: !!token && !preview });
  const submitMutation = useMutation({
    mutationFn: (payload: SurveyResponsePayload) => preview ? Promise.resolve({ success: true as const }) : submitPublicSurvey(token, payload),
    onSuccess: () => { setSubmitted(true); showToast('Pesquisa enviada. Obrigado pela resposta.', 'success'); },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível enviar a pesquisa.', 'error')
  });
  const data = preview ? previewSurvey : surveyQuery.data;
  const status = submitted ? 'RESPONDED' : data?.status;
  const title = status === 'RESPONDED' ? 'Pesquisa respondida' : status === 'EXPIRED' ? 'Pesquisa expirada' : status === 'INVALID' ? 'Pesquisa indisponível' : 'Pesquisa de satisfação';

  function setField(field: string, value: string | number) {
    setValidationError('');
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const questions = data?.survey?.questions || [];
    const missing = questions.find(question => question.required && (form[question.id] === undefined || form[question.id] === ''));
    if (missing) { setValidationError(`Preencha: ${missing.label}`); return; }
    if (!privacyAccepted) { setValidationError('Confirme a ciência do aviso de privacidade antes de enviar.'); return; }
    setValidationError('');
    submitMutation.mutate({ answers: form, privacyNoticeAccepted: true, privacyNoticeVersion: SURVEY_NOTICE_VERSION });
  }

  function renderQuestion(question: SurveyQuestion) {
    const value = form[question.id] ?? '';
    if (question.type === 'TEXT') return <Field key={question.id} id={`survey-${question.id}`} label={question.label} required={question.required} optionalText={null}>
      <Textarea value={String(value)} onChange={event => setField(question.id, event.target.value)} rows={4} />
    </Field>;
    if (question.type === 'NPS' || question.type === 'SCALE') {
      const options = Array.from({ length: question.type === 'NPS' ? 11 : 5 }, (_, index) => index + (question.type === 'NPS' ? 0 : 1));
      return <fieldset className="public-flow-question" key={question.id}>
        <legend>{questionLabel(question)}</legend>
        <div className="public-flow-scale">{options.map(option => <label key={option}>
          <input type="radio" name={`survey-${question.id}`} value={option} checked={String(value) === String(option)} required={question.required} onChange={() => setField(question.id, option)} />
          <span>{option}</span>
        </label>)}</div>
        <small>{question.type === 'NPS' ? '0 = nada provável · 10 = muito provável' : '1 = ruim · 5 = excelente'}</small>
      </fieldset>;
    }
    return <Field key={question.id} id={`survey-${question.id}`} label={question.label} required={question.required} optionalText={null}>
      <Select value={String(value)} onChange={event => setField(question.id, event.target.value)}>
        <option value="">Selecionar…</option>
        {question.options.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>
    </Field>;
  }

  return <PublicFlowShell title={title} description={status === 'ACTIVE' ? 'Sua opinião nos ajuda a melhorar cada projeto.' : undefined} wide preview={preview}>
    {!preview && surveyQuery.isLoading ? <p>Carregando pesquisa…</p> : null}
    {!preview && surveyQuery.isError ? <Alert tone="danger">Não foi possível carregar a pesquisa.</Alert> : null}
    {status === 'RESPONDED' ? <><Alert tone="success">Obrigado. Sua resposta foi registrada.</Alert><Link className="fv-button fv-button--secondary fv-button--md public-flow-back" to={preview ? '/visualizar' : '/'}>Voltar</Link></> : null}
    {status === 'EXPIRED' ? <Alert tone="warning">Este link expirou.</Alert> : null}
    {status === 'INVALID' ? <Alert tone="danger">Não foi possível localizar uma pesquisa ativa para este link.</Alert> : null}
    {status === 'ACTIVE' && data?.survey ? <form className="public-flow-form" onSubmit={handleSubmit} noValidate>
      <dl className="public-flow-context">
        <div><dt>Cliente</dt><dd>{data.survey.project.clientName}</dd></div>
        <div><dt>Projeto</dt><dd>{data.survey.project.code} · {data.survey.project.name}</dd></div>
      </dl>
      {data.survey.questions.map(renderQuestion)}
      <PrivacyNotice variant="survey" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={submitMutation.isPending} />
      {validationError ? <Alert tone="danger">{validationError}</Alert> : null}
      <Button variant="primary" type="submit" loading={submitMutation.isPending} fullWidth>{submitMutation.isPending ? 'Enviando…' : 'Enviar resposta'}</Button>
    </form> : null}
  </PublicFlowShell>;
}
