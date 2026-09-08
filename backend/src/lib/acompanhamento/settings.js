/*
 * Configurações globais do módulo Acompanhamento (chave/valor).
 * Custos anuais por colaborador usados no custo de mão de obra.
 */

import prisma from '../prisma.js';

export const EPI_ANNUAL_COST_KEY = 'epiAnnualCost';
export const EPI_ANNUAL_COST_DEFAULT = 5000; // R$/ano por colaborador (média fixa atual)
export const EXAMS_TRAINING_ANNUAL_COST_KEY = 'examsTrainingAnnualCost';
export const OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_KEY = 'offshoreExamsTrainingAnnualCost';
export const EXAMS_TRAINING_ANNUAL_COST_DEFAULT = 0;
export const OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_DEFAULT = 0;

// Corte do histórico das pendências de alocação do ponto. Guardado como número AAAAMMDD porque
// AcompanhamentoSetting só tem numberValue; o formato é ordenável e não tem ambiguidade de fuso.
// Padrão 01/01/2025: antes disso não há projeto cadastrado no app, então não há o que alocar.
export const PONTO_PENDENCY_CUTOFF_KEY = 'pontoPendencyCutoffDate';
export const PONTO_PENDENCY_CUTOFF_DEFAULT = 20250101;

async function getNumberSetting(key, fallback) {
  const row = await prisma.acompanhamentoSetting.findUnique({ where: { key } });
  const value = row?.numberValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMoneySetting(value, label) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${label} inválido.`);
  return numberValue;
}

async function setNumberSetting(key, value, updatedByUserId = null) {
  await prisma.acompanhamentoSetting.upsert({
    where: { key },
    create: { key, numberValue: value, updatedByUserId },
    update: { numberValue: value, updatedByUserId }
  });
  return value;
}

export function cutoffNumberToDateKey(value) {
  const text = String(Math.trunc(Number(value) || 0)).padStart(8, '0');
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

// Converte 'AAAA-MM-DD' no número AAAAMMDD; lança para data malformada.
export function cutoffDateKeyToNumber(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Data de corte inválida.');
  return Number(`${match[1]}${match[2]}${match[3]}`);
}

// Devolve o corte como 'AAAA-MM-DD' — as datas da trilha são comparadas como texto.
export async function getPontoPendencyCutoffDateKey() {
  const value = await getNumberSetting(PONTO_PENDENCY_CUTOFF_KEY, PONTO_PENDENCY_CUTOFF_DEFAULT);
  const dateKey = cutoffNumberToDateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : cutoffNumberToDateKey(PONTO_PENDENCY_CUTOFF_DEFAULT);
}

export async function setPontoPendencyCutoffDateKey(dateKey, updatedByUserId = null) {
  return setNumberSetting(PONTO_PENDENCY_CUTOFF_KEY, cutoffDateKeyToNumber(dateKey), updatedByUserId);
}

export async function getEpiAnnualCost() {
  return getNumberSetting(EPI_ANNUAL_COST_KEY, EPI_ANNUAL_COST_DEFAULT);
}

export async function setEpiAnnualCost(value, updatedByUserId = null) {
  return setNumberSetting(
    EPI_ANNUAL_COST_KEY,
    normalizeMoneySetting(value, 'Valor de EPI'),
    updatedByUserId
  );
}

export async function getAnnualCollaboratorCosts() {
  const [epiAnnualCost, examsTrainingAnnualCost, offshoreExamsTrainingAnnualCost] = await Promise.all([
    getNumberSetting(EPI_ANNUAL_COST_KEY, EPI_ANNUAL_COST_DEFAULT),
    getNumberSetting(EXAMS_TRAINING_ANNUAL_COST_KEY, EXAMS_TRAINING_ANNUAL_COST_DEFAULT),
    getNumberSetting(OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_KEY, OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_DEFAULT)
  ]);
  return { epiAnnualCost, examsTrainingAnnualCost, offshoreExamsTrainingAnnualCost };
}

export async function setAnnualCollaboratorCosts({
  epiAnnualCost,
  examsTrainingAnnualCost,
  offshoreExamsTrainingAnnualCost
}, updatedByUserId = null) {
  const values = {
    epiAnnualCost: normalizeMoneySetting(epiAnnualCost, 'Valor de EPI'),
    examsTrainingAnnualCost: normalizeMoneySetting(examsTrainingAnnualCost, 'Valor de exames e treinamentos'),
    offshoreExamsTrainingAnnualCost: normalizeMoneySetting(offshoreExamsTrainingAnnualCost, 'Valor offshore de exames e treinamentos')
  };
  await prisma.$transaction([
    prisma.acompanhamentoSetting.upsert({
      where: { key: EPI_ANNUAL_COST_KEY },
      create: { key: EPI_ANNUAL_COST_KEY, numberValue: values.epiAnnualCost, updatedByUserId },
      update: { numberValue: values.epiAnnualCost, updatedByUserId }
    }),
    prisma.acompanhamentoSetting.upsert({
      where: { key: EXAMS_TRAINING_ANNUAL_COST_KEY },
      create: { key: EXAMS_TRAINING_ANNUAL_COST_KEY, numberValue: values.examsTrainingAnnualCost, updatedByUserId },
      update: { numberValue: values.examsTrainingAnnualCost, updatedByUserId }
    }),
    prisma.acompanhamentoSetting.upsert({
      where: { key: OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_KEY },
      create: { key: OFFSHORE_EXAMS_TRAINING_ANNUAL_COST_KEY, numberValue: values.offshoreExamsTrainingAnnualCost, updatedByUserId },
      update: { numberValue: values.offshoreExamsTrainingAnnualCost, updatedByUserId }
    })
  ]);
  return values;
}
