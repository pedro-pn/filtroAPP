import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { forgotPassword } from '../api/auth';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Field, Input } from '../components/ui/ds';
import './AuthPasswordPage.css';

export function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);
    try {
      const data = await forgotPassword(identifier);
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao solicitar recuperação.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="fv-ds auth-access-page">
    <section className="auth-access-card" aria-labelledby="auth-access-title">
      <header className="auth-access-header">
        <BrandLogo className="auth-access-logo" />
        <h1 id="auth-access-title">Recuperar senha</h1>
        <p>Informe seu usuário, e-mail interno ou CNPJ do cliente.</p>
      </header>
      {message ? <div className="auth-access-content">
        <Alert tone="success">{message}</Alert>
        <Link className="fv-button fv-button--secondary fv-button--md auth-access-back" to="/login">Voltar ao login</Link>
      </div> : <form className="auth-access-form" onSubmit={handleSubmit}>
        <Field id="password-identifier" label="Identificador" optionalText={null}>
          <Input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button variant="primary" type="submit" loading={isSubmitting}>
          {isSubmitting ? 'Enviando...' : 'Enviar link'}
        </Button>
        <Link className="fv-button fv-button--secondary fv-button--md auth-access-back" to="/login">Voltar ao login</Link>
      </form>}
    </section>
  </main>;
}
