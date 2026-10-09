import { projectRdoService } from '../api-credentials/rdo-projection.js';
import { quantidadeDoServico } from './progresso.js';

// Serviço do RDO → relatório técnico do Data Book (RLF/RLI ficam fora por decisão do projeto).
export const TIPO_POR_SERVICO = {
  limpeza: 'RLQ',
  pressao: 'RTP',
  flushing: 'RCPU',
  filtragem: 'RCPU',
  mecanica: 'RLM'
};
const TITULO_POR_SERVICO = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  flushing: 'Flushing',
  filtragem: 'Filtragem',
  mecanica: 'Limpeza mecânica'
};
// Texto fixo do "Modelo - RCPU.docx".
export const PROCEDIMENTO_RCPU = 'IBT 11-23';

function tipoNormalizado(serviceType) {
  return String(serviceType || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function tipoDataBook(serviceType) {
  return TIPO_POR_SERVICO[tipoNormalizado(serviceType)] || null;
}

export function dataPt(value) {
  if (!value) return '';
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function juntar(lista, sep = ', ') {
  return (lista || []).filter(Boolean).join(sep);
}

function medida(m) {
  if (!m?.value) return '';
  return m.unit ? `${m.value} ${m.unit}` : String(m.value);
}

function tubulacoes(tubes = []) {
  return tubes.filter(t => t.diameter || t.length).map(t => ({
    diametro: t.diameter ? `${t.diameter} ${t.diameterUnit || 'pol'}` : '',
    comprimento: t.length ? `${t.length} ${t.lengthUnit || 'm'}` : ''
  }));
}

function laudo(clientApproved) {
  if (clientApproved === true) return 'APROVADO';
  if (clientApproved === false) return 'REPROVADO';
  return undefined;
}

function horasMinutos(totalMinutes) {
  const total = Number(totalMinutes) || 0;
  if (!total) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function servicosRealizadosRcpu(tipo, sd) {
  const desidratacao = sd.dehydration === true;
  if (tipo === 'filtragem') return desidratacao ? 'Filtragem absoluta e desidratação' : 'Filtragem absoluta';
  const base = /secund/i.test(sd.flushingType || '') ? 'Flushing secundário' : 'Flushing primário';
  return desidratacao ? `${base} e desidratação` : base;
}

function fluidoRtp(sd) {
  const raw = String(sd.testFluid || '');
  if (/[oó]leo/i.test(raw)) return `Óleo${sd.testOil ? ` – ${sd.testOil}` : ''}`;
  if (/agua|água/i.test(raw)) return 'Água';
  return raw;
}

function equipamentoTestado(sd) {
  const raw = tipoNormalizado(sd.testedEquipment);
  if (raw.startsWith('mangueira')) return 'Mangueiras';
  if (raw === 'outro') return sd.testedEquipmentOther || 'Outro';
  return 'Tubulação';
}

// Snapshot do contador (resolvedCounter) + cadastro atual: a validade só é usada quando o
// certificado do snapshot ainda é o vigente; senão ela não seria a da data do serviço.
function contadorRcpu(snapshot, contadores = new Map()) {
  if (!snapshot) return {};
  const atual = contadores.get(snapshot.code);
  const mesmoCertificado = atual && (!snapshot.certificate?.id || snapshot.certificate.id === atual.certificateId);
  return {
    contador: juntar([snapshot.code, snapshot.serialNumber && `série ${snapshot.serialNumber}`], ' – '),
    ...(mesmoCertificado && atual.expiresAt ? { contador_validade: dataPt(atual.expiresAt) } : {})
  };
}

/**
 * Monta um item de `dias[].servicos[]` a partir do serviço do RDO e do relatório técnico ligado.
 * Os dados técnicos vêm do relatório técnico (cópia consolidada do serviço) quando houver;
 * status, horários e quantidade são os do RDO do dia.
 */
export function montarServico({ service, derivado = null, concluidas = 0, contadores } = {}) {
  const tipo = tipoNormalizado(service.serviceType);
  const tipoDb = TIPO_POR_SERVICO[tipo];
  if (!tipoDb) return null;
  const doDia = projectRdoService({ ...service, report: null });
  const tecnico = derivado
    ? projectRdoService({ serviceType: service.serviceType, extraData: derivado.specialConditions?.serviceData || {}, report: null })
    : doDia;
  const sd = tecnico.serviceData;
  const sc = derivado?.specialConditions || {};
  const finalizado = doDia.finalized === true;
  const { quantidade, unidade } = quantidadeDoServico(service);

  const out = {
    tipo: tipoDb,
    titulo: TITULO_POR_SERVICO[tipo],
    equipamento: doDia.equipmentName || tecnico.equipmentName || '',
    sistema: doDia.system || tecnico.system || '',
    material: doDia.material || tecnico.material || '',
    inicio: doDia.startTime || '',
    fim: doDia.endTime || '',
    tags: doDia.serviceData.drawingsTags || sd.drawingsTags || '',
    status: finalizado ? 'Finalizado' : 'Em andamento',
    quantidade,
    unidade_quantidade: unidade,
    concluidas: finalizado ? concluidas : 0,
    etapas: doDia.serviceData.stages.length ? doDia.serviceData.stages : sd.stages,
    obs: doDia.serviceData.notes || '',
    relatorio: Number.isInteger(derivado?.sequenceNumber) ? derivado.sequenceNumber : null
  };
  const l = laudo(sd.clientApproved ?? doDia.serviceData.clientApproved);
  if (l) out.laudo = l;
  if (!out.relatorio) out.laudo_observacao = finalizado ? 'Não emitido' : `Em andamento – ${tipoDb} emitido na finalização`;
  if (tipoDb === 'RLQ') {
    out.rlq = out.relatorio;
    out.metodo = juntar(sd.cleaningMethods);
    out.inspecao = juntar(sd.inspectionTypes);
  }
  if (tipoDb === 'RCPU') {
    const particulas = sd.particleCounting === true;
    const umidade = sd.moistureAnalysis === true;
    out.rcpu = {
      servicos_realizados: servicosRealizadosRcpu(tipo, sd),
      oleo: sd.oilType || '',
      volume: medida(tecnico.serviceData.oilVolume),
      unidade: juntar(sc.resolvedUnits),
      unidade_desidratacao: sc.resolvedThermoUnit || '',
      tempo_total: horasMinutos(sc.totalMinutes),
      procedimento: PROCEDIMENTO_RCPU,
      tubulacoes: tubulacoes(sd.tubes),
      ...(particulas ? contadorRcpu(sc.resolvedCounter, contadores) : {}),
      ...(particulas ? { iso_inicial: sd.initialIso || '', iso_final: sd.finalIso || '', nas_inicial: sd.initialNas || '', nas_final: sd.finalNas || '' } : {}),
      ...(umidade ? { umidade_inicial_ppm: sd.initialMoisturePpm || '', umidade_final_ppm: sd.finalMoisturePpm || '' } : {})
    };
  }
  if (tipoDb === 'RTP') {
    out.rtp = {
      equipamento_testado: equipamentoTestado(sd),
      fluido: fluidoRtp(sd),
      pressao_trabalho: medida(sd.workingPressure),
      pressao_teste: medida(sd.testPressure),
      unidade_teste: juntar(sc.resolvedUnits),
      tubulacoes: tubulacoes(sd.tubes),
      manometros: (sc.resolvedManometers || []).map(m => ({
        tag: m.code || '',
        escala: m.scale || '',
        certificado: m.certCode || '',
        calibracao: dataPt(m.calibratedAt),
        validade: dataPt(m.expiresAt)
      }))
    };
  }
  return out;
}
