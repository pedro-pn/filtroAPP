import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { getResetPasswordStatus, resendPasswordSetup, resetPassword } from '../api/auth';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const isAccountSetup = useMemo(() => searchParams.get('setup') === '1', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [canRequestNewLink, setCanRequestNewLink] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [isResending, setIsResending] = useState(false);

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
        setUsername(data.valid ? data.username || '' : '');
        setCanRequestNewLink(data.canRequestNewLink);
      } catch {
        if (mounted) {
          setStatus('invalid');
          setCanRequestNewLink(false);
        }
      }
    }
    loadStatus();
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 1800);
    return () => window.clearTimeout(timeoutId);
  }, [message, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setIsSaving(true);
    try {
      await resetPassword(token, password);
      setMessage(isAccountSetup ? 'Senha criada com sucesso.' : 'Senha alterada com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao redefinir senha.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRequestNewLink() {
    setError('');
    setResendMessage('');
    setIsResending(true);
    try {
      const data = await resendPasswordSetup(token);
      setResendMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível solicitar um novo link.');
    } finally {
      setIsResending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
        </div>
        <div className="section-title">{isAccountSetup ? 'Criar senha' : 'Redefinir senha'}</div>
        {status === 'loading' ? <p className="placeholder-copy">Validando link...</p> : null}
        {status === 'invalid' ? (
          <div className="auth-form">
            <div className="inline-error">Link inválido, expirado ou já utilizado.</div>
            {isAccountSetup && canRequestNewLink && !resendMessage ? (
              <button className="primary-button" type="button" disabled={isResending} onClick={() => void handleRequestNewLink()}>
                {isResending ? 'Enviando...' : 'Enviar um novo link ao meu e-mail'}
              </button>
            ) : null}
            {resendMessage ? <div className="inline-success">{resendMessage}</div> : null}
            {error ? <div className="inline-error">{error}</div> : null}
            <Link className="secondary-button auth-back-button" to="/login">
              Voltar ao login
            </Link>
          </div>
        ) : null}
        {status === 'valid' && message ? (
          <div className="auth-form">
            <div className="inline-success">{message}</div>
            <p className="placeholder-copy">Redirecionando para o login...</p>
            <Link className="secondary-button auth-back-button" to="/login">
              Ir para o login agora
            </Link>
          </div>
        ) : null}
        {status === 'valid' && !message ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            {username ? (
              <div className="field-group">
                <label>Seu usuário</label>
                <div className="admin-role-fixed">{username}</div>
              </div>
            ) : null}
            <div className="field-group">
              <label htmlFor="new-password">Nova senha</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="confirm-password">Confirmar nova senha</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                minLength={6}
                required
              />
            </div>
            {error ? <div className="inline-error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando...' : isAccountSetup ? 'Criar senha' : 'Salvar nova senha'}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
