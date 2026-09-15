/**
 * As primitivas de preenchimento de modelo `.docx`.
 *
 * Estavam privadas em `report-docx.js`, que as usa desde sempre para os
 * relatórios. Saíram de lá porque o módulo Comercial passou a preencher `.docx`
 * também, e duplicar isto seria duplicar a parte difícil.
 *
 * **Qual é a parte difícil.** O Word parte o texto de um parágrafo em vários
 * `w:t` por qualquer motivo — uma correção ortográfica, um `rsid` de revisão,
 * uma marca de idioma. Então `{{cliente}}` quase nunca está inteiro num nó só:
 * costuma estar como `{{cli`, `en`, `te}}`. Um `replace` ingênuo em cada nó não
 * acha nada, e o marcador vai impresso para o cliente.
 *
 * `replaceTokenInElement` resolve concatenando o texto de todos os nós, achando
 * o marcador na string inteira e recortando pedaço por pedaço de volta — o
 * primeiro nó da faixa recebe o valor, os demais perdem só a parte que era do
 * marcador. A formatação de cada run sobrevive porque nenhum run é destruído.
 */

export function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    getTextNodes(child, out);
  }
  return out;
}

export function elementText(element) {
  return getTextNodes(element)
    .map(node => node.data || '')
    .join('');
}

export function safeText(value) {
  if (value == null) return '';
  return String(value);
}

/**
 * Mantém espaços significativos nas bordas dos fragmentos de texto do Word.
 *
 * Um parágrafo visualmente contínuo costuma estar dividido em vários `w:t`.
 * Sem `xml:space="preserve"`, o Word elimina o espaço no começo/fim desses
 * fragmentos e transforma, por exemplo, `35` + ` dia(s)` em `35dia(s)`.
 */
export function preserveWordTextSpaces(element) {
  const textos =
    element?.nodeName === 'w:t'
      ? [element]
      : Array.from(element?.getElementsByTagName?.('w:t') || []);

  textos.forEach(texto => {
    const conteudo = elementText(texto);
    if (/^\s|\s$/u.test(conteudo)) {
      texto.setAttributeNS(
        'http://www.w3.org/XML/1998/namespace',
        'xml:space',
        'preserve'
      );
    }
  });
}

export function replaceTokenInElement(element, token, replacement) {
  if (!token || token === replacement) return;
  const nodes = getTextNodes(element);
  let full = nodes.map(node => node.data || '').join('');
  let searchFrom = 0;
  let idx = full.indexOf(token, searchFrom);

  while (idx >= 0) {
    const end = idx + token.length;
    let offset = 0;
    let firstHit = true;

    for (const node of nodes) {
      const text = node.data || '';
      const startPos = offset;
      const endPos = offset + text.length;
      const overlapStart = Math.max(startPos, idx);
      const overlapEnd = Math.min(endPos, end);

      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - startPos;
        const localEnd = overlapEnd - startPos;
        const prefix = text.slice(0, localStart);
        const suffix = text.slice(localEnd);
        node.data = firstHit ? `${prefix}${replacement}${suffix}` : `${prefix}${suffix}`;
        firstHit = false;
      }
      offset = endPos;
    }

    full = nodes.map(node => node.data || '').join('');
    searchFrom = idx + String(replacement || '').length;
    idx = full.indexOf(token, searchFrom);
  }
}

/**
 * Quebra de linha de verdade dentro de um `w:t`.
 *
 * Um `\n` num `w:t` **não** vira quebra no Word: ele é colapsado como espaço.
 * Um valor de várias linhas sairia num parágrafo corrido. Aqui cada linha vira
 * seu próprio `w:t`, separados por `w:br`.
 */
export function preserveWordTextLineBreaks(element) {
  const textNodes = Array.from(element.getElementsByTagName('w:t'));
  textNodes.forEach(node => {
    const content = elementText(node);
    if (!/[\r\n]/.test(content)) return;
    const doc = node.ownerDocument;
    const parent = node.parentNode;
    const lines = content.split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
      if (index > 0) parent.insertBefore(doc.createElement('w:br'), node);
      const textNode = doc.createElement('w:t');
      if (/^\s|\s$/.test(line)) textNode.setAttribute('xml:space', 'preserve');
      textNode.appendChild(doc.createTextNode(line));
      parent.insertBefore(textNode, node);
    });
    parent.removeChild(node);
  });
}

/**
 * Troca `{{chave}}` pelo valor, em todas as grafias com espaço que o Word deixa
 * alguém digitar por engano.
 */
export function replacePlaceholders(element, values) {
  Object.entries(values).forEach(([key, value]) => {
    const safe = safeText(value);
    [`{{${key}}}`, `{{ ${key} }}`, `{{${key} }}`, `{{ ${key}}}`].forEach(token =>
      replaceTokenInElement(element, token, safe)
    );
  });
  preserveWordTextLineBreaks(element);
  preserveWordTextSpaces(element);
}

export function findFirstByText(root, tagName, token) {
  const nodes = Array.from(root.getElementsByTagName(tagName));
  return nodes.find(node => elementText(node).includes(token)) || null;
}

export function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

export function cloneBefore(node, clones) {
  const parent = node.parentNode;
  clones.forEach(clone => parent.insertBefore(clone, node));
}

/**
 * Repete uma linha de tabela, uma vez por registro, e apaga a linha-modelo.
 *
 * **A linha-modelo é sempre removida no fim, inclusive quando não há registro
 * nenhum.** Deixá-la faria a proposta sair com uma linha de `{{marcador}}`
 * impressa — e é exatamente o caso que ninguém testa, porque em desenvolvimento
 * sempre há dado.
 */
export function repetirLinha(raiz, marcador, registros) {
  const modelo = findFirstByText(raiz, 'w:tr', marcador);
  if (!modelo) return 0;

  const clones = registros.map(registro => {
    const clone = modelo.cloneNode(true);
    replacePlaceholders(clone, registro);
    return clone;
  });

  cloneBefore(modelo, clones);
  removeNode(modelo);
  return clones.length;
}

/**
 * Repete um parágrafo, uma vez por registro.
 *
 * O irmão da `repetirLinha` para o que não vive em tabela — os itens de escopo,
 * por exemplo, que são texto corrido e não linha de grade.
 */
export function repetirParagrafo(raiz, marcador, registros) {
  const modelo = findFirstByText(raiz, 'w:p', marcador);
  if (!modelo) return 0;

  const clones = registros.map(registro => {
    const clone = modelo.cloneNode(true);
    replacePlaceholders(clone, registro);
    return clone;
  });

  cloneBefore(modelo, clones);
  removeNode(modelo);
  return clones.length;
}
