import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { confirmEmailChange, getEmailChangeStatus } from '../api/account';
import { Alert, Button } from '../components/ui/ds';
import { PublicFlowShell } from './PublicFlowShell';

export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV && searchParams.get('visualizar') === '1';
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'confirmed'>(preview ? 'valid' : 'loading');
  const [email, setEmail] = useState(preview ? 'novo.email@exemplo.com' : '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (preview) return;
    let mounted = true;
    async function loadStatus() {
      if (!token) { if (mounted) setStatus('invalid'); return; }
      try {
        const data = await getEmailChangeStatus(token);
        if (!mounted) return;
        setEmail(data.email || '');
        setStatus(data.valid ? 'valid' : 'invalid');
      } catch { if (mounted) setStatus('invalid'); }
    }
    void loadStatus();
    return () => { mounted = false; };
  }, [preview, token]);

  async function handleConfirm() {
    if (submitting) return;
    setError('');
    if (preview) { setStatus('confirmed'); return; }
    setSubmitting(true);
    try {
      await confirmEmailChange(token);
      setStatus('confirmed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao confirmar e-mail.');
    } finally { setSubmitting(false); }
  }

  return <PublicFlowShell title="Confirmar e-mail" description="Confirme a alteração do endereço da sua conta." preview={preview}>
    {status === 'loading' ? <p>Validando link…</p> : null}
    {status === 'invalid' ? <Alert tone="danger">Link inválido, expirado ou já utilizado.</Alert> : null}
    {status === 'valid' ? <div className="public-flow-form">
      <div className="public-flow-context"><span>Novo endereço</span><strong>{email || 'E-mail informado'}</strong></div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button variant="primary" type="button" onClick={() => void handleConfirm()} loading={submitting} fullWidth>Confirmar e-mail</Button>
    </div> : null}
    {status === 'confirmed' ? <><Alert tone="success">E-mail confirmado com sucesso.</Alert><Link className="fv-button fv-button--secondary fv-button--md public-flow-back" to="/login">Ir para login</Link></> : null}
  </PublicFlowShell>;
}
