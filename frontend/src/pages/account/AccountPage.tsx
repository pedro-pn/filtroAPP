import { FormEvent, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { changePassword, updateAccountEmail, updateAccountNotificationPreferences, type NotificationPreferences } from '../../api/account';
import { exportMyData, requestMyDataDeletion } from '../../api/privacy';
import { useAuth } from '../../auth/AuthContext';
import { accountBackPath } from '../../auth/moduleNavigation';
import { roleHomePath } from '../../auth/rolePath';
import { AppIcon } from '../../components/icons/AppIcon';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Alert, Button, Card, Field, Input, Switch } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { AppShell } from '../../layout/AppShell';
import { createNavigationModel } from '../../layout/navigationModel';
import { PageHeader } from '../../layout/PageHeader';
import { hubModulesForUser } from '../hubModules';
import { downloadBlob } from '../../utils/download';
import './AccountPage.css';

export function AccountPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, replaceUser } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [privacyMessage, setPrivacyMessage] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    reports: user?.notificationPreferences?.reports ?? true,
    signatures: user?.notificationPreferences?.signatures ?? true,
    signatureReminders: user?.notificationPreferences?.signatureReminders ?? true,
    surveyReminders: user?.notificationPreferences?.surveyReminders ?? true,
    calibrationReminders: user?.notificationPreferences?.calibrationReminders ?? true
  });
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [deletionConfirmOpen, setDeletionConfirmOpen] = useState(false);

  const backPath = useMemo(() => accountBackPath(user, location.state, roleHomePath(user?.role)), [location.state, user]);
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const navigation = useMemo(
    () => createNavigationModel({ modules, pathname: location.pathname }),
    [location.pathname, modules]
  );
  const profileInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('')
    : 'U';

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailMessage('');
    setEmailError('');
    setIsSavingEmail(true);
    try {
      const response = await updateAccountEmail(email.trim() || null);
      replaceUser(response.user);
      setEmail(response.user.email || email.trim());
      setEmailMessage(response.emailChangePending
        ? response.message || 'Enviamos um link de confirmação para o novo e-mail.'
        : 'E-mail atualizado com sucesso.');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Falha ao atualizar e-mail.');
    } finally {
      setIsSavingEmail(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordError('');

    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação da nova senha não confere.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Senha alterada com sucesso.');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Falha ao alterar senha.');
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function setNotificationPreference(field: keyof NotificationPreferences, checked: boolean) {
    setNotificationPreferences(current => ({ ...current, [field]: checked }));
  }

  async function handleNotificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotificationMessage('');
    setNotificationError('');
    setIsSavingNotifications(true);
    try {
      const response = await updateAccountNotificationPreferences(notificationPreferences);
      replaceUser(response.user);
      setNotificationPreferences({
        reports: response.user.notificationPreferences?.reports ?? true,
        signatures: response.user.notificationPreferences?.signatures ?? true,
        signatureReminders: response.user.notificationPreferences?.signatureReminders ?? true,
        surveyReminders: response.user.notificationPreferences?.surveyReminders ?? true,
        calibrationReminders: response.user.notificationPreferences?.calibrationReminders ?? true
      });
      setNotificationMessage('Preferências de notificação atualizadas.');
    } catch (err) {
      setNotificationError(err instanceof Error ? err.message : 'Falha ao atualizar notificações.');
    } finally {
      setIsSavingNotifications(false);
    }
  }

  async function handleDataExport() {
    setPrivacyMessage('');
    setPrivacyError('');
    setIsExportingData(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, `meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
      setPrivacyMessage('Exportação de dados gerada.');
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Não foi possível exportar seus dados.');
    } finally {
      setIsExportingData(false);
    }
  }

  async function handleDeletionRequest() {
    setPrivacyMessage('');
    setPrivacyError('');
    setDeletionConfirmOpen(false);
    setIsRequestingDeletion(true);
    try {
      const request = await requestMyDataDeletion();
      setPrivacyMessage(request.protocol ? `Solicitação registrada. Protocolo: ${request.protocol}` : 'Solicitação registrada.');
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Não foi possível registrar a solicitação.');
    } finally {
      setIsRequestingDeletion(false);
    }
  }

  return (
    <AppShell
      navigation={navigation}
      title="Minha conta"
      breadcrumb={[{ label: 'Filtrovali', href: '/modulos' }, { label: 'Conta' }]}
      contentWidth="contained"
      profile={
        user
          ? {
              name: user.name,
              description: user.email || user.username,
              initials: profileInitials
            }
          : undefined
      }
      onLogout={handleLogout}
    >
      <main className="fv-ds account-page">
        <PageHeader
          title="Minha conta"
          description="Gerencie seus dados de acesso, notificações e opções de privacidade."
          breadcrumb={[{ label: 'Conta' }]}
          actions={(
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />}
              onClick={() => navigate(backPath, { replace: true })}
            >
              Voltar
            </Button>
          )}
        />

        <Card className="account-card" padding="md" title="E-mail">
          <form className="account-form" onSubmit={handleEmailSubmit}>
            <Field id="account-email" label="E-mail cadastrado" optionalText="">
              <Input
                id="account-email-control"
                type="email"
                autoComplete="email"
                value={email}
                placeholder="email@empresa.com"
                onChange={event => setEmail(event.target.value)}
              />
            </Field>
            {emailMessage ? <Alert tone="success">{emailMessage}</Alert> : null}
            {emailError ? <Alert tone="danger">{emailError}</Alert> : null}
            <div className="account-form__actions">
              <Button variant="primary" size="sm" type="submit" disabled={isSavingEmail}>
                {isSavingEmail ? 'Salvando...' : 'Salvar e-mail'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="account-card" padding="md" title="Alterar senha">
          <form className="account-form" onSubmit={handlePasswordSubmit}>
            <div className="account-password-fields">
              <Field id="current-password" label="Senha atual" optionalText="" className="account-password-current">
                <Input
                  id="current-password-control"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field id="new-password" label="Nova senha" optionalText="">
                <Input
                  id="new-password-control"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                />
              </Field>
              <Field id="confirm-password" label="Confirmar nova senha" optionalText="">
                <Input
                  id="confirm-password-control"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                />
              </Field>
            </div>
            {passwordMessage ? <Alert tone="success">{passwordMessage}</Alert> : null}
            {passwordError ? <Alert tone="danger">{passwordError}</Alert> : null}
            <div className="account-form__actions">
              <Button variant="primary" size="sm" type="submit" disabled={isSavingPassword}>
                {isSavingPassword ? 'Salvando...' : 'Alterar senha'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="account-card" padding="md" title="Notificações por e-mail">
          <form className="account-form" onSubmit={handleNotificationSubmit}>
            <div className="account-notification-grid">
              <Switch
                id="account-notification-reports"
                label="Relatórios"
                checked={notificationPreferences.reports}
                onChange={event => setNotificationPreference('reports', event.target.checked)}
              />
              <Switch
                id="account-notification-signatures"
                label="Assinaturas"
                checked={notificationPreferences.signatures}
                onChange={event => setNotificationPreference('signatures', event.target.checked)}
              />
              <Switch
                id="account-notification-signature-reminders"
                label="Lembretes de assinatura"
                checked={notificationPreferences.signatureReminders}
                onChange={event => setNotificationPreference('signatureReminders', event.target.checked)}
              />
              <Switch
                id="account-notification-survey-reminders"
                label="Pesquisas de satisfação"
                checked={notificationPreferences.surveyReminders}
                onChange={event => setNotificationPreference('surveyReminders', event.target.checked)}
              />
              <Switch
                id="account-notification-calibration-reminders"
                label="Calibração de equipamentos"
                checked={notificationPreferences.calibrationReminders}
                onChange={event => setNotificationPreference('calibrationReminders', event.target.checked)}
              />
            </div>
            {notificationMessage ? <Alert tone="success">{notificationMessage}</Alert> : null}
            {notificationError ? <Alert tone="danger">{notificationError}</Alert> : null}
            <div className="account-form__actions">
              <Button variant="primary" size="sm" type="submit" disabled={isSavingNotifications}>
                {isSavingNotifications ? 'Salvando...' : 'Salvar notificações'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="account-card account-privacy-card" padding="md" title="Privacidade">
          <p className="account-card__description">
            Exporte os dados associados à sua conta ou registre uma solicitação de eliminação/análise manual.
          </p>
          {privacyMessage ? <Alert tone="success">{privacyMessage}</Alert> : null}
          {privacyError ? <Alert tone="danger">{privacyError}</Alert> : null}
          <div className="account-privacy-actions">
            <Button variant="secondary" size="sm" type="button" onClick={() => void handleDataExport()} disabled={isExportingData}>
              {isExportingData ? 'Gerando...' : 'Exportar meus dados'}
            </Button>
            <Button variant="danger" size="sm" type="button" onClick={() => setDeletionConfirmOpen(true)} disabled={isRequestingDeletion}>
              {isRequestingDeletion ? 'Registrando...' : 'Solicitar eliminação'}
            </Button>
          </div>
        </Card>
        <ConfirmDialog
          open={deletionConfirmOpen}
          appearance="design-system"
          title="Solicitar eliminação de dados?"
          description="A solicitação será registrada para análise manual. Você poderá acompanhar o atendimento pelo protocolo gerado."
          confirmLabel="Registrar solicitação"
          cancelLabel="Voltar"
          danger
          confirmDisabled={isRequestingDeletion}
          onCancel={() => setDeletionConfirmOpen(false)}
          onConfirm={() => void handleDeletionRequest()}
        />
      </main>
    </AppShell>
  );
}
