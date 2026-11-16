import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import type { ClientSigner } from '../../types/domain';
import { parseEmailList, signerFirstName, signerLastName } from '../../utils/projectClientContacts';
import { Button } from '../ui/ds';

export interface ProjectClientFormState {
  clientEmailPrimary: string;
  clientSignerFirstName: string;
  clientSignerLastName: string;
  clientEmailCc: string;
  clientSigners: ClientSigner[];
}

export function ProjectClientFields<T extends ProjectClientFormState>({
  form,
  idPrefix,
  setForm,
  required = false
}: {
  form: T;
  idPrefix: string;
  required?: boolean;
  setForm: Dispatch<SetStateAction<T>>;
}) {
  const ccEmails = parseEmailList(form.clientEmailCc);
  const signerByEmail = new Map(form.clientSigners.map(signer => [signer.email.trim().toLowerCase(), signer]));

  function setCcEmails(values: string[]) {
    const nextEmails = parseEmailList(values.join('\n'));
    const nextEmailSet = new Set(nextEmails);

    setForm(current => ({
      ...current,
      clientEmailCc: nextEmails.join('\n'),
      clientSigners: current.clientSigners.filter(signer => nextEmailSet.has(signer.email.trim().toLowerCase()))
    }));
  }

  function commitCcInput(input: HTMLInputElement | null) {
    if (!input) return;
    const nextEmails = parseEmailList(input.value);
    input.value = '';
    if (!nextEmails.length) return;
    setCcEmails([...ccEmails, ...nextEmails]);
  }

  function handleCcInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      commitCcInput(event.currentTarget);
    }
  }

  function toggleSigner(email: string) {
    setForm(current => {
      const normalizedEmail = email.trim().toLowerCase();
      const isSigner = current.clientSigners.some(signer => signer.email.trim().toLowerCase() === normalizedEmail);
      return {
        ...current,
        clientSigners: isSigner
          ? current.clientSigners.filter(signer => signer.email.trim().toLowerCase() !== normalizedEmail)
          : [...current.clientSigners, { email: normalizedEmail, firstName: '', lastName: '', name: '' }]
      };
    });
  }

  function updateSignerNamePart(email: string, key: 'firstName' | 'lastName', value: string) {
    setForm(current => ({
      ...current,
      clientSigners: current.clientSigners.map(signer => (
        signer.email.trim().toLowerCase() === email
          ? {
              ...signer,
              [key]: value,
              name: [
                key === 'firstName' ? value : signerFirstName(signer),
                key === 'lastName' ? value : signerLastName(signer)
              ].map(part => part.trim()).filter(Boolean).join(' ')
            }
          : signer
      ))
    }));
  }

  return (
    <>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-email-primary`}>E-mail principal do cliente{required ? ' *' : ''}</label>
        <input
          id={`${idPrefix}-client-email-primary`}
          type="email"
          required={required}
          value={form.clientEmailPrimary}
          onChange={event => setForm(current => ({ ...current, clientEmailPrimary: event.target.value }))}
        />
      </div>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-signer-first-name`}>Nome do signatário principal</label>
        <input
          id={`${idPrefix}-client-signer-first-name`}
          type="text"
          value={form.clientSignerFirstName}
          placeholder="Nome"
          onChange={event => setForm(current => ({ ...current, clientSignerFirstName: event.target.value }))}
        />
      </div>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-signer-last-name`}>Sobrenome do signatário principal</label>
        <input
          id={`${idPrefix}-client-signer-last-name`}
          type="text"
          value={form.clientSignerLastName}
          placeholder="Sobrenome"
          onChange={event => setForm(current => ({ ...current, clientSignerLastName: event.target.value }))}
        />
      </div>
      <div className="field-group field-group-wide">
        <label htmlFor={`${idPrefix}-client-email-cc-input`}>E-mails em cópia</label>
        <div className="cc-list">
          {ccEmails.length ? (
            <div className="cc-list-header">
              <span>E-mail</span>
              <span>Assinante?</span>
            </div>
          ) : null}
          {ccEmails.map(email => {
            const signer = signerByEmail.get(email);
            return (
              <div className="cc-row" key={email}>
                <div className="cc-row-main">
                  <div className="cc-email">{email}</div>
                  <div className="cc-row-actions">
                    <label className="tog">
                      <input type="checkbox" aria-label={`Assinante: ${email}`} checked={Boolean(signer)} onChange={() => toggleSigner(email)} />
                      <span className="tog-sl" />
                    </label>
                    <button
                      className="email-chip-rm"
                      type="button"
                      aria-label={`Remover e-mail ${email}`}
                      onClick={() => setCcEmails(ccEmails.filter(item => item !== email))}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {signer ? (
                  <div className="cc-name-row">
                    <label>
                      <span>Nome</span>
                      <input
                        className="cc-name-input"
                        type="text"
                        value={signerFirstName(signer)}
                        placeholder="Nome"
                        required
                        onChange={event => updateSignerNamePart(email, 'firstName', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Sobrenome</span>
                      <input
                        className="cc-name-input"
                        type="text"
                        value={signerLastName(signer)}
                        placeholder="Sobrenome"
                        required
                        onChange={event => updateSignerNamePart(email, 'lastName', event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="cc-add-row">
            <input
              id={`${idPrefix}-client-email-cc-input`}
              type="text"
              placeholder="Digite um e-mail..."
              onKeyDown={handleCcInputKeyDown}
              onBlur={event => commitCcInput(event.currentTarget)}
            />
            <Button variant="primary" size="sm" type="button" onClick={event => {
              const input = event.currentTarget.parentElement?.querySelector('input');
              commitCcInput(input || null);
            }}>
              + Adicionar
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
