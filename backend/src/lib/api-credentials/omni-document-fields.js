export const REPORT_PDF_SCOPE = 'rdo.relatorios.pdf.download';
export const CORPORATE_CONTACT_SCOPE = 'colaboradores.contato_corporativo.read';

export const REPORT_PDF_FIELDS = { fields: { pdf: 'object' },
  fieldSchemas: { pdf: { type: 'object', additionalProperties: false, required: ['disponivel'], properties: {
    disponivel: { type: 'boolean' }, versao: { type: 'string', enum: ['FINAL_ASSINADO', 'ZAPSIGN', 'MANUAL', 'BASE_APROVADO', 'CACHE'] },
    nomeArquivo: { type: 'string' }, atualizadoEm: { type: ['string', 'null'], format: 'date-time' },
    maintenanceAttachmentIds: { type: 'array', items: { type: 'string' } }
  } } },
  select: { specialConditions: true, zapsignDocToken: true, zapsignDocUrl: true,
    project: { select: { id: true, code: true, name: true } },
    services: { select: { equipmentId: true, system: true, extraData: true } },
    versions: { where: { status: 'ACTIVE' }, orderBy: { versionNumber: 'desc' }, take: 1,
      select: { status: true, sourcePdfUrl: true, sourceDocumentHash: true, finalPdfUrl: true, createdAt: true } }
  }
};

export const CORPORATE_CONTACT_FIELDS = { fields: { emailCorporativo: 'string?', userId: 'string?' },
  select: { user: { select: { id: true, email: true } } }
};
