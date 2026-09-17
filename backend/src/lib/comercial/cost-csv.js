import { calculateEstimate } from '../../../../shared/comercial/dist/cost-model.js';
import { SYSTEM_MATERIALS } from '../../../../shared/comercial/dist/dimensioning.js';
import { getTechnicalServiceDefinition } from '../../../../shared/comercial/dist/technical-services.js';

const dadosDoSistema = item => [
  SYSTEM_MATERIALS.find(material => material.value === item.material)?.label ?? '',
  (Array.isArray(item.serviceIds) ? item.serviceIds : [])
    .map(id => getTechnicalServiceDefinition(id)?.title).filter(Boolean).join(', '),
  item.oilType ?? '',
  item.oilBrandViscosity ?? ''
];

/**
 * A planilha de custos anexada à finalização (tarefas T076a e T076b).
 *
 * Porte de `costEstimateCsv` da referência. É o **anexo que o comercial abre no
 * Excel** para conferir de onde veio o preço — mão de obra por fase, insumos,
 * volumes, logística e a formação de preço linha a linha. Sem ela, a proposta
 * chega ao CRM sem a memória de cálculo.
 *
 * **O formato do arquivo é contrato, não preferência** (FR-054):
 *
 * - `UTF-8 com BOM`. Sem o BOM, o Excel em português lê o arquivo como Latin-1 e
 *   todo acento vira caractere quebrado — "MOBILIZAÇÃO" aparece "MOBILIZAÃ‡ÃƒO".
 * - separador **ponto e vírgula**, porque no Brasil a vírgula é decimal e o
 *   Excel configurado em pt-BR espera `;`.
 * - toda célula entre aspas, com aspas internas duplicadas. Uma descrição com
 *   `;` ou com quebra de linha destruiria o alinhamento das colunas.
 * - fim de linha `CRLF`, como a referência gravava.
 *
 * **Dois formatos, escolhidos pelo `schemaVersion`** (FR-055). O esquema 2 em
 * diante traz mão de obra por fase/contexto; o legado traz a tabela simples de
 * função × meses. Proposta antiga não pode quebrar a finalização — e a escolha
 * também aceita a presença de `laborContexts`, porque houve payload gravado sem
 * `schemaVersion` e com a estrutura nova.
 */

export function nomeDaPlanilha(proposalCode) {
  return `Levantamento de Custos - ${proposalCode}.csv`;
}

/**
 * Monta a planilha. Devolve os bytes prontos para anexar.
 *
 * `estimate` é o registro de `CostEstimate`; `contexto` traz o que vem da
 * proposta e da integração — código, vendedor, orçamentista e funil.
 */
export function planilhaDeCustos(estimate, contexto = {}) {
  const linhas = linhasDaPlanilha(estimate, contexto);
  const csv = linhas
    .map(linha => linha.map(celula => `"${String(celula ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  return {
    fileName: nomeDaPlanilha(contexto.proposalCode || estimate.proposalCode || 'sem-numero'),
    // O `\uFEFF` é o BOM, escrito como escape de propósito: como caractere ele
    // fica INVISÍVEL no código, e alguém o apagaria sem perceber — reaparecendo
    // como acento quebrado na planilha do comercial.
    bytes: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    mime: 'text/csv;charset=utf-8'
  };
}

export function linhasDaPlanilha(estimate, contexto = {}) {
  const payload = asRecord(estimate.payload);
  const result = resultadoDo(payload);
  const assumptions = asRecord(payload.assumptions);

  const linhas = [
    ['LEVANTAMENTO DE CUSTOS', estimate.title],
    ['PROPOSTA', contexto.proposalCode || estimate.proposalCode || ''],
    ['CONSULTOR DE VENDAS', contexto.sellerName || ''],
    ['ORÇAMENTISTA', contexto.estimatorName || ''],
    ['FUNIL NECTAR', contexto.pipelineName || contexto.pipelineId || ''],
    ['VERSÃO DO MODELO', payload.schemaVersion ?? 1],
    ['BASE DE FORMAÇÃO DO PREÇO', assumptions.pricingModel ?? 'legacy_lec'],
    ['BASE DE MÃO DE OBRA', assumptions.laborPricingModel ?? 'legacy_monthly_v1'],
    ['HH MENSAL', assumptions.monthlyHours ?? result.monthlyHours ?? 176],
    ['DIAS ÚTEIS / MÊS', assumptions.workdaysPerMonth ?? 22],
    ['HORAS PADRÃO / DIA', assumptions.defaultHoursPerDay ?? 8.8],
    ['OVERHEAD (%)', assumptions.overheadPercent ?? result.overheadPercent ?? 24],
    ['IMPOSTOS (%)', assumptions.taxPercent ?? result.taxPercent ?? 17.54],
    ['COMISSÃO (%)', assumptions.commissionPercent ?? 9],
    ['COMERCIAL (%)', assumptions.commercialPercent ?? 5],
    ['MARGEM DESEJADA (%)', assumptions.desiredMarginPercent ?? result.desiredMarginPercent ?? 15],
    []
  ];

  if (Number(payload.schemaVersion) >= 2 || Array.isArray(payload.laborContexts)) {
    linhas.push(...linhasEsquema2(payload, result, estimate));
  } else {
    linhas.push(...linhasLegado(payload, result, estimate));
  }

  return linhas;
}

/**
 * O resultado do cálculo.
 *
 * A referência lia `payload.result`, porque lá o cliente gravava o cálculo
 * junto com os dados. Aqui o servidor **recalcula** — é o mesmo motor de
 * `shared/comercial`, o mesmo que produziu os totais gravados e que os 16
 * goldens protegem. Assim a planilha não pode discordar do valor da proposta.
 *
 * `payload.result` continua servindo de reserva: payload antigo que não passa
 * mais pelo motor ainda tem a sua memória de cálculo.
 */
function resultadoDo(payload) {
  try {
    const calculado = calculateEstimate(payload);
    if (calculado && typeof calculado === 'object') return calculado;
  } catch {
    // Payload de esquema antigo pode não ser aceito pelo motor atual. A
    // planilha sai com o que estiver gravado em vez de derrubar a finalização.
  }
  return asRecord(payload.result);
}

// ---------------------------------------------------------------------------
// Esquema 2 — mão de obra por fase
// ---------------------------------------------------------------------------

const CONDICOES = {
  headquarters: 'Sede / Itajaí',
  travel: 'Em viagem',
  offshore: 'Offshore'
};

const TURNOS = { day: 'Diurno', night: 'Noturno' };

function linhasEsquema2(payload, result, estimate) {
  const linhas = [];
  const contextResults = records(result.contextResults);

  linhas.push(
    ['MÃO DE OBRA POR FASE / CONTEXTO'],
    [
      'CONTEXTO', 'CONDIÇÃO', 'INÍCIO (DIA)', 'DURAÇÃO (DIAS)', 'DIAS ÚTEIS TRABALHADOS',
      'HH NORMAL / DIA', 'HE 70% / DIA ÚTIL', 'SÁBADOS', 'H / SÁBADO (70%)',
      'DOMINGOS', 'H / DOMINGO (100%)', 'CARGO', 'TURNO', 'QTD.', 'BASE MENSAL INFORMADA',
      'AJUSTE', 'ALOCAÇÃO (%)', 'HH NORMAL', 'TARIFA NORMAL', 'CUSTO NORMAL',
      'HH 70%', 'TARIFA 70%', 'CUSTO 70%', 'HH 100%', 'TARIFA 100%',
      'CUSTO 100%', 'ENCARGOS (%)', 'CUSTO TOTAL',
      'CENÁRIO DE JORNADA', 'ALVO DA JORNADA', 'COLABORADOR',
      'HH EXTRA COM PERCENTUAL CONFIGURADO', 'CUSTO EXTRA COM PERCENTUAL CONFIGURADO'
    ]
  );

  for (const context of records(payload.laborContexts)) {
    const contextId = String(context.id || '');
    const contextResult = contextResults.find(item => String(item.id || '') === contextId) || {};
    const assignmentResults = records(contextResult.assignments);

    for (const assignment of records(context.assignments)) {
      const assignmentId = String(assignment.id || '');
      const calculado =
        assignmentResults.find(item => String(item.id || '') === assignmentId) || {};
      const total = numero(calculado.total);
      const normalHours = calculado.normalHours ?? calculado.laborHours ?? '';
      const normalHourlyCost =
        calculado.normalHourlyCost ?? (numero(normalHours) > 0 ? total / numero(normalHours) : '');
      const normalCost = calculado.normalCost ?? calculado.total ?? '';

      linhas.push([
        context.name,
        context.workCondition
          ? CONDICOES[String(context.workCondition)] || context.workCondition
          : 'NÃO SELECIONADA',
        context.startOffsetDays,
        context.durationDays, context.workingDays, context.hoursPerDay,
        context.weekdayExtra70HoursPerDay ?? 0, context.saturdayCount ?? 0,
        context.saturdayHoursPerDay ?? 0, context.sundayCount ?? 0,
        context.sundayHoursPerDay ?? 0, assignment.role,
        TURNOS[String(assignment.shift || 'day')] || assignment.shift,
        assignment.quantity, assignment.monthlySalary, assignment.adjustment,
        assignment.allocationPercent, normalHours, normalHourlyCost, normalCost,
        calculado.extra70Hours ?? '', calculado.extra70HourlyCost ?? '',
        calculado.extra70Cost ?? '', calculado.extra100Hours ?? '',
        calculado.extra100HourlyCost ?? '', calculado.extra100Cost ?? '',
        numero(calculado.burdenRate ?? assignment.burdenRateOverride) * 100,
        calculado.total ?? '', assignment.workSchedule?.name ?? '',
        assignment.workSchedule?.targetType === 'collaborator'
          ? 'COLABORADOR'
          : assignment.workSchedule ? 'CARGO' : '',
        assignment.workSchedule?.collaboratorName ?? '',
        calculado.customExtraHours ?? '', calculado.customExtraCost ?? ''
      ]);
    }

    const veiculos = numero(contextResult.vehicleCount ?? context.vehicleCount);
    const diasComEfetivo =
      numero(contextResult.workingDays ?? context.workingDays) +
      numero(context.saturdayCount) +
      numero(context.sundayCount);
    const kmPorDia = numero(context.hotelSiteDistanceKmPerDay ?? 50);
    const kmTotal = veiculos * diasComEfetivo * kmPorDia;

    const linhaVeiculo = [
      context.name,
      `VEÍCULO: ${context.vehicleType === 'none'
        ? 'SEM VEÍCULO'
        : String(context.vehicleType || 'NÃO SELECIONADO').toUpperCase()}`,
      '', '', contextResult.workingDays ?? context.workingDays ?? '',
      '', '', '', '', '', '',
      `QTD. VEÍCULOS: ${contextResult.vehicleCount ?? context.vehicleCount ?? ''} · HOTEL ↔ OBRA: ${
        context.workCondition === 'travel' && context.vehicleType !== 'none'
          ? `${kmPorDia} KM/DIA · ${kmTotal} KM TOTAL`
          : 'NÃO APLICÁVEL'
      }`,
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      ''
    ];
    while (linhaVeiculo.length < 33) linhaVeiculo.push('');
    linhas.push(linhaVeiculo);

    const expenseResults = records(contextResult.expenses);
    for (const expense of records(context.expenses)) {
      const calculado =
        expenseResults.find(item => String(item.id || '') === String(expense.id || '')) || {};
      // A despesa ocupa colunas espalhadas da MESMA tabela de mão de obra, e não
      // uma tabela própria: é assim que o comercial lê hoje, com a despesa
      // aparecendo sob a fase a que pertence.
      const linha = Array(33).fill('');
      linha[0] = context.name;
      linha[11] = `DESPESA: ${String(expense.name || expense.description || '')}`;
      linha[12] = `BASE: ${String(expense.basis || '')}`;
      linha[13] = `MULT.: ${expense.quantity ?? ''}`;
      linha[17] = `BASE CALC.: ${calculado.basisQuantity ?? ''}`;
      linha[18] = `UNIT.: ${expense.unitValue ?? ''}`;
      linha[27] = calculado.total ?? '';
      linhas.push(linha);
    }
  }

  const indirectResults = records(result.indirectResults);
  linhas.push(
    [],
    ['DESPESAS INDIRETAS'],
    ['DESCRIÇÃO', 'BASE', 'QUANTIDADE', 'BASE CALCULADA', 'VALOR UNITÁRIO', 'INCLUÍDA', 'CUSTO'],
    ...records(payload.indirectCosts).map(item => {
      const calculado =
        indirectResults.find(entry => String(entry.id || '') === String(item.id || '')) || {};
      return [
        item.name ?? item.description, item.basis ?? 'per_person_month', item.quantity ?? 1,
        calculado.basisQuantity ?? '', item.unitValue ?? item.monthly ?? 0,
        item.included === false ? 'NÃO' : 'SIM', calculado.total ?? 0
      ];
    }),
    [],
    ['MATERIAIS E INSUMOS'],
    ['CATEGORIA', 'DESCRIÇÃO', 'UNIDADE', 'QUANTIDADE', 'CUSTO UNITÁRIO', 'PERDA (%)', 'FRETE', 'CUSTO TOTAL']
  );

  const materialResults = records(result.materialResults);
  for (const item of records(payload.materials)) {
    const calculado =
      materialResults.find(entry => String(entry.id || '') === String(item.id || '')) || {};
    const quantidade = numero(item.quantity);
    const unitario = numero(item.unitCost);
    const perda = numero(item.wastePercent);
    const frete = numero(item.freightValue);
    linhas.push([
      item.category, item.description, item.unit, quantidade, unitario, perda, frete,
      calculado.total ?? quantidade * unitario * (1 + perda / 100) + frete
    ]);
  }

  linhas.push(
    [],
    ['TUBULAÇÕES E VOLUMES'],
    ['CIRCUITO', 'TIPO', 'NOME DO SISTEMA', 'QTD.', 'COMPRIMENTO (M)', 'DIÂMETRO INTERNO (MM)', 'PREENCHIMENTO (%)', 'CICLOS', 'VOLUME (L)', 'MATERIAL', 'SERVIÇOS', 'TIPO DE ÓLEO', 'MARCA / VISCOSIDADE']
  );

  const volumeResults = records(result.volumeResults);
  for (const system of records(payload.volumeSystems)) {
    const systemResult =
      volumeResults.find(entry => String(entry.id || '') === String(system.id || '')) || {};

    for (const [chave, rotulo] of [['pipeSegments', 'Tubulação'], ['hoseSegments', 'Mangueira']]) {
      const calculados = records(systemResult[chave]);
      for (const trecho of records(system[chave])) {
        const calculado =
          calculados.find(entry => String(entry.id || '') === String(trecho.id || '')) || {};
        const quantidade = Math.max(0, numero(trecho.quantity) || 1);
        const comprimento = Math.max(0, numero(trecho.lengthM));
        const diametro = Math.max(0, numero(trecho.internalDiameterMm));
        const preenchimento = Math.max(0, numero(trecho.fillPercent) || 100);
        const litros =
          ((quantidade * Math.PI * (diametro / 1000) ** 2) / 4) * comprimento * 1000 * preenchimento / 100;
        linhas.push([
          system.name, rotulo, trecho.description ?? trecho.tag, quantidade, comprimento,
          diametro, preenchimento, '', calculado.volumeLiters ?? litros,
          ...dadosDoSistema(trecho)
        ]);
      }
    }

    for (const [chave, rotulo] of [
      ['equipmentVolumes', system.servicesByItem ? 'Equipamento avulso' : 'Máquina / reservatório'],
      ['reservoirVolumes', 'Reservatório']
    ]) {
      const calculados = records(systemResult[chave]);
      for (const equipamento of records(system[chave])) {
        if (equipamento.included === false) continue;
        const calculado =
          calculados.find(entry => String(entry.id || '') === String(equipamento.id || '')) || {};
        linhas.push([
          system.name, rotulo, equipamento.description, equipamento.quantity ?? 1,
          '', '', '', '',
          calculado.totalVolumeLiters ??
            numero(equipamento.quantity ?? 1) * numero(equipamento.volumeLiters),
          ...dadosDoSistema(equipamento)
        ]);
      }
    }

    const manualVolumeResults = records(systemResult.manualVolumes);
    for (const adicional of records(system.manualVolumes)) {
      const calculado =
        manualVolumeResults.find(entry => String(entry.id || '') === String(adicional.id || '')) || {};
      linhas.push([
        system.name, system.servicesByItem ? 'Volume de óleo' : 'Outro volume', adicional.description ?? '',
        adicional.quantity ?? 1, '', '', '', '',
        calculado.totalVolumeLiters ??
          numero(adicional.quantity ?? 1) * numero(adicional.volumeLiters),
        ...dadosDoSistema(adicional)
      ]);
    }

    linhas.push([
      system.name, 'Total', 'TOTAL DO SISTEMA (COM CICLOS)', '', '', '', '',
      system.cycles, systemResult.totalVolumeLiters ?? '', '', '', '', ''
    ]);
  }

  linhas.push(
    [],
    ['PRODUTOS / CONSUMÍVEIS CALCULADOS'],
    ['SISTEMA', 'PRODUTO', 'REGRA DE DOSAGEM', 'DOSAGEM', 'DENSIDADE', 'PERDA (%)', 'EMBALAGEM', 'UNIDADE', 'CUSTO UNITÁRIO', 'PREÇO EQUIVALENTE (R$/L)', 'QUANTIDADE CALCULADA', 'CUSTO TOTAL']
  );

  const productResults = records(result.productResults);
  for (const produto of records(payload.products)) {
    const produtoId = String(produto.id || '');
    const calculado =
      productResults.find(item => String(item.productId ?? item.id ?? '') === produtoId) || {};
    linhas.push([
      produto.systemId, produto.productName ?? produto.name, produto.doseMode, produto.dose,
      produto.densityKgPerL, produto.wastePercent, produto.packageSize, produto.unit,
      produto.unitCost, precoPorLitro(produto),
      calculado.purchaseQuantity ?? calculado.requiredQuantity ?? produto.manualQuantity ?? '',
      calculado.total ?? produto.totalCost ?? ''
    ]);
  }

  linhas.push(
    [],
    ['FILTROS'],
    ['FILTRO', 'MICRAGEM / REFERÊNCIA', 'UNIDADE', 'QUANTIDADE', 'CUSTO UNITÁRIO', 'INCLUÍDO', 'CUSTO TOTAL']
  );

  const filterResults = records(result.filterResults);
  for (const filtro of records(payload.filters)) {
    const calculado =
      filterResults.find(entry => String(entry.id || '') === String(filtro.id || '')) || {};
    linhas.push([
      filtro.filterName, filtro.micronRating, filtro.unit, filtro.quantity, filtro.unitCost,
      filtro.included === false ? 'NÃO' : 'SIM',
      filtro.included === false
        ? 0
        : calculado.total ?? numero(filtro.quantity) * numero(filtro.unitCost)
    ]);
  }

  const effluent = asRecord(payload.effluent);
  linhas.push(
    [],
    ['PREVISÃO DE EFLUENTE'],
    ['MULTIPLICADOR', effluent.multiplier ?? 4],
    ['VOLUME ESTIMADO (L)', result.effluentVolumeLiters ?? ''],
    ['VOLUME ESTIMADO (M³)', numero(result.effluentVolumeLiters) / 1000],
    ['RESPONSABILIDADE DO CLIENTE', effluent.clientResponsible === false ? 'NÃO' : 'SIM'],
    ['INCLUIR DESTINAÇÃO NO CUSTO', effluent.includeDisposalCost === true ? 'SIM' : 'NÃO'],
    ['CUSTO DE DESTINAÇÃO (R$/M³)', effluent.unitCostPerM3 ?? 0],
    ['CUSTO DE EFLUENTE', result.effluentCost ?? 0]
  );

  linhas.push([], ['MOBILIZAÇÃO E DESMOBILIZAÇÃO'], CABECALHO_LOGISTICA);
  linhas.push(...linhasDeLogistica(payload, result));

  const commercial = asRecord(payload.commercial);
  linhas.push(
    [],
    ['FORMAÇÃO DE PREÇO'],
    ['CUSTO MÃO DE OBRA', result.laborCost ?? ''],
    ['DESPESAS INDIRETAS', result.indirectCost ?? result.indirectCostTotal ?? ''],
    ['MATERIAIS', result.materialCost ?? ''],
    ['INSUMOS / PRODUTOS / FILTROS / EFLUENTE', result.inputCost ?? result.productCost ?? ''],
    ['FILTROS', result.filterCost ?? ''],
    ['EFLUENTE ESTIMADO (L)', result.effluentVolumeLiters ?? ''],
    ['CUSTO DE EFLUENTE', result.effluentCost ?? ''],
    ['MOBILIZAÇÃO', result.mobilizationCost ?? ''],
    ['DESMOBILIZAÇÃO', result.demobilizationCost ?? ''],
    ['CUSTO DIRETO', result.directCost ?? ''],
    ['OVERHEAD', result.overheadValue ?? ''],
    ['CUSTO COM OVERHEAD', result.costWithOverhead ?? estimate.totalCost],
    ['IMPOSTOS', result.taxValue ?? ''],
    ['COMISSÃO', result.commissionValue ?? ''],
    ['COMERCIAL', result.commercialValue ?? ''],
    ['LUCRO', result.profitValue ?? ''],
    ['VALOR FINAL DA PROPOSTA', result.salePrice ?? estimate.salePrice],
    ['VENDA LÍQUIDA', result.netRevenue ?? ''],
    // A margem sai como o motor a produz — fração. A coluna do banco guarda
    // percentual, e misturar as duas na mesma planilha daria a mesma margem
    // escrita de dois jeitos.
    ['MARGEM', result.margin ?? numero(estimate.marginPercent) / 100],
    ['HH TOTAL', result.totalLaborHours ?? ''],
    ['PESSOAS-DIA', result.totalPersonDays ?? ''],
    ['PICO DE EFETIVO', result.peakHeadcount ?? ''],
    ['VOLUME TOTAL (L)', result.totalVolumeLiters ?? ''],
    ['MODO COMERCIAL', commercial.pricingMode ?? payload.pricingMode ?? '']
  );

  const qqp = records(commercial.qqp ?? payload.qqp);
  if (qqp.length) {
    linhas.push(
      [],
      ['QQP — QUADRO DE QUANTIDADES E PREÇOS'],
      ['CATEGORIA', 'DESCRIÇÃO', 'UNIDADE', 'QUANTIDADE', 'VALOR UNITÁRIO', 'VALOR TOTAL'],
      ...qqp.map(item => [
        item.category, item.description, item.unit, item.quantity, item.unitValue, item.value
      ])
    );
  }

  return linhas;
}

/**
 * O preço por litro do produto.
 *
 * Ele não é informado: é derivado da unidade em que o produto foi comprado.
 * Quilo vira litro pela densidade, metro cúbico vira litro por mil — e unidade
 * que não é de volume fica em branco, porque não há conversão honesta.
 */
function precoPorLitro(produto) {
  const embalagem = numero(produto.packageSize);
  const unitario = numero(produto.unitCost);
  const base =
    produto.priceBasis === 'package' && embalagem > 0 ? unitario / embalagem : unitario;
  const unidade = String(produto.unit || '').trim().toLocaleLowerCase('pt-BR');

  if (unidade.startsWith('kg')) {
    return base * Math.max(0.000001, numero(produto.densityKgPerL) || 1);
  }
  if (unidade === 'l' || unidade.startsWith('litro')) return base;
  if (unidade === 'm³' || unidade === 'm3') return base / 1000;
  return '';
}

const CABECALHO_LOGISTICA = [
  'DIREÇÃO', 'MODO', 'CATEGORIA', 'DESCRIÇÃO', 'CONTEXTO', 'INCLUÍDO',
  'BASE LEGADA', 'QUANTIDADE / FRETES', 'VIAGENS', 'CUSTO UNITÁRIO / FRETE',
  'KM POR VEÍCULO / VIAGEM', 'LIMITE KM / DIA', 'DIAS DE VIAGEM',
  'DIAS INFORMADOS / TRECHO', 'PERNOITES / TRECHO', 'ÔNIBUS / PERNOITE',
  'PASSAGEM / PESSOA / TRECHO', 'CUSTO DAS PASSAGENS',
  'SÁBADOS', 'DOMINGOS / FERIADOS', 'COLABORADORES', 'COMPOSIÇÃO DOS VIAJANTES', 'CAPACIDADE',
  'VEÍCULOS', 'KM DA FROTA', 'HORAS / DIA', 'HH DE VIAGEM',
  'HH MÉDIO NORMAL', 'CUSTO HH', 'HOSPEDAGEM', 'ALIMENTAÇÃO',
  'USO DO CARRO ALUGADO', 'DIÁRIA DO CARRO', 'DIAS ALUGADO NA OBRA',
  'DIAS DE LOCAÇÃO POR VEÍCULO', 'CUSTO DA LOCAÇÃO',
  'COMBUSTÍVEL (L)', 'COMBUSTÍVEL (R$)', 'PEDÁGIO', 'USO / MANUTENÇÃO',
  'COMPLEMENTOS', 'CUSTO COMPLEMENTOS', 'CONTINGÊNCIA (%)',
  'IMPOSTOS + COMISSÃO (%)', 'MARGEM LEC (%)', 'CUSTO DIRETO',
  'CUSTO C/ IMPOSTOS', 'VALOR A COBRAR', 'CONFIGURAÇÃO DA VOLTA'
];

const MODOS_COM_VIAJANTE_AUTOMATICO = [
  'company_crew_vehicle',
  'rental_crew_vehicle',
  'bus_crew_transport',
  'air_crew_transport'
];

/**
 * A logística é a seção mais larga da planilha, e a mais condicional.
 *
 * Cada modo de cálculo preenche um subconjunto das colunas, e as demais ficam
 * **em branco** — não zeradas. A distinção importa: zero num item que não usa
 * veículo diria "rodou 0 km", e branco diz "não se aplica".
 */
function linhasDeLogistica(payload, result) {
  const logisticsResults = records(result.logisticsResults);
  const laborContexts = records(payload.laborContexts);
  const linhas = [];

  for (const item of records(payload.logistics)) {
    const itemId = String(item.id || '');
    const calculado =
      logisticsResults.find(entry => String(entry.itemId ?? entry.id ?? '') === itemId) || {};

    const modo = String(item.calculationMode || 'legacy');
    const veiculoProprio = modo === 'company_crew_vehicle';
    const veiculoAlugado = modo === 'rental_crew_vehicle';
    const onibus = modo === 'bus_crew_transport';
    const aereo = modo === 'air_crew_transport';
    const comPassagem = onibus || aereo;
    const caminhao = modo === 'company_truck_driver';
    const rodoviario = veiculoProprio || veiculoAlugado || caminhao;
    const comViagem = rodoviario || comPassagem;

    const contexto = laborContexts.find(
      item2 => String(item2.id || '') === String(item.contextId || '')
    );
    const assignments = records(contexto?.assignments);

    const viajantes =
      item.travelerAssignmentsConfirmed === false
        ? 'Composição histórica preservada'
        : item.travelerCountMode === 'automatic' && MODOS_COM_VIAJANTE_AUTOMATICO.includes(modo)
          ? 'Todos os cargos da fase'
          : records(item.travelerAssignments)
              .filter(viajante => Number(viajante.quantity || 0) > 0)
              .map(viajante => {
                const assignment = assignments.find(
                  entry => String(entry.id || '') === String(viajante.assignmentId || '')
                );
                return `${String(assignment?.role || viajante.assignmentId || 'Cargo')}: ${viajante.quantity}`;
              })
              .join(' | ');

    const complementos = records(item.additionalCosts)
      .filter(adicional => adicional.included !== false)
      .map(
        adicional =>
          `${String(adicional.description || '')}: ${adicional.quantity ?? 0} × ${adicional.unitCost ?? 0} (${String(adicional.basis || 'fixed')})`
      )
      .join(' | ');

    linhas.push([
      item.direction, item.calculationMode || 'legacy', item.category, item.description,
      item.contextId, item.included === false ? 'NÃO' : 'SIM', item.basis, item.quantity,
      item.trips, item.unitCost,
      rodoviario ? item.distanceKmPerVehicle : '',
      rodoviario ? item.dailyDistanceLimitKm : '',
      calculado.travelDays ?? '',
      comPassagem ? item.travelCalendarDaysPerTrip ?? '' : '',
      comPassagem ? item.lodgingNightsPerTrip ?? '' : '',
      onibus ? item.busOvernightMode ?? '' : '',
      comPassagem ? item.ticketPerPersonPerTrip ?? '' : '',
      comPassagem ? calculado.ticketCost ?? '' : '',
      item.travelSaturdayDays, item.travelSundayDays,
      comViagem ? calculado.people ?? '' : '',
      comViagem ? viajantes : '',
      rodoviario ? calculado.vehicleCapacity ?? '' : '',
      rodoviario ? calculado.calculatedVehicleCount ?? '' : '',
      rodoviario ? calculado.fleetDistanceKm ?? '' : '',
      comViagem ? item.travelHoursPerDay : '',
      comViagem ? calculado.travelLaborHours ?? '' : '',
      comViagem ? calculado.averageNormalHourlyCost ?? '' : '',
      comViagem ? calculado.travelLaborCost ?? '' : '',
      comViagem ? calculado.lodgingCost ?? '' : '',
      comViagem ? calculado.mealCost ?? '' : '',
      veiculoAlugado ? item.rentalUse ?? '' : '',
      veiculoAlugado ? item.rentalDailyRate ?? '' : '',
      veiculoAlugado ? item.rentalSiteDays ?? '' : '',
      veiculoAlugado ? calculado.rentalDays ?? '' : '',
      veiculoAlugado ? calculado.rentalCost ?? '' : '',
      rodoviario ? calculado.fuelLiters ?? '' : '',
      rodoviario ? calculado.fuelCost ?? '' : '',
      rodoviario ? calculado.tollCost ?? '' : '',
      veiculoProprio || caminhao ? calculado.vehicleOperatingCost ?? '' : '',
      complementos,
      calculado.additionalCostTotal ?? '', item.contingencyPercent,
      item.taxPercent, item.marginPercent,
      item.included === false ? 0 : calculado.total ?? item.totalCost ?? '',
      item.included === false ? 0 : calculado.costWithTax ?? '',
      item.included === false ? 0 : calculado.chargeValue ?? '',
      item.returnSetup ?? ''
    ]);
  }

  return linhas;
}

// ---------------------------------------------------------------------------
// Legado — a tabela simples de função × meses
// ---------------------------------------------------------------------------

/**
 * O formato antigo, de antes de a mão de obra virar fases.
 *
 * Ele existe porque **proposta antiga não pode quebrar a finalização**
 * (FR-055): quem revisa um levantamento de dois anos atrás precisa da planilha
 * do jeito que aquele levantamento foi feito, não de colunas vazias.
 */
function linhasLegado(payload, result, estimate) {
  const lines = records(payload.lines);
  const lineResults = records(result.lineResults);

  return [
    ['FUNÇÃO', 'QUANTIDADE', 'PERMANÊNCIA (MESES)', 'SALÁRIO', 'CUSTO TOTAL'],
    ...lines.map((line, indice) => [
      line.role, line.quantity, line.months,
      lineResults[indice]?.salary ?? line.salary ?? 0,
      lineResults[indice]?.total ?? 0
    ]),
    [],
    ['TOTAL DE COLABORADORES', result.totalEmployees ?? ''],
    ['FOLHA + ENCARGOS', result.payrollCost ?? ''],
    ['DESPESAS INDIRETAS', result.indirectCostTotal ?? ''],
    ['OVERHEAD', result.overheadValue ?? ''],
    ['CUSTO TOTAL', estimate.totalCost],
    ['IMPOSTOS', result.taxValue ?? ''],
    ['LUCRO', result.profitValue ?? ''],
    ['VALOR FINAL DA PROPOSTA', estimate.salePrice],
    ['VENDA LÍQUIDA', result.netRevenue ?? ''],
    ['MARGEM', result.margin ?? numero(estimate.marginPercent) / 100]
  ];
}

// ---------------------------------------------------------------------------

function asRecord(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

function records(valor) {
  return Array.isArray(valor) ? valor.map(asRecord) : [];
}

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}
