import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { acceptClientPrivacyConsent } from '../../api/auth';
import { exportMyData, requestMyDataDeletion } from '../../api/privacy';
import { useAuth } from '../../auth/AuthContext';
import { CLIENT_PRIVACY_NOTICE_VERSION } from '../../constants/privacy';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { useToast } from '../../components/ui/ToastContext';
import { downloadBlob } from '../../utils/download';

export function ClientPrivacyConsentPage() {
  const { logout, replaceUser, user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);

  async function handleAccept() {
    if (!accepted || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updatedUser = await acceptClientPrivacyConsent({
        privacyNoticeAccepted: true,
        privacyNoticeVersion: CLIENT_PRIVACY_NOTICE_VERSION
      });
      replaceUser(updatedUser);
      showToast('Termo de privacidade aceito.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar o aceite.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleDataExport() {
    setIsExportingData(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, `meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
      showToast('Exportação de dados gerada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível exportar seus dados.', 'error');
    } finally {
      setIsExportingData(false);
    }
  }

  async function handleDeletionRequest() {
    if (!window.confirm('Registrar solicitação de eliminação/análise manual dos seus dados?')) return;
    setIsRequestingDeletion(true);
    try {
      const request = await requestMyDataDeletion();
      showToast(request.protocol ? `Solicitação registrada. Protocolo: ${request.protocol}` : 'Solicitação registrada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar a solicitação.', 'error');
    } finally {
      setIsRequestingDeletion(false);
    }
  }

  return (
    <main className="client-privacy-page">
      <section className="client-privacy-panel" aria-labelledby="client-privacy-title">
        <div className="client-privacy-heading">
          <div>
            <div className="section-title" id="client-privacy-title">Privacidade</div>
            <h1>Antes de continuar</h1>
          </div>
          <span>{user?.name || 'Cliente'}</span>
        </div>
        <PrivacyNotice
          variant="clientAccount"
          checked={accepted}
          onCheckedChange={setAccepted}
          disabled={isSubmitting}
        />
        <Link className="auth-link" to="/privacidade" target="_blank" rel="noopener noreferrer">
          Ler política de privacidade completa
        </Link>
        <div className="client-privacy-rights">
          <button className="secondary-button" type="button" onClick={() => void handleDataExport()} disabled={isExportingData}>
            {isExportingData ? 'Gerando...' : 'Exportar meus dados'}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleDeletionRequest()} disabled={isRequestingDeletion}>
            {isRequestingDeletion ? 'Registrando...' : 'Solicitar eliminação'}
          </button>
        </div>
        <div className="client-privacy-actions">
          <button className="secondary-button" type="button" onClick={handleLogout} disabled={isSubmitting}>
            Sair
          </button>
          <button className="primary-button" type="button" onClick={() => void handleAccept()} disabled={!accepted || isSubmitting}>
            {isSubmitting ? 'Registrando...' : 'Aceitar e continuar'}
          </button>
        </div>
      </section>
    </main>
  );
}
