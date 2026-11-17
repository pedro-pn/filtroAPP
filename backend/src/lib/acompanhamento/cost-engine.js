/*
 * Motor de custo mensal de colaborador — replica a aba "Calculo Colaboradores"
 * da planilha Motor_colaborador.xlsm.
 *
 * params (campos laranja da planilha, mais percentuais configuráveis do app):
 *   salarioBase, salarioMinimo, cargaHoraria (220), diasUteis (22),
 *   periculosidadePct, produtividadePct, transferenciaPct, confinamentoPct,
 *   he70Pct (0,7), he100Pct (1), fgtsPct (0,08), multaPct (0,50),
 *   reajusteHhPct (fração por cargo, 0,1 = 10%; ausente = 0),
 *   beneficios { seguroVida, valeAlimentacao, planoSaude, odonto, cursos, moradia }.
 *
 * inputs:
 *   diasCasa (Em Itajai), diasFora (Em viagem), offshoreDays (OFFSHORE),
 *   diasCliente (legado, tratado como periculosidade integral se exceder as modalidades),
 *   he70Horas, he100Horas.
 *
 * Colunas vazias da planilha (INSS++ e equivalentes) ficam fora do calculo.
 */

const HORAS_POR_DIA = 8.8;
const DEFAULT_DIAS_UTEIS = 22;
const HOME_PERICULOSIDADE_FACTOR = 5 / 7;
const DEFAULT_INSALUBRIDADE_PCT = 0.2;

function n(value, fallback = 0) {
  const x = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(x) ? x : fallback;
}

export function defaultBenefits(beneficios = {}) {
  const educacao = beneficios.cursos != null ? beneficios.cursos : beneficios.educacao;
  return (
    n(beneficios.seguroVida) +
    n(beneficios.valeAlimentacao) +
    n(beneficios.planoSaude) +
    n(beneficios.odonto) +
    n(educacao) +
    n(beneficios.moradia)
  );
}

function derivedInsalubridade(params) {
  const salarioMinimo = n(params.salarioMinimo);
  if (salarioMinimo > 0) return salarioMinimo * n(params.insalubridadePct, DEFAULT_INSALUBRIDADE_PCT);
  return n(params.insalubridade);
}

function defaultConfinamentoPct(transferenciaPct) {
  // A planilha usa 40% para operador+ e 20% para auxiliar. O modelo auxiliar
  // legado e identificado pelo percentual de viagem de 10%.
  return transferenciaPct <= 0.1 ? 0.2 : 0.4;
}

function dayFraction(days, diasUteis) {
  return diasUteis > 0 ? n(days) / diasUteis : 0;
}

export function computeMonthlyCost(params = {}, inputs = {}) {
  // Reajusta a base de custo uma única vez. Os valores cadastrados de salário,
  // salário mínimo e jornada são preservados; adicionais, HE e reflexos usam
  // esta base ajustada. Benefícios e custos anuais fixos seguem seus valores.
  const fatorReajusteHh = 1 + Math.max(0, n(params.reajusteHhPct));
  const salarioBase = n(params.salarioBase) * fatorReajusteHh;
  const insalubridade = derivedInsalubridade(params) * fatorReajusteHh;
  const cargaHoraria = n(params.cargaHoraria, 220) || 220;
  const diasUteis = n(params.diasUteis, DEFAULT_DIAS_UTEIS) || DEFAULT_DIAS_UTEIS;
  const periculosidadePct = n(params.periculosidadePct, 0.3);
  const produtividadePct = n(params.produtividadePct);
  const transferenciaPct = n(params.transferenciaPct);
  const confinamentoPct = n(params.confinamentoPct, defaultConfinamentoPct(transferenciaPct));
  const he70Pct = n(params.he70Pct, 0.7);
  const he100Pct = n(params.he100Pct, 1);
  const fgtsPct = n(params.fgtsPct, 0.08);
  const multaPct = n(params.multaPct, 0.5);
  const beneficiosTotal = defaultBenefits(params.beneficios);

  const diasFora = n(inputs.diasFora);
  const diasCasa = n(inputs.diasCasa);
  const offshoreDays = n(inputs.offshoreDays);
  const diasModalidade = diasCasa + diasFora + offshoreDays;
  const diasClienteLegado = n(inputs.diasCliente);
  const diasClienteIntegral = Math.max(0, diasClienteLegado - diasModalidade);
  const he70Horas = n(inputs.he70Horas);
  const he100Horas = n(inputs.he100Horas);

  // A) fixos
  const subtotalFixo = salarioBase + insalubridade;

  // B) verbas variaveis por modalidade:
  // Em Itajai: periculosidade ponderada por 5/7 + produtividade/gratificacao.
  // Em viagem: periculosidade integral + transferencia.
  // Offshore: periculosidade integral + confinamento.
  const homeFraction = dayFraction(diasCasa, diasUteis);
  const awayFraction = dayFraction(diasFora, diasUteis);
  const offshoreFraction = dayFraction(offshoreDays, diasUteis);
  const legacyClientFraction = dayFraction(diasClienteIntegral, diasUteis);
  const periculosidadeFactor =
    homeFraction * HOME_PERICULOSIDADE_FACTOR +
    awayFraction +
    offshoreFraction +
    legacyClientFraction;

  const periculosidade = salarioBase * periculosidadePct * periculosidadeFactor;
  const produtividade = (salarioBase + insalubridade + periculosidade) * homeFraction * produtividadePct;
  const transferencia = (salarioBase + insalubridade) * awayFraction * transferenciaPct;
  const confinamento = (salarioBase + insalubridade) * offshoreFraction * confinamentoPct;

  const valorHora =
    (salarioBase + insalubridade + periculosidade + produtividade + transferencia + confinamento) / cargaHoraria;
  const he70 = (valorHora + valorHora * he70Pct) * he70Horas;
  const he100 = (valorHora + valorHora * he100Pct) * he100Horas;
  const dsr = ((he70 + he100) / diasUteis) * 4;
  const subtotalVariavel = periculosidade + produtividade + transferencia + confinamento + he70 + he100 + dsr;

  // C) remuneração bruta
  const remuneracaoBruta = subtotalFixo + subtotalVariavel;

  // D) encargos
  const fgts = remuneracaoBruta * fgtsPct;
  const inssPatronal = 0;
  const encargos = fgts;

  // E) provisoes: ferias, 13o, aviso previo e multa FGTS (INSS++ vazio na planilha).
  const ferias = remuneracaoBruta / 12;
  const tercoFerias = ferias / 3;
  const fgtsFerias = (ferias + tercoFerias) * fgtsPct;
  const decimoTerceiro = remuneracaoBruta / 12;
  const fgtsDecimoTerceiro = decimoTerceiro * fgtsPct;
  const provisoes = ferias + tercoFerias + fgtsFerias + decimoTerceiro + fgtsDecimoTerceiro;

  const avisoPrevio = remuneracaoBruta / 12;
  const fgtsAvisoPrevio = avisoPrevio * fgtsPct;
  const multaFgts = (fgts + fgtsFerias + fgtsDecimoTerceiro + fgtsAvisoPrevio) * multaPct;
  const passivoRescisorio = avisoPrevio + fgtsAvisoPrevio + multaFgts;
  const inssProvisoes = 0;

  const totalMensal = remuneracaoBruta + encargos + provisoes + beneficiosTotal + passivoRescisorio;

  return {
    subtotalFixo,
    insalubridade,
    periculosidade,
    produtividade,
    gratificacaoServicos: produtividade,
    transferencia,
    bonificacaoViagem: transferencia,
    confinamento,
    valorHora,
    he70,
    he100,
    dsr,
    subtotalVariavel,
    remuneracaoBruta,
    fgts,
    inssPatronal,
    encargos,
    ferias,
    tercoFerias,
    fgtsFerias,
    decimoTerceiro,
    fgtsDecimoTerceiro,
    avisoPrevio,
    fgtsAvisoPrevio,
    multaFgts,
    inssProvisoes,
    provisoes,
    beneficios: beneficiosTotal,
    passivoRescisorio,
    totalMensal,
    custoHora220: cargaHoraria ? totalMensal / cargaHoraria : 0,
    custoHora176: totalMensal / 176,
    custoDiaUtil: diasUteis ? totalMensal / diasUteis : 0
  };
}
