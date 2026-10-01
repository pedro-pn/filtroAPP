import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { getResetPasswordStatus, resendPasswordSetup, resetPassword } from '../api/auth';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Field, Input, Spinner } from '../components/ui/ds';
import './AuthPasswordPage.css';

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
    void loadStatus();
    return () => { mounted = false; };
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

  return <main className="fv-ds auth-access-page">
    <section className="auth-access-card" aria-labelledby="auth-access-title">
      <header className="auth-access-header">
        <BrandLogo className="auth-access-logo" />
        <h1 id="auth-access-title">{isAccountSetup ? 'Criar senha' : 'Redefinir senha'}</h1>
        <p>{isAccountSetup ? 'Defina a senha para acessar sua conta.' : 'Escolha uma nova senha para acessar sua conta.'}</p>
      </header>

      {status === 'loading' ? <div className="auth-access-loading" role="status">
        <Spinner decorative /> Validando link...
      </div> : null}

      {status === 'invalid' ? <div className="auth-access-content">
        <Alert tone="danger" title="Link indisponível">O link é inválido, expirou ou já foi utilizado.</Alert>
        {isAccountSetup && canRequestNewLink && !resendMessage ? <Button
          variant="primary" type="button" loading={isResending} onClick={() => void handleRequestNewLink()}
        >{isResending ? 'Enviando...' : 'Enviar um novo link ao meu e-mail'}</Button> : null}
        {resendMessage ? <Alert tone="success">{resendMessage}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Link className="fv-button fv-button--secondary fv-button--md auth-access-back" to="/login">Voltar ao login</Link>
      </div> : null}

      {status === 'valid' && message ? <div className="auth-access-content">
        <Alert tone="success" title={message}>Redirecionando para o login...</Alert>
        <Link className="fv-button fv-button--secondary fv-button--md auth-access-back" to="/login">Ir para o login agora</Link>
      </div> : null}

      {status === 'valid' && !message ? <form className="auth-access-form" onSubmit={handleSubmit}>
        {username ? <div className="auth-access-username">
          <span>Seu usuário</span><strong>{username}</strong>
        </div> : null}
        <Field id="new-password" label="Nova senha" helperText="Use pelo menos 6 caracteres." optionalText={null} required>
          <Input type="password" value={password} onChange={event => setPassword(event.target.value)}
            minLength={6} autoComplete="new-password" required />
        </Field>
        <Field id="confirm-password" label="Confirmar nova senha" optionalText={null} required>
          <Input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
            minLength={6} autoComplete="new-password" required />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button variant="primary" type="submit" loading={isSaving}>
          {isSaving ? 'Salvando...' : isAccountSetup ? 'Criar senha' : 'Salvar nova senha'}
        </Button>
      </form> : null}
    </section>
  </main>;
}
