import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmTwoFactorEnable,
  disableTwoFactor,
  getTwoFactorStatus,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  startTwoFactorEnable
} from '../../api/auth';
import { Alert, Button, Card, Field, Input } from '../../components/ui/ds';
import type { TwoFactorStatus } from '../../types/auth';

const QUERY_KEY = ['auth', 'two-factor'];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
}

// Verificação em duas etapas por e-mail (spec 039): obrigatória para administradores,
// opcional para contas internas.
export function TwoFactorCard() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: QUERY_KEY, queryFn: getTwoFactorStatus });
  const [challengeToken, setChallengeToken] = useState('');
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const status = statusQuery.data;
  if (statusQuery.isLoading || !status || status.requirement === 'NONE') return null;

  async function run(action: () => Promise<TwoFactorStatus | void>, success: string) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const next = await action();
      if (next) queryClient.setQueryData(QUERY_KEY, next);
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStartEnable() {
    await run(async () => {
      const started = await startTwoFactorEnable();
      setChallengeToken(started.challengeToken);
      setCode('');
    }, `Enviamos um código para ${status?.emailHint}. Digite-o abaixo para ativar.`);
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const next = await confirmTwoFactorEnable(challengeToken, code);
      setChallengeToken('');
      setCode('');
      return next;
    }, 'Verificação em duas etapas ativada.');
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const next = await disableTwoFactor(disablePassword);
      setDisablePassword('');
      setShowDisable(false);
      return next;
    }, 'Verificação em duas etapas desativada.');
  }

  return (
    <Card className="account-card" padding="md" title="Verificação em duas etapas">
      <p>
        {status.required
          ? 'Obrigatória para contas de administrador. '
          : status.enabled ? 'Ativa nesta conta. ' : 'Opcional: proteja sua conta pedindo um código enviado por e-mail a cada novo navegador. '}
        {status.enabled ? `O código é enviado para ${status.emailHint}.` : null}
      </p>
      {!status.enforced ? <Alert tone="warning">A verificação em duas etapas está temporariamente desligada no servidor.</Alert> : null}
      {!status.hasEmail ? <Alert tone="warning">Cadastre um e-mail acima para usar a verificação em duas etapas.</Alert> : null}

      {status.canToggle && !status.enabled && !challengeToken ? (
        <Button variant="secondary" onClick={handleStartEnable} disabled={!status.hasEmail || busy} loading={busy}>Ativar</Button>
      ) : null}

      {challengeToken ? (
        <form className="account-form" onSubmit={handleConfirm}>
          <Field id="two-factor-enable-code" label="Código recebido por e-mail" required optionalText={null}>
            <Input value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={7} onChange={event => setCode(event.target.value.replace(/[^\d ]/g, ''))} />
          </Field>
          <Button variant="primary" type="submit" loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>Confirmar ativação</Button>
        </form>
      ) : null}

      {status.canToggle && status.enabled ? (
        showDisable ? (
          <form className="account-form" onSubmit={handleDisable}>
            <Field id="two-factor-disable-password" label="Senha atual" required optionalText={null}>
              <Input type="password" autoComplete="current-password" value={disablePassword} onChange={event => setDisablePassword(event.target.value)} />
            </Field>
            <Button variant="danger" type="submit" loading={busy} disabled={!disablePassword}>Desativar</Button>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowDisable(true)}>Desativar</Button>
        )
      ) : null}

      {status.enabled ? (
        <div className="account-trusted-devices">
          <h3>Navegadores lembrados</h3>
          {status.trustedDevices.length ? (
            <ul>
              {status.trustedDevices.map(device => (
                <li key={device.id}>
                  <span>{device.label} · usado em {formatDate(device.lastUsedAt)} · vale até {formatDate(device.expiresAt)}</span>
                  <Button variant="ghost" size="sm" onClick={() => run(() => revokeTrustedDevice(device.id), 'Navegador removido.')} disabled={busy}>Remover</Button>
                </li>
              ))}
            </ul>
          ) : <p>Nenhum navegador lembrado. O código será pedido em cada novo acesso.</p>}
          {status.trustedDevices.length > 1 ? (
            <Button variant="secondary" size="sm" onClick={() => run(revokeAllTrustedDevices, 'Todos os navegadores foram removidos.')} disabled={busy}>Remover todos</Button>
          ) : null}
        </div>
      ) : null}

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Card>
  );
}
