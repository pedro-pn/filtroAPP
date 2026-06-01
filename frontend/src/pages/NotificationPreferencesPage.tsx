import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  getNotificationPreferenceStatus,
  updatePublicNotificationPreferences,
  type NotificationPreferences
} from '../api/account';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function NotificationPreferencesPage() {
  const params = useParams();
  const token = useMemo(() => params.token || '', [params.token]);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'saved'>('loading');
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    reports: true,
    signatures: true,
    surveyReminders: true
  });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!token) {
        if (mounted) setStatus('invalid');
        return;
      }
      try {
        const data = await getNotificationPreferenceStatus(token);
        if (!mounted) return;
        if (!data.valid || !data.preferences) {
          setStatus('invalid');
          return;
        }
        setUserName(data.userName || '');
        setEmail(data.email || '');
        setPreferences(data.preferences);
        setStatus('valid');
      } catch {
        if (mounted) setStatus('invalid');
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [token]);

  function setPreference(field: keyof NotificationPreferences, checked: boolean) {
    setPreferences(current => ({ ...current, [field]: checked }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      const response = await updatePublicNotificationPreferences(token, preferences);
      setPreferences(response.preferences);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar preferências.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
        </div>
        <div className="section-title">Notificações por e-mail</div>
        {status === 'loading' ? <p className="placeholder-copy">Validando link...</p> : null}
        {status === 'invalid' ? <div className="inline-error">Link inválido, expirado ou já utilizado.</div> : null}
        {status === 'valid' ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="placeholder-copy">{userName || email}</p>
            <label className="notification-option">
              <input type="checkbox" checked={preferences.reports} onChange={event => setPreference('reports', event.target.checked)} />
              <span>Relatórios</span>
            </label>
            <label className="notification-option">
              <input type="checkbox" checked={preferences.signatures} onChange={event => setPreference('signatures', event.target.checked)} />
              <span>Assinaturas</span>
            </label>
            <label className="notification-option">
              <input type="checkbox" checked={preferences.surveyReminders} onChange={event => setPreference('surveyReminders', event.target.checked)} />
              <span>Pesquisas de satisfação</span>
            </label>
            {error ? <div className="inline-error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar preferências'}
            </button>
          </form>
        ) : null}
        {status === 'saved' ? (
          <div className="auth-form">
            <div className="inline-success">Preferências atualizadas. Este link não pode ser usado novamente.</div>
            <Link className="secondary-button auth-back-button" to="/login">Ir para login</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
