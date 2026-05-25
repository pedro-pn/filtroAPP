import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getResetPasswordStatus, resetPassword } from '../api/auth';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    async function loadStatus() {
      if (!token) {
        if (mounted) setStatus('invalid');
        return;
      }
      try {
        const data = await getResetPasswordStatus(token);
        if (!mounted) return;
        setStatus(data.valid ? 'valid' : 'invalid');
      } catch {
        if (mounted) setStatus('invalid');
      }
    }
    loadStatus();
    return () => {
      mounted = false;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await resetPassword(token, password);
      setMessage('Senha redefinida com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao redefinir senha.');
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
        </div>
        <div className="section-title">Redefinir senha</div>
        {status === 'loading' ? <p className="placeholder-copy">Validando link...</p> : null}
        {status === 'invalid' ? <div className="inline-error">Link inválido, expirado ou já utilizado.</div> : null}
        {status === 'valid' && message ? (
          <div className="auth-form">
            <div className="inline-success">{message}</div>
            <Link className="secondary-button auth-back-button" to="/login">
              Voltar
            </Link>
          </div>
        ) : null}
        {status === 'valid' && !message ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="new-password">Nova senha</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="confirm-password">Confirmar nova senha</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
              />
            </div>
            {error ? <div className="inline-error">{error}</div> : null}
            <button className="primary-button" type="submit">
              Salvar nova senha
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
