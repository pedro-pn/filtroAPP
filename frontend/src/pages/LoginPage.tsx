import { useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, Navigate } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { preferredEntryPath } from '../auth/moduleNavigation';
import { AppIcon } from '../components/icons/AppIcon';
import { Alert, Button, Field, Input } from '../components/ui/ds';
import { normalizeCnpjInput } from '../utils/formatCnpj';
import { PublicFlowShell } from './PublicFlowShell';

const REMEMBERED_USER_KEY = 'filtrovali-react-remembered-user';

export function LoginPage({ preview = false }: { preview?: boolean }) {
  const { isAuthenticated, isBootstrapping, token, user, login } = useAuth();
  const [username, setUsername] = useState(() => preview ? '' : localStorage.getItem(REMEMBERED_USER_KEY) || '');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => !preview && Boolean(localStorage.getItem(REMEMBERED_USER_KEY)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewMessage, setPreviewMessage] = useState('');

  const redirectPath = useMemo(() => preferredEntryPath(user), [user]);
  if (!preview && (isBootstrapping || (token && !user))) return null;
  if (!preview && isAuthenticated) return <Navigate to={redirectPath} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (preview) {
      setPreviewMessage('Esta é uma demonstração visual. Use o login normal para entrar.');
      return;
    }
    setIsSubmitting(true);
    try {
      await login({ username, password, rememberMe });
      if (rememberMe) localStorage.setItem(REMEMBERED_USER_KEY, username);
      else localStorage.removeItem(REMEMBERED_USER_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao realizar login.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <PublicFlowShell title="Bem-vindo ao FiltroAPP" description="Acesse seus projetos, relatórios e serviços em um só lugar." preview={preview}>
    <form className="public-flow-form" onSubmit={handleSubmit}>
      <Field id="login-username" label="Usuário" required optionalText={null}>
        <Input value={username} autoComplete="username" onChange={event => setUsername(event.target.value)} onBlur={() => {
          const digits = username.replace(/\D/g, '');
          if (digits.length === 14 && !/[A-Za-z@]/.test(username)) setUsername(normalizeCnpjInput(username));
        }} />
      </Field>
      <Field id="login-password" label="Senha" required optionalText={null}>
        <div className="public-flow-password">
          <Input type={isPasswordVisible ? 'text' : 'password'} value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} />
          <button type="button" className="public-flow-password-toggle" aria-label={isPasswordVisible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={isPasswordVisible} onMouseDown={event => event.preventDefault()} onClick={() => setIsPasswordVisible(current => !current)}>
            <AppIcon icon={isPasswordVisible ? EyeOff : Eye} size="sm" />
          </button>
        </div>
      </Field>
      <div className="public-flow-options">
        <label className="public-flow-checkbox"><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} />Lembrar usuário</label>
        <Link to="/forgot-password">Esqueci minha senha</Link>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {previewMessage ? <Alert tone="info">{previewMessage}</Alert> : null}
      <Button variant="primary" type="submit" loading={isSubmitting} fullWidth>{isSubmitting ? 'Entrando…' : 'Entrar'}</Button>
    </form>
    <div className="public-flow-options"><Link to="/privacidade">Política de privacidade</Link></div>
  </PublicFlowShell>;
}
