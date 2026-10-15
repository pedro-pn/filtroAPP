import type { DatabookCampoDocumento, DatabookEdicoes } from '../../src/api/databook';

const gruposCampos = [
  [
    { id: 'documento.capa.servico', rotulo: 'Serviço na capa', original: 'Servico original', secao: 'Capa', multilinha: false },
    { id: 'documento.capa.valor.0', rotulo: 'Cliente', original: 'Cliente original', secao: 'Capa', multilinha: false }
  ], [
    { id: 'documento.s2.indicadores.dias_execucao', rotulo: 'Dias de execução', original: '8', secao: 'Resumo Executivo e Avanço Físico', multilinha: false },
    { id: 'documento.s2.indicadores.concluidos', rotulo: 'Quantidade concluída', original: '348,5', secao: 'Resumo Executivo e Avanço Físico', multilinha: false },
    { id: 'documento.s2.tabela.avanco.linha.0.coluna.4', rotulo: 'Avanço · linha 1', original: '42%', secao: 'Resumo Executivo e Avanço Físico', multilinha: true },
    { id: 'documento.s2.grafico.dia.0.percentual', rotulo: 'Avanço no gráfico · 01/10/2026', original: '42%', secao: 'Resumo Executivo e Avanço Físico', multilinha: false },
    { id: 'documento.s2.campo.observacao.valor', rotulo: 'Observação adicional', original: '', secao: 'Resumo Executivo e Avanço Físico', multilinha: true }
  ], [
    { id: 'documento.d1.campo.pressao.valor', rotulo: 'Pressão de teste', original: '315 bar', secao: 'Dia 1', multilinha: true },
    { id: 'documento.d2.campo.pressao.valor', rotulo: 'Pressão de teste', original: '315 bar', secao: 'Dia 2', multilinha: true },
    { id: 'documento.d1.campo.efetivo.valor', rotulo: 'Efetivo', original: '5 colaboradores', secao: 'Dia 1', multilinha: true }
  ]
];

export function camposDoDocumento(edicoes?: DatabookEdicoes): DatabookCampoDocumento[] {
  return gruposCampos.flat().map(c => ({ ...c, valor: edicoes?.campos_documento?.[c.id] ?? c.original,
    aparencia: { tamanho: 14, entrelinha: 18 } }));
}

/** PDF sintético com links reais para testar rolagem e seleção de campos no navegador. */
export function pdfInterativo(edicoes?: DatabookEdicoes, todosCampos = false) {
  const objetos = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const adicionar = (valor: string) => objetos.push(valor);
  const paginas: number[] = [];
  const textoPdf = (texto: string) => texto.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const blocos = todosCampos ? gruposCampos.map(grupo => grupo.map(c => ({ texto: edicoes?.campos_documento?.[c.id] ?? c.original, campo: c.id }))) : [
    [{ texto: edicoes?.servico || 'Servico original', campo: 'servico' }],
    [{ texto: edicoes?.textos?.escopo || 'Escopo original', campo: 'escopo' },
      { texto: edicoes?.textos?.resumo_executivo || 'Resumo original', campo: 'resumoExecutivo' }],
    [{ texto: edicoes?.dias?.[0]?.atividades?.[0]?.texto || 'Atividade original', campo: 'dias.0.atividades.0.texto' },
      { texto: edicoes?.dias?.[1]?.atividades?.[0]?.texto || 'Atividade original', campo: 'dias.1.atividades.0.texto' },
      { texto: edicoes?.dias?.[0]?.fotos?.[0]?.legenda || 'Legenda original', campo: 'dias.0.fotos.0.legenda' },
      { texto: 'Medicao: 315 bar', campo: null }]
  ];
  for (const linhas of blocos) {
    const conteudo = linhas.flatMap((linha, i) => linha.texto.split('\n').map((parte, j) => `BT /F1 14 Tf 40 ${520 - i * 60 - j * 20} Td (${textoPdf(parte)}) Tj ET`)).join('\n');
    const stream = adicionar(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
    const anotacoes = linhas.flatMap((linha, i) => {
      const partes = linha.texto.split('\n');
      const direita = Math.min(390, 40 + Math.max(18, ...partes.map(parte => parte.length * 7.2)));
      return linha.campo ? [adicionar(`<< /Type /Annot /Subtype /Link /Rect [40 ${517 - i * 60 - (partes.length - 1) * 20} ${direita} ${536 - i * 60}] /Border [0 0 0] /A << /S /URI /URI (https://databook.invalid/editar/${linha.campo}) >> >>`)] : [];
    });
    paginas.push(adicionar(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R /Annots [${anotacoes.map(id => `${id} 0 R`).join(' ')}] >>`));
  }
  objetos[1] = `<< /Type /Pages /Kids [${paginas.map(id => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  let documento = '%PDF-1.4\n';
  const offsets = [0];
  objetos.forEach((objeto, i) => { offsets.push(documento.length); documento += `${i + 1} 0 obj\n${objeto}\nendobj\n`; });
  const xref = documento.length;
  documento += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([documento], { type: 'application/pdf' });
}
