import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { preferredEntryPath } from '../auth/moduleNavigation';
import { normalizeCnpjInput } from '../utils/formatCnpj';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;
const REMEMBERED_USER_KEY = 'filtrovali-react-remembered-user';

export function LoginPage() {
  const { isAuthenticated, isBootstrapping, token, user, login } = useAuth();
  const [username, setUsername] = useState(() => localStorage.getItem(REMEMBERED_USER_KEY) || '');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem(REMEMBERED_USER_KEY)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(() => preferredEntryPath(user), [user]);
  if (isBootstrapping || (token && !user)) return null;
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
            <div className="password-input-wrap">
              <input
                id="password"
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                onChange={event => setPassword(event.target.value)}
              />
              <button
                className="password-visibility-button"
                type="button"
                aria-label={isPasswordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                title={isPasswordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={isPasswordVisible}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setIsPasswordVisible(current => !current)}
              >
                {isPasswordVisible ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.2 5.4A9.5 9.5 0 0 1 12 5c5.5 0 9 5.2 9 7a5.8 5.8 0 0 1-1.7 2.6" />
                    <path d="M6.6 6.8C4.4 8.3 3 10.7 3 12c0 1.8 3.5 7 9 7a9.3 9.3 0 0 0 4.5-1.2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 12c0-1.8 3.5-7 9-7s9 5.2 9 7-3.5 7-9 7-9-5.2-9-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
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
