import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { acceptClientPrivacyConsent } from '../../api/auth';
import { exportMyData, requestMyDataDeletion } from '../../api/privacy';
import { useAuth } from '../../auth/AuthContext';
import { CLIENT_PRIVACY_NOTICE_VERSION } from '../../constants/privacy';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { Button, Card } from '../../components/ui/ds';
import { useToast } from '../../components/ui/ToastContext';
import { useConfirmDialog } from '../../components/ui/useConfirmDialog';
import { downloadBlob } from '../../utils/download';
import '../RdoPublicPage.css';

export function ClientPrivacyConsentPage() {
  const { logout, replaceUser, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
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
    const confirmed = await confirm({
      title: 'Solicitar eliminação dos seus dados?',
      description: 'A solicitação é registrada para análise manual e você recebe um protocolo de acompanhamento.',
      confirmLabel: 'Registrar solicitação'
    });
    if (!confirmed) return;
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
    <main className="fv-ds rdo-public-shell client-privacy-page" data-fv-ds>
      <header className="rdo-public-header">
        <BrandLogo className="rdo-public-logo" />
      </header>
      <Card className="rdo-public-card client-privacy-panel" padding="lg" aria-labelledby="client-privacy-title">
        <div className="client-privacy-heading rdo-consent-heading">
          <div>
            <span className="rdo-consent-eyebrow">Privacidade</span>
            <h1 id="client-privacy-title">Antes de continuar</h1>
          </div>
          <span className="rdo-consent-user">{user?.name || 'Cliente'}</span>
        </div>
        <PrivacyNotice
          variant="clientAccount"
          checked={accepted}
          onCheckedChange={setAccepted}
          disabled={isSubmitting}
        />
        <Link className="rdo-consent-link" to="/privacidade" target="_blank" rel="noopener noreferrer">
          Ler política de privacidade completa
        </Link>
        <div className="client-privacy-rights">
          <Button size="sm" variant="secondary" type="button" loading={isExportingData} onClick={() => void handleDataExport()}>
            {isExportingData ? 'Gerando...' : 'Exportar meus dados'}
          </Button>
          <Button size="sm" variant="secondary" type="button" disabled={isRequestingDeletion} onClick={() => void handleDeletionRequest()}>
            {isRequestingDeletion ? 'Registrando...' : 'Solicitar eliminação'}
          </Button>
        </div>
        <div className="client-privacy-actions">
          <Button size="sm" variant="secondary" type="button" onClick={handleLogout} disabled={isSubmitting}>
            Sair
          </Button>
          <Button size="sm" variant="primary" type="button" loading={isSubmitting} onClick={() => void handleAccept()} disabled={!accepted}>
            {isSubmitting ? 'Registrando...' : 'Aceitar e continuar'}
          </Button>
        </div>
      </Card>
      {confirmDialog}
    </main>
  );
}
