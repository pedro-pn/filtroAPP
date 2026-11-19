import { useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router';

import { resendTwoFactor } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { preferredEntryPath } from '../auth/moduleNavigation';
import { AppIcon } from '../components/icons/AppIcon';
import { Alert, Button, Field, Input } from '../components/ui/ds';
import type { TwoFactorChallenge } from '../types/auth';
import { normalizeCnpjInput } from '../utils/formatCnpj';
import { PublicFlowShell } from './PublicFlowShell';

const REMEMBERED_USER_KEY = 'filtrovali-react-remembered-user';

export function LoginPage({ preview = false }: { preview?: boolean }) {
  const { isAuthenticated, isBootstrapping, sessionEndReason, user, login, completeTwoFactor } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState(() => {
    if (preview) return '';
    const prefilledUsername = location.state?.username;
    return typeof prefilledUsername === 'string' && prefilledUsername
      ? prefilledUsername
      : localStorage.getItem(REMEMBERED_USER_KEY) || '';
  });
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => !preview && Boolean(localStorage.getItem(REMEMBERED_USER_KEY)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewMessage, setPreviewMessage] = useState('');
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [code, setCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [info, setInfo] = useState('');
  const [isResending, setIsResending] = useState(false);

  // `?next=/caminho` devolve o usuário ao ponto de origem (ex.: página pública do QR) depois do login.
  const nextPath = useMemo(() => {
    const next = new URLSearchParams(location.search).get('next') || '';
    return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '';
  }, [location.search]);
  const redirectPath = useMemo(() => nextPath || preferredEntryPath(user), [nextPath, user]);
  if (!preview && isBootstrapping) return null;
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
      const outcome = await login({ username, password, rememberMe });
      if (rememberMe) localStorage.setItem(REMEMBERED_USER_KEY, username);
      else localStorage.removeItem(REMEMBERED_USER_KEY);
      if (outcome.status === 'two-factor') {
        setChallenge(outcome.challenge);
        setCode('');
        setInfo('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao realizar login.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError('');
    setIsSubmitting(true);
    try {
      await completeTwoFactor({ username, challengeToken: challenge.challengeToken, code, rememberDevice });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (!challenge) return;
    setError('');
    setInfo('');
    setIsResending(true);
    try {
      const result = await resendTwoFactor(challenge.challengeToken);
      setInfo(`Enviamos um novo código para ${result.emailHint}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reenviar o código.');
    } finally {
      setIsResending(false);
    }
  }

  function backToPassword() {
    setChallenge(null);
    setCode('');
    setPassword('');
    setError('');
    setInfo('');
  }

  if (challenge) {
    return <PublicFlowShell title="Verificação em duas etapas" description="Sistema Integrado de Operação" logoVariant="login" preview={preview}>
      <form className="public-flow-form" onSubmit={handleVerify}>
        <p>Enviamos um código de 6 dígitos para <strong>{challenge.emailHint}</strong>. Ele vale por 10 minutos.</p>
        <Field id="login-two-factor-code" label="Código" required optionalText={null}>
          <Input
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            autoFocus
            onChange={event => setCode(event.target.value.replace(/[^\d ]/g, ''))}
          />
        </Field>
        <label className="public-flow-checkbox">
          <input type="checkbox" checked={rememberDevice} onChange={event => setRememberDevice(event.target.checked)} />
          Lembrar este navegador por {challenge.trustedDeviceDays} dias
        </label>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {info ? <Alert tone="info">{info}</Alert> : null}
        <Button variant="primary" type="submit" loading={isSubmitting} disabled={code.replace(/\D/g, '').length !== 6} fullWidth>{isSubmitting ? 'Verificando…' : 'Confirmar'}</Button>
        <div className="public-flow-options">
          <button type="button" className="public-flow-link-button" onClick={handleResend} disabled={isResending}>{isResending ? 'Reenviando…' : 'Reenviar código'}</button>
          <button type="button" className="public-flow-link-button" onClick={backToPassword}>Voltar</button>
        </div>
      </form>
    </PublicFlowShell>;
  }

  return <PublicFlowShell title="Acessar conta" titleHidden description="Sistema Integrado de Operação" logoVariant="login" preview={preview}>
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
      {!error && sessionEndReason === 'idle' ? <Alert tone="info">Sua sessão expirou por inatividade. Entre de novo para continuar.</Alert> : null}
      {!error && sessionEndReason === 'expired' ? <Alert tone="info">Sua sessão terminou. Entre de novo para continuar.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {previewMessage ? <Alert tone="info">{previewMessage}</Alert> : null}
      <Button variant="primary" type="submit" loading={isSubmitting} fullWidth>{isSubmitting ? 'Entrando…' : 'Entrar'}</Button>
    </form>
    <div className="public-flow-options"><Link to="/privacidade">Política de privacidade</Link></div>
  </PublicFlowShell>;
}
