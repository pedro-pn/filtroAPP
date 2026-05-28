import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { confirmEmailChange, getEmailChangeStatus } from '../api/account';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'confirmed'>('loading');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    async function loadStatus() {
      if (!token) {
        if (mounted) setStatus('invalid');
        return;
      }
      try {
        const data = await getEmailChangeStatus(token);
        if (!mounted) return;
        setEmail(data.email || '');
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

  async function handleConfirm() {
    setError('');
    try {
      await confirmEmailChange(token);
      setStatus('confirmed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao confirmar e-mail.');
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
        </div>
        <div className="section-title">Confirmar e-mail</div>
        {status === 'loading' ? <p className="placeholder-copy">Validando link...</p> : null}
        {status === 'invalid' ? <div className="inline-error">Link inválido, expirado ou já utilizado.</div> : null}
        {status === 'valid' ? (
          <div className="auth-form">
            <p className="placeholder-copy">Confirme a troca para {email || 'o novo e-mail'}.</p>
            {error ? <div className="inline-error">{error}</div> : null}
            <button className="primary-button" type="button" onClick={() => void handleConfirm()}>
              Confirmar e-mail
            </button>
          </div>
        ) : null}
        {status === 'confirmed' ? (
          <div className="auth-form">
            <div className="inline-success">E-mail confirmado com sucesso.</div>
            <Link className="secondary-button auth-back-button" to="/login">
              Ir para login
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
