import assert from 'node:assert/strict';
import test from 'node:test';

import {
  storedSurveyQuestions,
  surveyQuestionSnapshot,
  validateSurveyPrivacyNotice,
  validateSurveyResponses
} from '../src/routes/resources/surveys.js';

test('survey responses are validated against the survey question snapshot', () => {
  const questions = surveyQuestionSnapshot([
    { id: 'legacyQuestion', label: 'Pergunta original', type: 'TEXT', required: true, order: 1 },
    { id: 'recommendation', label: 'Recomendação', type: 'NPS', required: true, order: 2 },
    { id: 'rating', label: 'Nota', type: 'SCALE', required: true, order: 3 },
    { id: 'optionalComment', label: 'Comentário opcional', type: 'TEXT', required: false, order: 4 }
  ]);

  assert.deepEqual(validateSurveyResponses({
    answers: {
      legacyQuestion: 'Resposta preservada',
      recommendation: 10,
      rating: 5
    }
  }, questions), {
    legacyQuestion: 'Resposta preservada',
    recommendation: 10,
    rating: 5,
    optionalComment: ''
  });
});

test('survey question snapshots preserve inactive or edited historical labels', () => {
  const stored = storedSurveyQuestions({
    questions: [
      { id: 'oldQuestion', label: 'Pergunta removida depois', type: 'TEXT', options: [], required: true, order: 1 }
    ]
  });

  assert.deepEqual(stored, [
    { id: 'oldQuestion', label: 'Pergunta removida depois', type: 'TEXT', options: [], required: true, order: 1 }
  ]);
});

test('dynamic survey validation rejects missing required fields and invalid select options', () => {
  const questions = surveyQuestionSnapshot([
    { id: 'requiredText', label: 'Campo obrigatório', type: 'TEXT', required: true, order: 1 },
    { id: 'choice', label: 'Escolha', type: 'SELECT', options: ['A', 'B'], required: true, order: 2 }
  ]);

  assert.throws(
    () => validateSurveyResponses({ answers: { choice: 'A' } }, questions),
    /Preencha a pergunta: Campo obrigatório/
  );

  assert.throws(
    () => validateSurveyResponses({ answers: { requiredText: 'Ok', choice: 'C' } }, questions),
    /Resposta inválida para: Escolha/
  );
});

test('survey response requires privacy notice acknowledgement', () => {
  assert.equal(
    validateSurveyPrivacyNotice({
      privacyNoticeAccepted: true,
      privacyNoticeVersion: 'survey_notice_v1'
    }),
    'survey_notice_v1'
  );
  assert.throws(
    () => validateSurveyPrivacyNotice({}),
    /Confirme a ciência do aviso de privacidade/
  );

  assert.throws(
    () => validateSurveyPrivacyNotice({ privacyNoticeVersion: 'survey_notice_v1' }),
    /Confirme a ciência do aviso de privacidade/
  );

  assert.throws(
    () => validateSurveyPrivacyNotice({ privacyNoticeAccepted: true, privacyNoticeVersion: '' }),
    /Versão do aviso de privacidade inválida/
  );

  assert.throws(
    () => validateSurveyPrivacyNotice({ privacyNoticeAccepted: true, privacyNoticeVersion: 'old_notice_v1' }),
    /Versão do aviso de privacidade inválida/
  );
});
