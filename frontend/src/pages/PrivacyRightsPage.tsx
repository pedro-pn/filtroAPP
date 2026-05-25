import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { createDataSubjectRequest, type DataSubjectRequestType } from '../api/privacy';
import { PRIVACY_CONTACT } from '../constants/privacy';

const requestTypeOptions: Array<{ value: DataSubjectRequestType; label: string }> = [
  { value: 'CONFIRMATION', label: 'Confirmação de tratamento' },
  { value: 'ACCESS', label: 'Acesso aos dados' },
  { value: 'CORRECTION', label: 'Correção de dados' },
  { value: 'ANONYMIZATION', label: 'Anonimização' },
  { value: 'BLOCKING', label: 'Bloqueio' },
  { value: 'DELETION', label: 'Eliminação' },
  { value: 'PORTABILITY', label: 'Portabilidade' },
  { value: 'SHARING_INFO', label: 'Informações sobre compartilhamento' },
  { value: 'CONSENT_REVOCATION', label: 'Revogação de consentimento' },
  { value: 'OPPOSITION', label: 'Oposição ao tratamento' },
  { value: 'OTHER', label: 'Outro pedido' }
];

export function PrivacyRightsPage() {
  const [type, setType] = useState<DataSubjectRequestType>('ACCESS');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [details, setDetails] = useState('');
  const [protocol, setProtocol] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setProtocol('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      const request = await createDataSubjectRequest({
        type,
        name,
        email,
        identifier: identifier.trim() || null,
        details
      });
      if (request.protocol) {
        setProtocol(request.protocol);
      } else {
        setSuccessMessage('Solicitação recebida. Se já houver um pedido recente igual, manteremos o acompanhamento pelo canal informado.');
      }
      setName('');
      setEmail('');
      setIdentifier('');
      setDetails('');
      setType('ACCESS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a solicitação.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="privacy-policy-page">
      <section className="privacy-policy-hero">
        <Link className="auth-link privacy-policy-back" to="/privacidade">Voltar à política</Link>
        <div className="section-title">Direitos do titular</div>
        <h1>Solicitação LGPD</h1>
        <p>
          Use este canal para solicitar confirmação, acesso, correção, anonimização, eliminação,
          portabilidade, informações ou oposição sobre o tratamento de dados pessoais.
        </p>
        <div className="privacy-policy-meta">
          <span>Canal: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a></span>
        </div>
      </section>

      <section className="privacy-policy-content">
        <form className="privacy-rights-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="privacy-request-type">Tipo de solicitação</label>
            <select id="privacy-request-type" value={type} onChange={event => setType(event.target.value as DataSubjectRequestType)}>
              {requestTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="privacy-request-name">Nome completo</label>
            <input id="privacy-request-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={160} />
          </div>
          <div className="field-group">
            <label htmlFor="privacy-request-email">E-mail de contato</label>
            <input id="privacy-request-email" type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} />
          </div>
          <div className="field-group">
            <label htmlFor="privacy-request-identifier">CPF, CNPJ, usuário ou projeto relacionado</label>
            <input id="privacy-request-identifier" value={identifier} onChange={event => setIdentifier(event.target.value)} maxLength={160} />
          </div>
          <div className="field-group">
            <label htmlFor="privacy-request-details">Detalhes da solicitação</label>
            <textarea id="privacy-request-details" value={details} onChange={event => setDetails(event.target.value)} required minLength={10} maxLength={4000} rows={6} />
          </div>

          {error ? <div className="inline-error">{error}</div> : null}
          {protocol ? (
            <div className="privacy-request-success">
              Solicitação registrada. Protocolo: <strong>{protocol}</strong>
            </div>
          ) : null}
          {successMessage ? <div className="privacy-request-success">{successMessage}</div> : null}

          <div className="client-privacy-actions">
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Registrando...' : 'Registrar solicitação'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
