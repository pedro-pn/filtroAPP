/*
 * Motor de custo mensal de colaborador — replica as planilhas custo_operador / custo_auxiliar.
 *
 * params (campos "amarelos" da aba Parâmetros):
 *   salarioBase, salarioMinimo, cargaHoraria (220), diasUteis (22), insalubridade,
 *   periculosidadePct, produtividadePct, transferenciaPct, he70Pct (0,7), he100Pct (1),
 *   beneficios { planoSaude, valeAlimentacao, odonto, seguroVida, cursos },
 *   fgtsPct (0,08), inssPatronalPct (0,10), multaPct (0,40)
 *
 * inputs (aba Simulador Mensal):
 *   diasCliente (periculosidade), diasFora (transferência/viagem),
 *   diasCasa (produtividade/gratificação), he70Horas, he100Horas
 */

const DIAS_MES = 30; // divisor mensal usado nas verbas proporcionais (literal na planilha)

function n(value, fallback = 0) {
  const x = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(x) ? x : fallback;
}

export function defaultBenefits(beneficios = {}) {
  return (
    n(beneficios.planoSaude) +
    n(beneficios.valeAlimentacao) +
    n(beneficios.odonto) +
    n(beneficios.seguroVida) +
    n(beneficios.cursos)
  );
}

export function computeMonthlyCost(params = {}, inputs = {}) {
  const salarioBase = n(params.salarioBase);
  const insalubridade = n(params.insalubridade);
  const cargaHoraria = n(params.cargaHoraria, 220) || 220;
  const diasUteis = n(params.diasUteis, 22) || 22;
  const periculosidadePct = n(params.periculosidadePct);
  const produtividadePct = n(params.produtividadePct);
  const transferenciaPct = n(params.transferenciaPct);
  const he70Pct = n(params.he70Pct);
  const he100Pct = n(params.he100Pct);
  const fgtsPct = n(params.fgtsPct);
  const inssPatronalPct = n(params.inssPatronalPct);
  const multaPct = n(params.multaPct);
  const beneficiosTotal = defaultBenefits(params.beneficios);

  const diasCliente = n(inputs.diasCliente);
  const diasFora = n(inputs.diasFora);
  const diasCasa = n(inputs.diasCasa);
  const he70Horas = n(inputs.he70Horas);
  const he100Horas = n(inputs.he100Horas);

  // A) fixos
  const subtotalFixo = salarioBase + insalubridade;

  // B) verbas variáveis
  const periculosidade = ((salarioBase * periculosidadePct) / DIAS_MES) * diasCliente;
  const produtividade =
    ((salarioBase + insalubridade + salarioBase * periculosidadePct) / DIAS_MES) * diasCasa * produtividadePct;
  const transferencia = ((salarioBase + insalubridade) / DIAS_MES) * diasFora * transferenciaPct;
  const valorHora =
    (salarioBase + insalubridade + periculosidade + produtividade + transferencia) / cargaHoraria;
  const he70 = (valorHora + valorHora * he70Pct) * he70Horas;
  const he100 = (valorHora + valorHora * he100Pct) * he100Horas;
  const dsr = ((he70 + he100) / diasUteis) * 4;
  const subtotalVariavel = periculosidade + produtividade + transferencia + he70 + he100 + dsr;

  // C) remuneração bruta
  const remuneracaoBruta = subtotalFixo + subtotalVariavel;

  // D) encargos
  const fgts = remuneracaoBruta * fgtsPct;
  const inssPatronal = remuneracaoBruta * inssPatronalPct;
  const encargos = fgts + inssPatronal;

  // E) provisões (13º + férias + encargos s/ provisões)
  const provisao13 = remuneracaoBruta / 12;
  const provisaoFerias = (remuneracaoBruta / 12) * (1 + 1 / 3);
  const fgtsProvisoes = (provisao13 + provisaoFerias) * fgtsPct;
  const inssProvisoes = (provisao13 + provisaoFerias) * inssPatronalPct;
  const provisoes = provisao13 + provisaoFerias + fgtsProvisoes + inssProvisoes;

  // G) passivo rescisório
  const multaFgts = fgts * multaPct;
  const avisoPrevio = (remuneracaoBruta + beneficiosTotal) / 12;
  const passivoRescisorio = multaFgts + avisoPrevio;

  const totalMensal = remuneracaoBruta + encargos + provisoes + beneficiosTotal + passivoRescisorio;

  return {
    subtotalFixo,
    periculosidade,
    produtividade,
    transferencia,
    valorHora,
    he70,
    he100,
    dsr,
    subtotalVariavel,
    remuneracaoBruta,
    fgts,
    inssPatronal,
    encargos,
    provisoes,
    beneficios: beneficiosTotal,
    passivoRescisorio,
    totalMensal,
    custoHora220: cargaHoraria ? totalMensal / cargaHoraria : 0,
    custoHora176: totalMensal / 176,
    custoDiaUtil: diasUteis ? totalMensal / diasUteis : 0
  };
}
