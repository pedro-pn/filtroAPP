import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { NotificationConfig } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import {
  useNotificationAccounts,
  useNotificationConfig,
  useNotificationMutations,
  useNotificationRecipients
} from '../../hooks/useEquipamentos';

export function NotificationsConfig() {
  const configQuery = useNotificationConfig();
  const recipientsQuery = useNotificationRecipients();
  const accountsQuery = useNotificationAccounts();
  const { updateConfig, addRecipient, setActive, removeRecipient } = useNotificationMutations();
  const showToast = useToast();

  const [draft, setDraft] = useState<NotificationConfig | null>(null);
  const [milestonesText, setMilestonesText] = useState('');
  const [accountId, setAccountId] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (configQuery.data && !draft) {
      setDraft(configQuery.data);
      setMilestonesText(configQuery.data.milestoneDays.join(', '));
    }
  }, [configQuery.data, draft]);

  const recipients = useMemo(() => recipientsQuery.data || [], [recipientsQuery.data]);
  const linkedEmails = useMemo(() => new Set(recipients.map(r => r.email.toLowerCase())), [recipients]);
  const availableAccounts = (accountsQuery.data || []).filter(account => !linkedEmails.has(account.email.toLowerCase()));

  function patch(partial: Partial<NotificationConfig>) {
    setDraft(current => (current ? { ...current, ...partial } : current));
  }

  function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const milestoneDays = Array.from(new Set(
      milestonesText.split(',').map(part => Math.trunc(Number(part.trim()))).filter(value => Number.isFinite(value) && value > 0)
    )).sort((a, b) => b - a);
    updateConfig.mutate({ ...draft, milestoneDays }, {
      onSuccess: config => { setMilestonesText(config.milestoneDays.join(', ')); showToast('Configuração salva.', 'success'); },
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
    });
  }

  function handleAddAccount() {
    if (!accountId) return;
    addRecipient.mutate({ userId: accountId }, {
      onSuccess: () => { setAccountId(''); showToast('Destinatário adicionado.', 'success'); },
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível adicionar.', 'error')
    });
  }

  function handleAddEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    addRecipient.mutate({ email: value }, {
      onSuccess: () => { setEmail(''); showToast('E-mail adicionado.', 'success'); },
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível adicionar.', 'error')
    });
  }

  return (
    <>
      <section className="page-card">
        <div className="admin-toolbar"><div className="sec">Notificações de calibração</div></div>
        {draft && (
          <form className="equip-notif-config" onSubmit={saveConfig}>
            <label className="equip-toggle">
              <input type="checkbox" checked={draft.enabled} onChange={e => patch({ enabled: e.target.checked })} />
              <span>Enviar e-mails de calibração</span>
            </label>

            <div className={`equip-notif-fields ${draft.enabled ? '' : 'disabled'}`}>
              <div className="field-group">
                <label htmlFor="notif-milestones">Avisar quantos dias antes do vencimento</label>
                <input
                  id="notif-milestones"
                  type="text"
                  value={milestonesText}
                  placeholder="ex.: 30, 15, 7"
                  disabled={!draft.enabled}
                  onChange={e => setMilestonesText(e.target.value)}
                />
                <small className="rel-meta">Separe por vírgula. Um e-mail é enviado quando faltarem exatamente esses dias.</small>
              </div>

              <label className="equip-toggle">
                <input type="checkbox" checked={draft.notifyOnDueDay} disabled={!draft.enabled} onChange={e => patch({ notifyOnDueDay: e.target.checked })} />
                <span>Avisar no dia do vencimento</span>
              </label>

              <label className="equip-toggle">
                <input type="checkbox" checked={draft.repeatExpired} disabled={!draft.enabled} onChange={e => patch({ repeatExpired: e.target.checked })} />
                <span>Repetir aviso enquanto estiver expirado</span>
              </label>

              {draft.repeatExpired && (
                <div className="field-group">
                  <label htmlFor="notif-gap">Intervalo da repetição (dias)</label>
                  <input
                    id="notif-gap"
                    type="number"
                    min={1}
                    value={draft.repeatGapDays}
                    disabled={!draft.enabled}
                    onChange={e => patch({ repeatGapDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
              )}
            </div>

            <div className="admin-form-actions equip-form-actions">
              <button className="mini-btn" type="submit" disabled={updateConfig.isPending}>{updateConfig.isPending ? 'Salvando…' : 'Salvar configuração'}</button>
            </div>
          </form>
        )}
      </section>

      <section className="page-card">
        <div className="admin-toolbar"><div className="sec">Destinatários</div></div>
        <p className="rel-meta equip-slots-hint">Quem recebe os e-mails de calibração: contas internas ou e-mails avulsos.</p>

        <div className="equip-notif-add">
          <div className="field-group">
            <label htmlFor="notif-account">Adicionar conta interna</label>
            <div className="equip-notif-inline">
              <select id="notif-account" value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">Selecione uma conta…</option>
                {availableAccounts.map(account => (
                  <option key={account.id} value={account.id}>{account.name} — {account.email}</option>
                ))}
              </select>
              <button className="mini-btn alt" type="button" disabled={!accountId || addRecipient.isPending} onClick={handleAddAccount}>Adicionar</button>
            </div>
          </div>

          <form className="field-group" onSubmit={handleAddEmail}>
            <label htmlFor="notif-email">Adicionar e-mail avulso</label>
            <div className="equip-notif-inline">
              <input id="notif-email" type="email" value={email} placeholder="email@empresa.com" onChange={e => setEmail(e.target.value)} />
              <button className="mini-btn alt" type="submit" disabled={!email.trim() || addRecipient.isPending}>Adicionar</button>
            </div>
          </form>
        </div>

        {recipients.length === 0 && <p className="rel-meta">Nenhum destinatário cadastrado — nenhum e-mail será enviado.</p>}
        <ul className="equip-notif-list">
          {recipients.map(recipient => (
            <li className={`equip-notif-item ${recipient.isActive ? '' : 'off'}`} key={recipient.id}>
              <span className="equip-notif-email">{recipient.email}</span>
              <span className="equip-notif-tag">{recipient.userId ? 'Conta' : 'Avulso'}</span>
              <label className="equip-toggle compact">
                <input
                  type="checkbox"
                  checked={recipient.isActive}
                  onChange={e => setActive.mutate({ id: recipient.id, isActive: e.target.checked })}
                />
                <span>Ativo</span>
              </label>
              <button className="mini-btn danger" type="button" onClick={() => removeRecipient.mutate(recipient.id)}>Remover</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
