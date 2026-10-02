import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { createDataSubjectRequest, type DataSubjectRequestType } from '../api/privacy';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '../components/ui/ds';
import { PRIVACY_CONTACT } from '../constants/privacy';
import './PrivacyPublicPage.ds.css';

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
    <main className="fv-ds privacy-public-shell" data-fv-ds>
      <header className="privacy-public-header"><BrandLogo className="privacy-public-logo" /></header>
      <Card className="privacy-public-hero" padding="lg">
        <Link className="privacy-public-back" to="/privacidade">Voltar à política</Link>
        <div className="section-title">Direitos do titular</div>
        <h1>Solicitação LGPD</h1>
        <p>
          Use este canal para solicitar confirmação, acesso, correção, anonimização, eliminação,
          portabilidade, informações ou oposição sobre o tratamento de dados pessoais.
        </p>
        <div className="privacy-public-meta">
          <span>Canal: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a></span>
        </div>
      </Card>

      <Card className="privacy-public-form-card" padding="lg">
        <form className="privacy-public-form" onSubmit={handleSubmit}>
          <Field id="privacy-request-type" label="Tipo de solicitação" required>
            <Select value={type} onChange={event => setType(event.target.value as DataSubjectRequestType)}>
              {requestTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field id="privacy-request-name" label="Nome completo" required>
            <Input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={160} />
          </Field>
          <Field id="privacy-request-email" label="E-mail de contato" required>
            <Input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} />
          </Field>
          <Field id="privacy-request-identifier" label="CPF, CNPJ, usuário ou projeto relacionado">
            <Input value={identifier} onChange={event => setIdentifier(event.target.value)} maxLength={160} />
          </Field>
          <Field id="privacy-request-details" label="Detalhes da solicitação" required className="privacy-public-form__wide">
            <Textarea value={details} onChange={event => setDetails(event.target.value)} minLength={10} maxLength={4000} rows={6} />
          </Field>

          {error ? <Alert tone="danger" className="privacy-public-form__wide">{error}</Alert> : null}
          {protocol ? (
            <Alert tone="success" className="privacy-public-form__wide">
              Solicitação registrada. Protocolo: <strong>{protocol}</strong>
            </Alert>
          ) : null}
          {successMessage ? <Alert tone="success" className="privacy-public-form__wide">{successMessage}</Alert> : null}

          <div className="privacy-public-form__actions privacy-public-form__wide">
            <Button variant="primary" type="submit" loading={isSubmitting}>
              {isSubmitting ? 'Registrando...' : 'Registrar solicitação'}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
