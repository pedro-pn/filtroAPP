import { FormEvent, useState } from 'react';

import { forgotPassword } from '../api/auth';

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

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="section-title">Recuperar senha</div>
        <p className="placeholder-copy">Informe usuário, e-mail interno ou CNPJ do cliente.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="identifier">Identificador</label>
            <input id="identifier" value={identifier} onChange={event => setIdentifier(event.target.value)} />
          </div>
          {message ? <div className="inline-success">{message}</div> : null}
          {error ? <div className="inline-error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Enviando...' : 'Enviar link'}
          </button>
        </form>
      </section>
    </main>
  );
}
