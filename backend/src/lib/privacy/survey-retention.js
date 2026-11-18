// LGPD — pesquisa de satisfação: o ROPA declara "respostas por 2 anos".
// Depois de 2 anos da resposta (ou do envio, quando não houve resposta):
// e-mail do destinatário, notas de acompanhamento, IP/User-Agent e as respostas
// de texto livre são apagados. Notas numéricas (NPS/escala) e escolhas
// continuam, sem vínculo com uma pessoa, para os indicadores históricos.

export const SURVEY_RESPONSE_RETENTION_DAYS = 730;
export const ANONYMIZED_SURVEY_EMAIL = '[anonimizado]';
const DAY_MS = 24 * 60 * 60 * 1000;
// Perguntas de texto do questionário padrão (pesquisas sem `questions` salvo).
const DEFAULT_TEXT_QUESTION_IDS = ['improvement', 'highlight'];

export function surveyResponseRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - SURVEY_RESPONSE_RETENTION_DAYS * DAY_MS);
}

export function surveyResponseRetentionWhere(cutoff) {
  return {
    NOT: { emailTo: ANONYMIZED_SURVEY_EMAIL },
    OR: [
      { respondedAt: { lt: cutoff } },
      { respondedAt: null, sentAt: { lt: cutoff } }
    ]
  };
}

export function textQuestionIds(questions) {
  if (!Array.isArray(questions) || !questions.length) return DEFAULT_TEXT_QUESTION_IDS;
  return questions.filter(question => question?.type === 'TEXT' && question.id).map(question => question.id);
}

export function stripFreeTextResponses(responses, questions) {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) return responses ?? null;
  const textIds = new Set(textQuestionIds(questions));
  return Object.fromEntries(Object.entries(responses).filter(([questionId]) => !textIds.has(questionId)));
}

export async function previewSurveyResponseRetention({ prismaClient, now = new Date() }) {
  const cutoff = surveyResponseRetentionCutoff(now);
  return {
    surveyResponsesAnonymizeBefore: cutoff.toISOString(),
    surveyResponsesToAnonymize: await prismaClient.satisfactionSurvey.count({ where: surveyResponseRetentionWhere(cutoff) })
  };
}

export async function runSurveyResponseRetention({
  prismaClient,
  now = new Date(),
  batchSize = 200,
  maxBatches = 20,
  lock = async () => {},
  onlyIds = null
}) {
  const baseWhere = surveyResponseRetentionWhere(surveyResponseRetentionCutoff(now));
  // onlyIds restringe a execução (testes de integração em banco compartilhado).
  const where = onlyIds ? { AND: [baseWhere, { id: { in: onlyIds } }] } : baseWhere;
  let anonymized = 0;
  let batches = 0;
  for (let index = 0; index < maxBatches; index += 1) {
    const surveys = await prismaClient.satisfactionSurvey.findMany({
      where, orderBy: { sentAt: 'asc' }, take: batchSize, select: { id: true, responses: true, questions: true }
    });
    if (!surveys.length) break;
    anonymized += await prismaClient.$transaction(async tx => {
      await lock(tx);
      let updated = 0;
      for (const survey of surveys) {
        const result = await tx.satisfactionSurvey.updateMany({
          where: { AND: [where, { id: survey.id }] },
          data: {
            emailTo: ANONYMIZED_SURVEY_EMAIL,
            followUpNotes: null,
            submittedIp: null,
            submittedUserAgent: null,
            responses: stripFreeTextResponses(survey.responses, survey.questions) ?? undefined
          }
        });
        updated += result.count;
      }
      return updated;
    });
    batches += 1;
    if (surveys.length < batchSize) break;
  }
  return { surveyResponsesAnonymized: anonymized, surveyResponseBatches: batches };
}
