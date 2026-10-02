import { BrandLoading } from '../components/brand/BrandLoading';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { getNotificationPreferenceStatus, updatePublicNotificationPreferences, type NotificationPreferences } from '../api/account';
import { Alert, Button, Switch } from '../components/ui/ds';
import { PublicFlowShell } from './PublicFlowShell';

const preferenceOptions: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  { key: 'reports', label: 'Relatórios', description: 'Novos relatórios e atualizações importantes.' },
  { key: 'signatures', label: 'Assinaturas', description: 'Convites e confirmação de documentos.' },
  { key: 'signatureReminders', label: 'Lembretes de assinatura', description: 'Avisos sobre assinaturas pendentes.' },
  { key: 'surveyReminders', label: 'Pesquisas de satisfação', description: 'Convites e lembretes para responder pesquisas.' },
  { key: 'calibrationReminders', label: 'Calibração de equipamentos', description: 'Alertas de vencimento de calibração.' }
];

export function NotificationPreferencesPage() {
  const params = useParams();
  const location = useLocation();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('visualizar') === '1';
  const token = useMemo(() => params.token || '', [params.token]);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'saved'>(preview ? 'valid' : 'loading');
  const [userName, setUserName] = useState(preview ? 'Marina Costa' : '');
  const [email, setEmail] = useState(preview ? 'marina@exemplo.com' : '');
  const [preferences, setPreferences] = useState<NotificationPreferences>({ reports: true, signatures: true, signatureReminders: true, surveyReminders: true, calibrationReminders: true });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (preview) return;
    let mounted = true;
    async function load() {
      if (!token) { if (mounted) setStatus('invalid'); return; }
      try {
        const data = await getNotificationPreferenceStatus(token);
        if (!mounted) return;
        if (!data.valid || !data.preferences) { setStatus('invalid'); return; }
        setUserName(data.userName || '');
        setEmail(data.email || '');
        setPreferences(data.preferences);
        setStatus('valid');
      } catch { if (mounted) setStatus('invalid'); }
    }
    void load();
    return () => { mounted = false; };
  }, [preview, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (preview) { setStatus('saved'); return; }
    setIsSaving(true);
    try {
      const response = await updatePublicNotificationPreferences(token, preferences);
      setPreferences(response.preferences);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar preferências.');
    } finally { setIsSaving(false); }
  }

  return <PublicFlowShell title="Notificações por e-mail" description="Escolha quais comunicados você quer receber." preview={preview}>
    {status === 'loading' ? <BrandLoading label="Validando link" /> : null}
    {status === 'invalid' ? <Alert tone="danger">Link inválido, expirado ou já utilizado.</Alert> : null}
    {status === 'valid' ? <form className="public-flow-form" onSubmit={handleSubmit}>
      <div className="public-flow-context"><strong>{userName || email}</strong>{userName && email ? <small>{email}</small> : null}</div>
      <div className="public-flow-preferences">
        {preferenceOptions.map(option => <Switch key={option.key} label={option.label} description={option.description} checked={preferences[option.key]} onChange={event => setPreferences(current => ({ ...current, [option.key]: event.target.checked }))} />)}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button variant="primary" type="submit" loading={isSaving} fullWidth>{isSaving ? 'Salvando…' : 'Salvar preferências'}</Button>
    </form> : null}
    {status === 'saved' ? <><Alert tone="success">Preferências atualizadas. Este link não pode ser usado novamente.</Alert><Link className="fv-button fv-button--secondary fv-button--md public-flow-back" to="/login">Ir para login</Link></> : null}
  </PublicFlowShell>;
}
