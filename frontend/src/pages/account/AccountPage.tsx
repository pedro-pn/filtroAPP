import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { changePassword, updateAccountEmail } from '../../api/account';
import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/rolePath';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';

export function AccountPage() {
  const navigate = useNavigate();
  const { user, logout, replaceUser } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const backPath = useMemo(() => roleHomePath(user?.role), [user?.role]);

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailMessage('');
    setEmailError('');
    setIsSavingEmail(true);
    try {
      const updatedUser = await updateAccountEmail(email.trim() || null);
      replaceUser(updatedUser);
      setEmail(updatedUser.email || '');
      setEmailMessage('E-mail atualizado com sucesso.');
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

  return (
    <Shell>
      <TopBar
        title="Conta"
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate(backPath)}>
              Voltar
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">E-mail</div>
          <form className="auth-form" onSubmit={handleEmailSubmit}>
            <div className="field-group">
              <label htmlFor="account-email">E-mail cadastrado</label>
              <input
                id="account-email"
                type="email"
                value={email}
                placeholder="email@empresa.com"
                onChange={event => setEmail(event.target.value)}
              />
            </div>
            {emailMessage ? <div className="inline-success">{emailMessage}</div> : null}
            {emailError ? <div className="inline-error">{emailError}</div> : null}
            <button className="primary-button" type="submit" disabled={isSavingEmail}>
              {isSavingEmail ? 'Salvando...' : 'Salvar e-mail'}
            </button>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Alterar senha</div>
          <form className="auth-form" onSubmit={handlePasswordSubmit}>
            <div className="field-group">
              <label htmlFor="current-password">Senha atual</label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="new-password">Nova senha</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="confirm-password">Confirmar nova senha</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
              />
            </div>
            {passwordMessage ? <div className="inline-success">{passwordMessage}</div> : null}
            {passwordError ? <div className="inline-error">{passwordError}</div> : null}
            <button className="primary-button" type="submit" disabled={isSavingPassword}>
              {isSavingPassword ? 'Salvando...' : 'Alterar senha'}
            </button>
          </form>
        </section>
      </main>
    </Shell>
  );
}
