import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { roleHomePath } from '../auth/rolePath';
import { normalizeCnpjInput } from '../utils/formatCnpj';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;
const REMEMBERED_USER_KEY = 'filtrovali-react-remembered-user';

export function LoginPage() {
  const { isAuthenticated, user, login } = useAuth();
  const [username, setUsername] = useState(() => localStorage.getItem(REMEMBERED_USER_KEY) || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem(REMEMBERED_USER_KEY)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(() => roleHomePath(user?.role), [user?.role]);
  if (isAuthenticated) return <Navigate to={redirectPath} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login({ username, password, rememberMe });
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_USER_KEY, username);
      } else {
        localStorage.removeItem(REMEMBERED_USER_KEY);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar login.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
          <p className="auth-subtitle">Sistema de relatórios de serviços</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="username">Usuário</label>
            <input
              id="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              onBlur={() => {
                const digits = username.replace(/\D/g, '');
                if (digits.length === 14 && !/[A-Za-z@]/.test(username)) {
                  setUsername(normalizeCnpjInput(username));
                }
              }}
            />
          </div>

          <div className="field-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>

          <div className="auth-options-row">
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={event => setRememberMe(event.target.checked)}
            />
            <span>Lembrar usuário</span>
          </label>
            <Link className="auth-link" to="/forgot-password">Esqueci minha senha</Link>
          </div>

          {error ? <div className="inline-error">{error}</div> : null}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
