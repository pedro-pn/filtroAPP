import type { ClientSigner } from '../types/domain';

export function projectClientFormState(project: {
  clientEmailPrimary?: string;
  clientSignerFirstName?: string;
  clientSignerLastName?: string;
  clientEmailCc?: string[];
  clientSigners?: ClientSigner[];
}) {
  return {
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientSignerFirstName: project.clientSignerFirstName || '',
    clientSignerLastName: project.clientSignerLastName || '',
    clientEmailCc: parseEmailList([...(project.clientEmailCc || []), ...(project.clientSigners || []).map(signer => signer.email)].join('\n')).join('\n'),
    clientSigners: (project.clientSigners || []).map(signer => ({ ...signer, firstName: signerFirstName(signer), lastName: signerLastName(signer) }))
  };
}

export function parseEmailList(value: string) {
  return Array.from(new Set(
    value
      .split(/[\n,;]+/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

export function splitSignerName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

export function signerFirstName(signer: ClientSigner) {
  return signer.firstName || splitSignerName(signer.name).firstName;
}

export function signerLastName(signer: ClientSigner) {
  return signer.lastName || splitSignerName(signer.name).lastName;
}
