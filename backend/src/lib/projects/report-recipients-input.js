// Mesma sintaxe de e-mail padrão do Zod, sem carregar pacotes nos helpers
// de planejamento que também são consumidos pelo frontend.
const emailPattern = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const validEmail = value => typeof value === 'string' && emailPattern.test(value.trim());

export function projectReportRecipientsInput(project = {}) {
  return {
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientSignerFirstName: project.clientSignerFirstName || '',
    clientSignerLastName: project.clientSignerLastName || '',
    clientEmailCc: project.clientEmailCc || [],
    clientSigners: Array.isArray(project.clientSigners) ? project.clientSigners.map(signer => {
      const parts = String(signer?.name || '').trim().split(/\s+/).filter(Boolean);
      return {
        ...signer,
        firstName: signer?.firstName || parts[0] || '',
        lastName: signer?.lastName || parts.slice(1).join(' ')
      };
    }) : project.clientSigners || []
  };
}

export function projectReportRecipientsIssues(project) {
  const data = projectReportRecipientsInput(project);
  const issues = [];
  if (!validEmail(data.clientEmailPrimary)) issues.push('Cadastrar um e-mail principal válido para receber os relatórios');
  const copies = new Set(Array.isArray(data.clientEmailCc) ? data.clientEmailCc.map(email => String(email).trim().toLowerCase()) : []);
  const seen = new Set();
  const invalidSigner = !Array.isArray(data.clientSigners) || data.clientSigners.some(signer => {
    const email = String(signer.email || '').trim().toLowerCase();
    const invalid = !validEmail(email) || !copies.has(email) || email === String(data.clientEmailPrimary).trim().toLowerCase()
      || !String(signer.firstName || '').trim() || !String(signer.lastName || '').trim() || seen.has(email);
    seen.add(email);
    return invalid;
  });
  if (!Array.isArray(data.clientEmailCc) || data.clientEmailCc.some(email => !validEmail(email)) || invalidSigner) {
    issues.push('Revisar os e-mails em cópia e os nomes dos assinantes dos relatórios');
  }
  return issues;
}
