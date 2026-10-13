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

/**
 * FDS sugeridas: para cada produto citado nos RLQs, o item do Estoque (PRODUTO_QUIMICO) cujo
 * nome ou sinônimo de FDS corresponde ao nome químico, com a FDS mais recente anexada. Os
 * romaneios do projeto (movimentos de estoque e itens) servem de confirmação adicional.
 */
export async function sugerirFds(client, projeto, etapasProduto) {
  const produtos = [...new Set(etapasProduto.flatMap(e => separarProdutos(e.produto)))];
  const avisos = [];
  if (!produtos.length) return { candidatas: [], selecionadas: [], avisos };
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
  const levados = new Set(movimentos.map(m => m.itemId));
  const nomesRomaneio = itensRomaneio.map(i => normalizarNome(i.itemName));

  const candidatas = [];
  for (const produto of produtos) {
    const chave = normalizarNome(produto);
    const item = itens.find(i => [i.name, ...(i.fdsSynonyms || [])].some(n => normalizarNome(n) === chave));
    if (!item) {
      avisos.push(`Produto "${produto}" (RLQ) sem FDS cadastrada no Estoque: cadastre o nome químico como sinônimo do produto.`);
      candidatas.push({ produto, stockItemId: null, selecionado: false, motivo: 'sem cadastro' });
      continue;
    }
    const documento = item.documents[0] || null;
    const nomesItem = [item.name, ...(item.fdsSynonyms || [])].map(normalizarNome);
    const confirmado = levados.has(item.id) || nomesRomaneio.some(n => nomesItem.some(x => n.includes(x)));
    if (!documento) avisos.push(`Produto "${produto}" (${item.name}) sem arquivo de FDS anexado no Estoque.`);
    if (!confirmado) avisos.push(`Produto "${produto}" (${item.name}) não consta nos romaneios do projeto.`);
    candidatas.push({
      produto,
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
  return { candidatas, selecionadas, avisos };
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
