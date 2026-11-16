export function makeProjectReportRecipientsSchema(z, extraFields = {}) {
  const email = z.string().trim().email('Informe um e-mail válido.').transform(value => value.toLowerCase());
  return z.object({
    ...extraFields,
    clientEmailPrimary: email,
    clientSignerFirstName: z.string().trim().default(''),
    clientSignerLastName: z.string().trim().default(''),
    clientEmailCc: z.array(email).default([]),
    clientSigners: z.array(z.object({
      email,
      firstName: z.string().trim().min(1, 'Informe o nome do assinante.'),
      lastName: z.string().trim().min(1, 'Informe o sobrenome do assinante.'),
      name: z.string().trim().default(''),
      signsServiceReports: z.boolean().default(true)
    })).default([])
  }).strict().superRefine((value, ctx) => {
    const copies = new Set(value.clientEmailCc);
    const signers = new Set();
    value.clientSigners.forEach((signer, index) => {
      if (!copies.has(signer.email) || signer.email === value.clientEmailPrimary) {
        ctx.addIssue({ code: 'custom', path: ['clientSigners', index, 'email'], message: 'O assinante deve ser um dos e-mails em cópia.' });
      }
      if (signers.has(signer.email)) {
        ctx.addIssue({ code: 'custom', path: ['clientSigners', index, 'email'], message: 'Este assinante já foi adicionado.' });
      }
      signers.add(signer.email);
    });
  });
}

export function normalizeProjectReportRecipients(data) {
  const primary = data.clientEmailPrimary.trim().toLowerCase();
  return {
    clientEmailPrimary: primary,
    clientSignerFirstName: data.clientSignerFirstName.trim(),
    clientSignerLastName: data.clientSignerLastName.trim(),
    clientEmailCc: [...new Set(data.clientEmailCc.map(email => email.trim().toLowerCase()))].filter(email => email !== primary),
    clientSigners: data.clientSigners.map(signer => ({
      ...signer,
      email: signer.email.trim().toLowerCase(),
      firstName: signer.firstName.trim(),
      lastName: signer.lastName.trim(),
      name: `${signer.firstName.trim()} ${signer.lastName.trim()}`
    }))
  };
}
