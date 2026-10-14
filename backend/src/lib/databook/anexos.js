import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import env from '../../config/env.js';
import { getProductForStep } from '../report-rlq.js';
import { readStoredImageAsset, resolveStoredUploadPath } from '../stored-image.js';
import { currentCalibrationCertificateInclude } from '../calibration-certificates.js';
import { resolvePublicStockAttachment } from '../estoque/stock-attachments.js';
import { dataPt } from './servicos.js';

// Ordem das etapas de limpeza química no formulário do RDO (ServiceFields.tsx).
const ORDEM_ETAPAS_RLQ = [
  'Montagem do sistema', 'Teste de estanqueidade', 'Desengraxe', 'Fase ácida', 'Fase sequestrante',
  'Fase neutralizante', 'Fase passivante', 'Secagem', 'Desmontagem do sistema', 'Inspeção por boroscopia'
];

export function normalizarNome(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Hidróxido de sódio, Metassilicato de sódio e Tripolifosfato de sódio" → 3 produtos. */
export function separarProdutos(texto) {
  return String(texto || '').split(/,|\se\s/).map(p => p.trim()).filter(Boolean);
}

/** União das etapas dos RLQs do intervalo, com o produto químico de cada uma (tabela do RLQ). */
export function etapasProdutoDosRlqs(dias) {
  const vistas = new Map();
  for (const dia of dias) {
    for (const s of dia.servicos) {
      if (s.tipo !== 'RLQ') continue;
      for (const etapa of s.etapas || []) {
        const produto = getProductForStep(etapa, s.material) || null;
        const atual = vistas.get(etapa);
        // Inox e aço carbono podem dar produtos diferentes na mesma etapa: une os dois.
        const produtos = new Set([...separarProdutos(atual?.produto), ...separarProdutos(produto)]);
        vistas.set(etapa, { etapa, produto: produtos.size ? juntarProdutos([...produtos]) : null });
      }
    }
  }
  const ordem = etapa => {
    const i = ORDEM_ETAPAS_RLQ.indexOf(etapa);
    return i < 0 ? ORDEM_ETAPAS_RLQ.length : i;
  };
  return [...vistas.values()].sort((a, b) => ordem(a.etapa) - ordem(b.etapa));
}

function juntarProdutos(xs) {
  if (xs.length <= 1) return xs[0] || '';
  return `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

function etapasDoProduto(etapasProduto, produto) {
  const chave = normalizarNome(produto);
  return etapasProduto.filter(e => separarProdutos(e.produto).some(p => normalizarNome(p) === chave)).map(e => e.etapa);
}

function rotuloEtapas(etapas) {
  if (etapas.length <= 1) return etapas[0] || '';
  // "Fase sequestrante" + "Fase neutralizante" → "Fases sequestrante e neutralizante"
  if (etapas.every(e => e.startsWith('Fase '))) return `Fases ${juntarProdutos(etapas.map(e => e.slice(5)))}`;
  return juntarProdutos(etapas);
}

// Palavras que não distinguem produtos ("Hidróxido de sódio" ≈ "Hidróxido Sódio").
const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'com']);

function tokens(texto) {
  // Números e embalagens ("25kg", "98", "50l") não identificam o produto.
  return normalizarNome(texto).split(' ').filter(t => t && !PALAVRAS_VAZIAS.has(t) && !/\d/.test(t));
}

function bigramas(texto) {
  const s = ` ${texto} `;
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre bigramas de caracteres (0–1). */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigramas(a);
  const resto = bigramas(b);
  let comuns = 0;
  for (const g of ba) {
    const i = resto.indexOf(g);
    if (i >= 0) { comuns += 1; resto.splice(i, 1); }
  }
  return (2 * comuns) / (ba.length + bigramas(b).length);
}

// "metasilicato" ≈ "metassilicato"; "hidrox" ≈ "hidroxido".
function palavrasParecidas(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return dice(a, b) >= 0.8;
}

/**
 * Semelhança entre o nome químico do RLQ e um nome do Estoque. `cobertura` é a fração das palavras
 * do RLQ presentes no nome do Estoque; o `score` (0–1) pesa também as palavras a mais do Estoque.
 */
export function semelhancaNomes(produto, nome) {
  if (normalizarNome(produto) === normalizarNome(nome)) return { score: 1, cobertura: 1 };
  const a = tokens(produto);
  const b = tokens(nome);
  if (!a.length || !b.length) return { score: 0, cobertura: 0 };
  const cobertura = a.filter(x => b.some(y => palavrasParecidas(x, y))).length / a.length;
  const precisao = b.filter(y => a.some(x => palavrasParecidas(x, y))).length / b.length;
  const porPalavras = 0.7 * cobertura + 0.3 * precisao;
  return { score: Math.max(porPalavras, dice(a.join(' '), b.join(' ')) * 0.9), cobertura };
}

const SCORE_MINIMO_OPCAO = 0.35;
const SCORE_MINIMO_AUTOMATICO = 0.7;
const MARGEM_AUTOMATICO = 0.15;

/**
 * Item do Estoque para um produto do RLQ: igualdade de nome/sinônimo ("exato"); senão o mais parecido,
 * vinculado sozinho só quando cobre todas as palavras do RLQ e se destaca dos demais ("aproximado");
 * caso contrário fica em "duvida" (com opções) ou "nenhum", para o vínculo ser escolhido no diálogo.
 */
export function vincularProduto(produto, itens, levados = new Set()) {
  const chave = normalizarNome(produto);
  const exato = itens.find(i => [i.name, ...(i.fdsSynonyms || [])].some(n => normalizarNome(n) === chave));
  if (exato) return { item: exato, vinculo: 'exato', opcoes: [] };
  const ranking = itens
    .map(item => {
      const melhor = [item.name, ...(item.fdsSynonyms || [])]
        .map(n => semelhancaNomes(produto, n))
        .reduce((m, x) => (x.score > m.score ? x : m), { score: 0, cobertura: 0 });
      return { item, ...melhor };
    })
    .filter(r => r.score >= SCORE_MINIMO_OPCAO)
    .sort((x, y) => y.score - x.score || Number(levados.has(y.item.id)) - Number(levados.has(x.item.id)));
  const opcoes = ranking.slice(0, 5).map(r => ({ stockItemId: r.item.id, nome: r.item.name, score: Math.round(r.score * 100) / 100 }));
  const [primeiro, segundo] = ranking;
  if (!primeiro) return { item: null, vinculo: 'nenhum', opcoes };
  // Empate técnico se resolve pelo romaneio: só um dos dois foi levado ao projeto.
  const destacado = !segundo || primeiro.score - segundo.score >= MARGEM_AUTOMATICO
    || (levados.has(primeiro.item.id) && !levados.has(segundo.item.id));
  if (primeiro.cobertura === 1 && primeiro.score >= SCORE_MINIMO_AUTOMATICO && destacado) {
    return { item: primeiro.item, vinculo: 'aproximado', opcoes };
  }
  return { item: null, vinculo: 'duvida', opcoes };
}

/**
 * FDS sugeridas: para cada produto citado nos RLQs, o item do Estoque (PRODUTO_QUIMICO) cujo
 * nome ou sinônimo de FDS corresponde ao nome químico (ou, na falta, o mais parecido), com a FDS
 * mais recente anexada. Os romaneios do projeto (movimentos de estoque e itens) servem de
 * confirmação adicional. `vinculos` ({ produto: stockItemId | '' }) são as escolhas feitas no
 * diálogo e valem sobre a sugestão automática ('' = não vincular).
 */
export async function sugerirFds(client, projeto, etapasProduto, vinculos = {}) {
  const produtos = [...new Set(etapasProduto.flatMap(e => separarProdutos(e.produto)))];
  const avisos = [];
  if (!produtos.length) return { candidatas: [], selecionadas: [], avisos, estoque: [] };
  const [itens, movimentos, itensRomaneio] = await Promise.all([
    client.stockItem.findMany({
      where: { type: 'PRODUTO_QUIMICO' },
      include: { documents: { orderBy: { createdAt: 'desc' } } }
    }),
    client.stockMovement.findMany({
      where: { OR: [{ projectId: projeto.id }, { romaneio: { projectId: projeto.id } }], item: { type: 'PRODUTO_QUIMICO' } },
      select: { itemId: true }
    }),
    client.romaneioItem.findMany({ where: { romaneio: { projectId: projeto.id } }, select: { itemName: true } })
  ]);
  const levadosMov = new Set(movimentos.map(m => m.itemId));
  const nomesRomaneio = itensRomaneio.map(i => normalizarNome(i.itemName));
  const noRomaneio = item => {
    const nomesItem = [item.name, ...(item.fdsSynonyms || [])].map(normalizarNome);
    return levadosMov.has(item.id) || nomesRomaneio.some(n => nomesItem.some(x => n.includes(x)));
  };
  const levados = new Set(itens.filter(noRomaneio).map(i => i.id));
  const escolhas = vinculos && typeof vinculos === 'object' ? vinculos : {};

  const candidatas = [];
  for (const produto of produtos) {
    const sugestao = vincularProduto(produto, itens, levados);
    let { item, vinculo } = sugestao;
    if (Object.hasOwn(escolhas, produto)) {
      const id = escolhas[produto];
      item = id ? itens.find(i => i.id === id) || null : null;
      if (id && !item) throw Object.assign(new Error(`Produto do Estoque escolhido para "${produto}" não encontrado.`), { status: 400 });
      vinculo = 'manual';
    }
    const base = { produto, vinculo, opcoes: sugestao.opcoes };
    if (!item) {
      if (vinculo === 'duvida') {
        avisos.push(`Produto "${produto}" (RLQ): mais de um item parecido no Estoque; escolha o vínculo na seção de FDS.`);
      } else if (vinculo !== 'manual') {
        avisos.push(`Produto "${produto}" (RLQ) sem item correspondente no Estoque: escolha o vínculo na seção de FDS ou cadastre o produto químico.`);
      }
      candidatas.push({ ...base, stockItemId: null, selecionado: false, motivo: vinculo === 'manual' ? 'sem vínculo' : 'sem cadastro' });
      continue;
    }
    const documento = item.documents[0] || null;
    const confirmado = levados.has(item.id);
    if (vinculo === 'aproximado') avisos.push(`Produto "${produto}" (RLQ) vinculado por semelhança a "${item.name}" do Estoque: confira.`);
    if (!documento) avisos.push(`Produto "${produto}" (${item.name}) sem arquivo de FDS anexado no Estoque.`);
    if (!confirmado) avisos.push(`Produto "${produto}" (${item.name}) não consta nos romaneios do projeto.`);
    candidatas.push({
      ...base,
      stockItemId: item.id,
      documentoId: documento?.id || null,
      nome_comercial: item.name,
      confirmadoRomaneio: confirmado,
      selecionado: Boolean(documento),
      motivo: documento ? (confirmado ? 'confirmado no romaneio' : 'não consta no romaneio') : 'sem arquivo de FDS'
    });
  }

  // Um item do Estoque pode responder por mais de um nome químico: uma FDS por item.
  const porItem = new Map();
  for (const c of candidatas.filter(c => c.selecionado)) {
    const item = itens.find(i => i.id === c.stockItemId);
    const atual = porItem.get(item.id);
    const etapas = [...new Set([...(atual?.etapas || []), ...etapasDoProduto(etapasProduto, c.produto)])];
    porItem.set(item.id, {
      etapas,
      fds: {
        produto: atual ? `${atual.fds.produto} / ${c.produto}` : c.produto,
        nome_comercial: item.name,
        codigo: item.fdsCode || '',
        revisao: item.fdsRevision || '',
        data: dataPt(item.fdsDate),
        etapa: '',
        fabricante: item.manufacturer || '',
        arquivo: `stockdoc:${c.documentoId}`
      }
    });
  }
  const selecionadas = [...porItem.values()].map(({ etapas, fds }) => ({ ...fds, etapa: rotuloEtapas(etapas) }));
  // Opções do vínculo manual no diálogo: todos os produtos químicos do Estoque.
  const estoque = itens
    .map(i => ({ stockItemId: i.id, nome: i.name, documentoId: i.documents[0]?.id || null, confirmadoRomaneio: levados.has(i.id) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { candidatas, selecionadas, avisos, estoque };
}

/**
 * Vínculos escolhidos no diálogo viram sinônimo de FDS do item do Estoque, para o próximo Data Book
 * já vincular sozinho. Devolve os itens alterados.
 */
export async function salvarVinculosFds(client, vinculos = {}) {
  const porItem = new Map();
  for (const [produto, id] of Object.entries(vinculos || {})) {
    if (!id || typeof id !== 'string' || !String(produto).trim()) continue;
    porItem.set(id, [...(porItem.get(id) || []), String(produto).trim().slice(0, 160)]);
  }
  if (!porItem.size) return [];
  const itens = await client.stockItem.findMany({ where: { id: { in: [...porItem.keys()] }, type: 'PRODUTO_QUIMICO' }, select: { id: true, name: true, fdsSynonyms: true } });
  const alterados = [];
  for (const item of itens) {
    const conhecidos = new Set([item.name, ...(item.fdsSynonyms || [])].map(normalizarNome));
    const novos = porItem.get(item.id).filter(p => !conhecidos.has(normalizarNome(p)) && conhecidos.add(normalizarNome(p)));
    if (!novos.length) continue;
    await client.stockItem.update({ where: { id: item.id }, data: { fdsSynonyms: [...(item.fdsSynonyms || []), ...novos] } });
    alterados.push(item.id);
  }
  return alterados;
}

/** Certificados de calibração dos manômetros (RTP) e contadores (RCPU) usados no intervalo. */
export async function sugerirCertificados(client, derivados) {
  const usados = new Map();
  for (const r of derivados) {
    const sc = r.specialConditions || {};
    if (r.reportType === 'RTP') {
      for (const m of sc.resolvedManometers || []) {
        if (!m.code) continue;
        const chave = `MAN:${m.code}:${m.certificate?.id || m.certCode || ''}`;
        if (!usados.has(chave)) {
          usados.set(chave, { certificateId: m.certificate?.id || null, equipamento: 'Manômetro', codigo: m.code, escala: m.scale || '',
            certificado: m.certCode || '', calibracao: dataPt(m.calibratedAt), validade: dataPt(m.expiresAt), aplicacao: 'RTP' });
        }
      }
    }
    if (r.reportType === 'RCPU' && sc.resolvedCounter?.code) {
      const c = sc.resolvedCounter;
      const chave = `CP:${c.code}:${c.certificate?.id || ''}`;
      if (!usados.has(chave)) {
        usados.set(chave, { certificateId: c.certificate?.id || null, equipamento: 'Contador de partículas', codigo: c.code,
          serie: c.serialNumber || '', certificado: c.certificate?.fileName?.replace(/\.pdf$/i, '') || '', aplicacao: 'RCPU' });
      }
    }
  }
  const avisos = [];
  const ids = [...usados.values()].map(u => u.certificateId).filter(Boolean);
  const registros = ids.length
    ? await client.calibrationCertificate.findMany({ where: { id: { in: ids } }, include: { particleCounter: { include: currentCalibrationCertificateInclude } } })
    : [];
  const porId = new Map(registros.map(c => [c.id, c]));
  const itens = [];
  for (const u of usados.values()) {
    const registro = u.certificateId ? porId.get(u.certificateId) : null;
    if (!registro) {
      avisos.push(`${u.equipamento} ${u.codigo}: certificado de calibração usado no relatório não está disponível para anexar.`);
      continue;
    }
    const { certificateId, ...resto } = u;
    // Datas do cadastro do contador só valem se este ainda é o certificado vigente dele.
    const contador = registro.particleCounter;
    const vigente = contador?.calibrationCertificates?.[0]?.id === registro.id;
    itens.push({
      ...resto,
      ...(vigente && !resto.calibracao ? { calibracao: dataPt(contador.calibratedAt), validade: dataPt(contador.expiresAt) } : {}),
      arquivo: `cert:${certificateId}`
    });
  }
  return { itens, avisos };
}

// ------------------------------------------------------------------ materialização dos arquivos
function dentroDe(raiz, alvo) {
  const rel = path.relative(path.resolve(raiz), path.resolve(alvo));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function caminhoCertificado(client, id) {
  const cert = await client.calibrationCertificate.findUnique({ where: { id } });
  if (!cert) return null;
  const alvo = path.resolve(env.uploadDir, ...cert.storagePath.split('/'));
  return dentroDe(env.uploadDir, alvo) && fsSync.existsSync(alvo) ? alvo : null;
}

async function caminhoDocumentoEstoque(client, id) {
  const doc = await client.stockItemDocument.findUnique({ where: { id } });
  if (!doc) return null;
  const resolvido = await resolvePublicStockAttachment(doc.publicToken, client);
  return resolvido?.targetPath || null;
}

/**
 * Troca as referências do app ("upload:", "stockdoc:", "cert:") por caminhos que o gerador lê.
 * - modo "verificar": fotos apontam para o arquivo original (só existência importa nos avisos);
 * - modo "gerar": fotos são convertidas/reduzidas (HEIC → JPEG) para dentro de `pasta`.
 * Foto ausente vira caminho inexistente (aviso do gerador); FDS ou certificado ausente é erro.
 */
export async function materializar(client, dados, { pasta, modo = 'gerar' } = {}) {
  const out = structuredClone(dados);
  if (modo === 'gerar') await fs.mkdir(path.join(pasta, 'fotos'), { recursive: true });
  let n = 0;
  for (const dia of out.dias) {
    for (const foto of dia.fotos || []) {
      const ref = String(foto.arquivo || '');
      if (!ref.startsWith('upload:')) continue;
      const fonte = ref.slice('upload:'.length);
      const nome = path.basename(fonte);
      if (modo === 'verificar') {
        foto.arquivo = resolveStoredUploadPath(fonte) || path.join('ausente', nome);
        continue;
      }
      const asset = await readStoredImageAsset(fonte).catch(() => null);
      if (!asset?.bytes) {
        foto.arquivo = path.join('ausente', nome);
        continue;
      }
      n += 1;
      const ext = asset.extension === 'png' ? 'png' : 'jpg';
      const destino = path.join(pasta, 'fotos', `${String(n).padStart(4, '0')}.${ext}`);
      await fs.writeFile(destino, asset.bytes);
      foto.arquivo = destino;
    }
  }
  for (const f of out.fds || []) {
    if (!String(f.arquivo).startsWith('stockdoc:')) continue;
    const alvo = await caminhoDocumentoEstoque(client, f.arquivo.slice('stockdoc:'.length));
    if (!alvo) throw Object.assign(new Error(`FDS de "${f.nome_comercial}" não encontrada no armazenamento.`), { status: 422 });
    f.arquivo = alvo;
  }
  for (const c of out.certificados || []) {
    if (!String(c.arquivo).startsWith('cert:')) continue;
    const alvo = await caminhoCertificado(client, c.arquivo.slice('cert:'.length));
    if (!alvo) throw Object.assign(new Error(`Certificado de calibração de ${c.equipamento} ${c.codigo} não encontrado no armazenamento.`), { status: 422 });
    c.arquivo = alvo;
  }
  return out;
}
